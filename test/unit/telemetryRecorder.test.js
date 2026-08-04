import { test } from "node:test";
import assert from "node:assert/strict";

import {
  startTelemetryRun,
  withColdStartDetection,
} from "../../src/modules/telemetry/services/telemetryRecorder.service.js";
import {
  API_TYPES,
  COLD_START_RESOURCES,
  PIPELINE_STAGE_NAMES,
  QUERY_CLASSES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
  TELEMETRY_SCHEMA_VERSION,
} from "../../src/shared/constants/telemetry.js";

// These run without a database. finish() calls the store, which skips the write
// when no connection exists, so the record shape is testable in isolation.

test("every record carries all four pipeline stages before they exist", () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.INGESTION });
  const record = run.snapshot();

  for (const stage of PIPELINE_STAGE_NAMES) {
    assert.ok(record.stages[stage], `missing stage: ${stage}`);
    assert.equal(record.stages[stage].status, STAGE_STATUSES.NOT_IMPLEMENTED);
  }

  assert.equal(record.schemaVersion, TELEMETRY_SCHEMA_VERSION);
});

test("every record carries a query class tag", () => {
  const defaulted = startTelemetryRun({
    runType: TELEMETRY_RUN_TYPES.QUERY,
  }).snapshot();

  assert.equal(defaulted.queryClass, QUERY_CLASSES.DOCUMENT);

  const ingestion = startTelemetryRun({
    runType: TELEMETRY_RUN_TYPES.INGESTION,
    queryClass: QUERY_CLASSES.NOT_APPLICABLE,
  }).snapshot();

  assert.equal(ingestion.queryClass, QUERY_CLASSES.NOT_APPLICABLE);
});

test("a new measured stage needs no structure change", () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  run.startStage("guardrails", { apiType: "bedrock_guardrails" });
  run.endStage("guardrails", { itemsIn: 3, itemsOut: 2 });

  const record = run.snapshot();

  assert.equal(record.stages.guardrails.status, STAGE_STATUSES.SUCCESS);
  assert.equal(record.stages.guardrails.itemsOut, 2);
  assert.ok(record.stages.guardrails.durationMs >= 0);

  // The four canonical stages are untouched by the addition.
  assert.equal(record.stages.routing.status, STAGE_STATUSES.NOT_IMPLEMENTED);
});

test("stage metrics from later stories land in the pre-declared fields", async () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  await run.measureStage("retrieval", async () => ({ hits: 5 }), {
    apiType: API_TYPES.OPENSEARCH,
    itemsOut: 5,
    apiCalls: 1,
  });

  const record = run.snapshot();

  assert.equal(record.stages.retrieval.status, STAGE_STATUSES.SUCCESS);
  assert.equal(record.stages.retrieval.apiType, API_TYPES.OPENSEARCH);
  assert.equal(record.stages.retrieval.itemsOut, 5);
});

test("ingestion volume is split by API type and rolled up", () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.INGESTION });

  run.recordApiUsage(API_TYPES.TEXTRACT, { pages: 12, documents: 1, apiCalls: 1 });
  run.recordApiUsage(API_TYPES.TEXTRACT, { pages: 8, documents: 1, apiCalls: 1 });
  run.recordApiUsage(API_TYPES.S3, { assets: 3, bytes: 2048, apiCalls: 3 });

  const record = run.snapshot();

  assert.equal(record.ingestion.byApi.textract.pages, 20);
  assert.equal(record.ingestion.byApi.textract.apiCalls, 2);
  assert.equal(record.ingestion.byApi.s3.assets, 3);
  assert.equal(record.ingestion.pageCount, 20);
  assert.equal(record.ingestion.assetCount, 3);
  assert.equal(record.ingestion.documentCount, 2);
});

test("cold starts are flagged distinctly, not folded into latency", async () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  await withColdStartDetection(
    run,
    {
      resource: COLD_START_RESOURCES.OPENSEARCH,
      stage: "retrieval",
      thresholdMs: 0,
    },
    async () => "ok",
  );

  const record = run.snapshot();

  assert.equal(record.coldStart.detected, true);
  assert.equal(record.coldStart.count, 1);
  assert.equal(record.coldStart.events[0].resource, COLD_START_RESOURCES.OPENSEARCH);
  assert.equal(record.stages.retrieval.coldStart, true);
});

test("a fast call is not flagged as a cold start", async () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  await withColdStartDetection(
    run,
    { resource: COLD_START_RESOURCES.OPENSEARCH, thresholdMs: 60000 },
    async () => "ok",
  );

  assert.equal(run.snapshot().coldStart.detected, false);
});

test("attributes cannot carry raw content", () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  run.note("documentText", "x".repeat(5000));
  run.note("chunkCount", 12);

  const record = run.snapshot();

  assert.ok(record.attributes.documentText.length <= 201);
  assert.equal(record.attributes.chunkCount, 12);
});

test("a failed stage marks the run partial, an explicit failure marks it failed", async () => {
  const partialRun = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  partialRun.startStage("rerank");
  partialRun.failStage("rerank", { code: "RERANK_TIMEOUT" });

  const partial = await partialRun.finish();

  assert.equal(partial.status, RUN_STATUSES.PARTIAL);
  assert.equal(partial.stages.rerank.errorCode, "RERANK_TIMEOUT");
  assert.ok(partial.totalDurationMs >= 0);

  const failedRun = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.INGESTION });

  failedRun.fail(new Error("boom"));

  const failed = await failedRun.finish();

  assert.equal(failed.status, RUN_STATUSES.FAILED);
  assert.equal(failed.error.message, "boom");
});

test("measureStage records a failure and rethrows", async () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  await assert.rejects(
    run.measureStage("generation", async () => {
      const error = new Error("model unavailable");

      error.code = "MODEL_UNAVAILABLE";
      throw error;
    }),
    /model unavailable/,
  );

  const record = run.snapshot();

  assert.equal(record.stages.generation.status, STAGE_STATUSES.FAILED);
  assert.equal(record.stages.generation.errorCode, "MODEL_UNAVAILABLE");
});
