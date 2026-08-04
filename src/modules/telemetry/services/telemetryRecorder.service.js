import { randomUUID } from "node:crypto";

import {
  DEFAULT_QUERY_CLASS,
  MAX_ATTRIBUTE_LENGTH,
  PIPELINE_STAGE_NAMES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_SCHEMA_VERSION,
} from "../../../shared/constants/telemetry.js";
import { getColdStartThresholdMs, telemetryConfig } from "../telemetry.config.js";
import { persistTelemetryRecord } from "./telemetryStore.service.js";

// The recorder is the only thing other modules touch. It builds one telemetry
// record per run and writes it once, at the end. Callers never construct the
// record shape themselves, so a schema addition stays inside this module.

function emptyApiUsage() {
  return {
    apiCalls: 0,
    documents: 0,
    pages: 0,
    assets: 0,
    bytes: 0,
    chunks: 0,
    tokensIn: 0,
    tokensOut: 0,
    failures: 0,
    durationMs: 0,
  };
}

function emptyStage() {
  return {
    status: STAGE_STATUSES.NOT_IMPLEMENTED,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attempts: 0,
    apiType: null,
    apiCalls: 0,
    itemsIn: 0,
    itemsOut: 0,
    tokensIn: 0,
    tokensOut: 0,
    coldStart: false,
    errorCode: null,
    reason: null,
    attributes: {},
  };
}

// Attributes are the only free-form field on a record, so this is where content
// leakage would happen. Objects are rejected and strings are truncated
// (threat model T-04: telemetry stores metadata, never raw content).
function sanitizeAttributeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > MAX_ATTRIBUTE_LENGTH
      ? `${value.slice(0, MAX_ATTRIBUTE_LENGTH)}…`
      : value;
  }

  return String(value).slice(0, MAX_ATTRIBUTE_LENGTH);
}

function toPositiveNumber(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function startTelemetryRun({
  runType,
  queryClass = DEFAULT_QUERY_CLASS,
  correlationId = null,
  sourceId = null,
  sourceType = null,
  http = null,
  attributes = {},
} = {}) {
  if (!runType) {
    throw new Error("startTelemetryRun requires a runType.");
  }

  const startedAt = new Date();
  const startedAtMs = Date.now();

  const record = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    recordId: randomUUID(),
    runType,
    correlationId,
    queryClass,
    status: RUN_STATUSES.RUNNING,
    environment: telemetryConfig.environment,
    serviceVersion: telemetryConfig.serviceVersion,
    startedAt,
    completedAt: null,
    totalDurationMs: null,
    stages: {},
    ingestion: {
      sourceId,
      sourceType,
      documentCount: 0,
      pageCount: 0,
      assetCount: 0,
      byteCount: 0,
      chunkCount: 0,
      byApi: {},
    },
    coldStart: {
      detected: false,
      count: 0,
      totalRecoveryMs: 0,
      events: [],
    },
    tokens: { input: 0, output: 0 },
    cost: {
      estimatedUsd: null,
      currency: "USD",
      calculatedAt: null,
      breakdown: {},
    },
    http: {
      method: http?.method || null,
      route: http?.route || null,
      statusCode: http?.statusCode || null,
    },
    error: { code: null, message: null },
    attributes: {},
  };

  // The four pipeline stages exist on every record before anything runs.
  for (const stage of PIPELINE_STAGE_NAMES) {
    record.stages[stage] = emptyStage();
  }

  const stageStartMs = new Map();
  let finished = false;

  function ensureStage(name) {
    if (!record.stages[name]) {
      // A stage nobody declared. Recording it needs no schema change, which is
      // the point of the map.
      record.stages[name] = emptyStage();
    }

    return record.stages[name];
  }

  function applyAttributes(target, values) {
    for (const [key, value] of Object.entries(values || {})) {
      target[key] = sanitizeAttributeValue(value);
    }
  }

  applyAttributes(record.attributes, attributes);

  const recorder = {
    recordId: record.recordId,

    setQueryClass(queryClassValue) {
      record.queryClass = queryClassValue;
      return recorder;
    },

    setCorrelationId(value) {
      record.correlationId = value;
      return recorder;
    },

    setSource({ sourceId: id, sourceType: type } = {}) {
      if (id) {
        record.ingestion.sourceId = id;
      }

      if (type) {
        record.ingestion.sourceType = type;
      }

      return recorder;
    },

    setHttp({ method, route, statusCode } = {}) {
      record.http = {
        method: method ?? record.http.method,
        route: route ?? record.http.route,
        statusCode: statusCode ?? record.http.statusCode,
      };

      return recorder;
    },

    note(key, value) {
      record.attributes[key] = sanitizeAttributeValue(value);
      return recorder;
    },

    startStage(name, { apiType = null } = {}) {
      const stage = ensureStage(name);

      stage.status = STAGE_STATUSES.RUNNING;
      stage.startedAt = new Date();
      stage.attempts += 1;

      if (apiType) {
        stage.apiType = apiType;
      }

      stageStartMs.set(name, Date.now());

      return recorder;
    },

    endStage(name, metrics = {}) {
      const stage = ensureStage(name);
      const startMs = stageStartMs.get(name);

      stage.status = metrics.status || STAGE_STATUSES.SUCCESS;
      stage.completedAt = new Date();
      stage.durationMs =
        metrics.durationMs ?? (startMs === undefined ? null : Date.now() - startMs);

      stage.apiType = metrics.apiType ?? stage.apiType;
      stage.apiCalls += toPositiveNumber(metrics.apiCalls);
      stage.itemsIn += toPositiveNumber(metrics.itemsIn);
      stage.itemsOut += toPositiveNumber(metrics.itemsOut);
      stage.tokensIn += toPositiveNumber(metrics.tokensIn);
      stage.tokensOut += toPositiveNumber(metrics.tokensOut);

      record.tokens.input += toPositiveNumber(metrics.tokensIn);
      record.tokens.output += toPositiveNumber(metrics.tokensOut);

      if (metrics.coldStart) {
        stage.coldStart = true;
      }

      if (metrics.reason) {
        stage.reason = sanitizeAttributeValue(metrics.reason);
      }

      applyAttributes(stage.attributes, metrics.attributes);
      stageStartMs.delete(name);

      return recorder;
    },

    skipStage(name, reason) {
      const stage = ensureStage(name);

      stage.status = STAGE_STATUSES.SKIPPED;
      stage.reason = sanitizeAttributeValue(reason);

      return recorder;
    },

    failStage(name, error, metrics = {}) {
      const stage = ensureStage(name);

      stage.errorCode = error?.code || "STAGE_FAILED";
      recorder.endStage(name, { ...metrics, status: STAGE_STATUSES.FAILED });

      return recorder;
    },

    // Runs fn as a measured stage. Preferred entry point: a stage cannot be
    // left open if fn throws.
    async measureStage(name, fn, { apiType = null, ...metrics } = {}) {
      recorder.startStage(name, { apiType });

      try {
        const result = await fn();

        recorder.endStage(name, { ...metrics, ...(result?.telemetry || {}) });

        return result;
      } catch (error) {
        recorder.failStage(name, error, metrics);
        throw error;
      }
    },

    // Volume split by billed API type. Ingestion page and asset counts land
    // here, and the run level totals stay consistent with the split.
    recordApiUsage(apiType, usage = {}) {
      if (!apiType) {
        return recorder;
      }

      const current = record.ingestion.byApi[apiType] || emptyApiUsage();

      current.apiCalls += toPositiveNumber(usage.apiCalls);
      current.documents += toPositiveNumber(usage.documents);
      current.pages += toPositiveNumber(usage.pages);
      current.assets += toPositiveNumber(usage.assets);
      current.bytes += toPositiveNumber(usage.bytes);
      current.chunks += toPositiveNumber(usage.chunks);
      current.tokensIn += toPositiveNumber(usage.tokensIn);
      current.tokensOut += toPositiveNumber(usage.tokensOut);
      current.failures += toPositiveNumber(usage.failures);
      current.durationMs += toPositiveNumber(usage.durationMs);

      record.ingestion.byApi[apiType] = current;

      record.ingestion.documentCount += toPositiveNumber(usage.documents);
      record.ingestion.pageCount += toPositiveNumber(usage.pages);
      record.ingestion.assetCount += toPositiveNumber(usage.assets);
      record.ingestion.byteCount += toPositiveNumber(usage.bytes);
      record.ingestion.chunkCount += toPositiveNumber(usage.chunks);

      return recorder;
    },

    // Cold starts are flagged, never silently folded into latency. A record
    // carrying one is excludable from the distribution as a whole, and the
    // stage that paid for it is marked too.
    flagColdStart({ resource, stage = null, recoveryMs = null, thresholdMs = null }) {
      if (!resource) {
        return recorder;
      }

      record.coldStart.detected = true;
      record.coldStart.count += 1;
      record.coldStart.totalRecoveryMs += toPositiveNumber(recoveryMs);
      record.coldStart.events.push({
        resource,
        stage,
        detectedAt: new Date(),
        recoveryMs,
        thresholdMs: thresholdMs ?? getColdStartThresholdMs(resource),
      });

      if (stage) {
        ensureStage(stage).coldStart = true;
      }

      return recorder;
    },

    fail(error) {
      record.status = RUN_STATUSES.FAILED;
      record.error = {
        code: error?.code || "RUN_FAILED",
        message: sanitizeAttributeValue(error?.message || "Unknown error"),
      };

      return recorder;
    },

    snapshot() {
      return structuredClone(record);
    },

    async finish(status) {
      if (finished) {
        return record;
      }

      finished = true;

      record.completedAt = new Date();
      record.totalDurationMs = Date.now() - startedAtMs;

      if (status) {
        record.status = status;
      } else if (record.status === RUN_STATUSES.RUNNING) {
        const hasFailedStage = Object.values(record.stages).some(
          (stage) => stage.status === STAGE_STATUSES.FAILED,
        );

        record.status = hasFailedStage
          ? RUN_STATUSES.PARTIAL
          : RUN_STATUSES.SUCCESS;
      }

      await persistTelemetryRecord(record);

      return record;
    },
  };

  return recorder;
}

// Same surface as a real recorder, measuring nothing. Handed to callers when
// telemetry is switched off so that code written against req.telemetry keeps
// working instead of throwing on undefined.
export function createNoopTelemetryRun() {
  const recorder = {
    recordId: null,

    setQueryClass: () => recorder,
    setCorrelationId: () => recorder,
    setSource: () => recorder,
    setHttp: () => recorder,
    note: () => recorder,
    startStage: () => recorder,
    endStage: () => recorder,
    skipStage: () => recorder,
    failStage: () => recorder,
    recordApiUsage: () => recorder,
    flagColdStart: () => recorder,
    fail: () => recorder,
    snapshot: () => null,

    // Still runs fn: the work is real even when the measurement is discarded.
    async measureStage(name, fn) {
      return fn();
    },

    async finish() {
      return null;
    },
  };

  return recorder;
}

// Wraps a call that can pay a cold start. Anything slower than the resource
// threshold is flagged on the record rather than left to distort the latency
// distribution. OpenSearch Serverless NextGen recovery is roughly 10 seconds.
//
// Only a call that succeeded can have recovered. A slow call that threw is a
// timeout or an error, and counting it would inflate coldRuns and pull
// avgRecoveryMs towards the client timeout instead of the real recovery time.
export async function withColdStartDetection(
  recorder,
  { resource, stage = null, thresholdMs = null },
  fn,
) {
  const threshold = thresholdMs ?? getColdStartThresholdMs(resource);
  const startMs = Date.now();

  const result = await fn();

  const elapsedMs = Date.now() - startMs;

  if (elapsedMs >= threshold && recorder) {
    recorder.flagColdStart({
      resource,
      stage,
      recoveryMs: elapsedMs,
      thresholdMs: threshold,
    });
  }

  return result;
}
