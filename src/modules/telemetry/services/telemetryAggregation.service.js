import {
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";
import { fetchTelemetryRecords } from "./telemetryStore.service.js";

/*
 * TENISE-63: aggregations TENISE-27 needs, reimplemented over telemetry
 * records fetched from DynamoDB instead of MongoDB aggregation pipelines
 * ($objectToArray over a Map field, $unwind, grouped $percentile with a
 * fallback). DynamoDB has no aggregation framework of its own, so every
 * function below fetches the matching records once (fetchTelemetryRecords,
 * a filtered Scan) and reduces them in plain JS -- the same grouping and
 * arithmetic the Mongo pipelines did, just expressed as Map.groupBy-style
 * code instead of pipeline stages.
 *
 * This trades MongoDB's query-engine-side execution for fetching a (demo-
 * scale) telemetry collection into process memory per call. Acceptable here;
 * NOT something to carry unchanged to a production-volume table -- see
 * docs/DYNAMODB-MIGRATION.md's scaling note.
 *
 * Percentiles no longer have a "MongoDB version too old" fallback to report
 * (there is no MongoDB underneath this any more), so percentilesSupported is
 * now always true -- the field is kept only because the telemetry dashboard
 * and its tests read it.
 */

function toEntries(mapLikeValue) {
  return mapLikeValue ? Object.entries(mapLikeValue) : [];
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

// Linear-interpolation percentile over a raw sample array. Mongo's
// $percentile with method: "approximate" never promised an exact algorithm
// either -- nothing downstream of this depends on bit-for-bit parity with
// it, only on getting a representative p50/p95/p99 back.
function percentile(sortedAscending, p) {
  if (sortedAscending.length === 0) return null;
  if (sortedAscending.length === 1) return sortedAscending[0];

  const rank = p * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);

  if (lowerIndex === upperIndex) return sortedAscending[lowerIndex];

  const weight = rank - lowerIndex;

  return (
    sortedAscending[lowerIndex] * (1 - weight) + sortedAscending[upperIndex] * weight
  );
}

function groupBy(items, keyFn) {
  const groups = new Map();

  for (const item of items) {
    const key = JSON.stringify(keyFn(item));
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { items: [item] });
    }
  }

  return [...groups.values()].map((group) => group.items);
}

// Per-stage latency. Cold start affected stages can be excluded so the
// roughly 10 second OpenSearch recovery does not sit inside the warm
// distribution.
export async function aggregateStageLatency(options = {}) {
  const { excludeColdStart = true, byQueryClass = false } = options;
  const records = await fetchTelemetryRecords(options);

  // One row per (runType, stage[, queryClass]) sample, flattened out of
  // every record's stages map -- the in-memory equivalent of $objectToArray
  // + $unwind over `stages`.
  const samples = [];

  for (const record of records) {
    for (const [stageName, stage] of toEntries(record.stages)) {
      if (stage?.durationMs === null || stage?.durationMs === undefined) continue;
      if (excludeColdStart && stage.coldStart === true) continue;

      samples.push({
        runType: record.runType,
        stage: stageName,
        queryClass: record.queryClass,
        durationMs: stage.durationMs,
        apiCalls: stage.apiCalls || 0,
        tokensIn: stage.tokensIn || 0,
        tokensOut: stage.tokensOut || 0,
        failed: stage.status === STAGE_STATUSES.FAILED,
      });
    }
  }

  const groups = groupBy(samples, (sample) =>
    byQueryClass
      ? [sample.runType, sample.stage, sample.queryClass]
      : [sample.runType, sample.stage],
  );

  const stages = groups
    .map((group) => {
      const [{ runType, stage, queryClass }] = group;
      const durations = group.map((sample) => sample.durationMs).sort((a, b) => a - b);
      const totalMs = sum(durations);

      return {
        runType,
        stage,
        ...(byQueryClass ? { queryClass } : {}),
        samples: group.length,
        avgMs: totalMs / group.length,
        minMs: durations[0],
        maxMs: durations[durations.length - 1],
        totalMs,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        p99Ms: percentile(durations, 0.99),
        apiCalls: sum(group.map((sample) => sample.apiCalls)),
        tokensIn: sum(group.map((sample) => sample.tokensIn)),
        tokensOut: sum(group.map((sample) => sample.tokensOut)),
        failures: group.filter((sample) => sample.failed).length,
      };
    })
    .sort((a, b) => b.totalMs - a.totalMs);

  return {
    percentilesSupported: true,
    excludeColdStart,
    byQueryClass,
    stages,
  };
}

// End to end latency per query class, which is what a "how long does a
// question take" figure is built from. Carries the per-class token and
// OCU-second totals alongside it, so cost per query and latency per query
// come from the same grouping rather than two reports that can disagree.
export async function aggregateRunLatencyByQueryClass(options = {}) {
  const { excludeColdStart = true } = options;

  const filterOptions = {
    ...options,
    coldStart: excludeColdStart ? false : options.coldStart,
  };

  const records = (await fetchTelemetryRecords(filterOptions)).filter(
    (record) => record.totalDurationMs !== null && record.totalDurationMs !== undefined,
  );

  const groups = groupBy(records, (record) => [record.queryClass, record.runType]);

  const rows = groups
    .map((group) => {
      const [{ queryClass, runType }] = group;
      const durations = group.map((record) => record.totalDurationMs);
      const runs = group.length;
      const tokensIn = sum(group.map((record) => record.tokens?.input ?? 0));
      const tokensOut = sum(group.map((record) => record.tokens?.output ?? 0));
      const ocuSeconds = sum(group.map((record) => record.compute?.ocuSeconds ?? 0));
      const failures = group.filter((record) => record.status === RUN_STATUSES.FAILED).length;

      return {
        queryClass,
        runType,
        runs,
        avgMs: sum(durations) / runs,
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
        tokensIn,
        tokensOut,
        ocuSeconds,
        avgOcuSeconds: runs > 0 ? ocuSeconds / runs : null,
        avgTokensIn: runs > 0 ? tokensIn / runs : null,
        avgTokensOut: runs > 0 ? tokensOut / runs : null,
        failures,
      };
    })
    .sort((a, b) => b.runs - a.runs);

  return rows;
}

// OCU-seconds split by the resource that consumed them, so a query's compute
// cost can be attributed to retrieval or generation rather than only
// totalled. The counterpart to aggregateIngestionVolume's byApi split, for
// the query side.
export async function aggregateComputeByResource(options = {}) {
  const records = await fetchTelemetryRecords(options);

  const samples = [];

  for (const record of records) {
    for (const [resource, usage] of toEntries(record.compute?.byResource)) {
      samples.push({
        resource,
        queryClass: record.queryClass,
        seconds: usage?.seconds ?? 0,
        ocuSeconds: usage?.ocuSeconds ?? 0,
        calls: usage?.calls ?? 0,
      });
    }
  }

  const groups = groupBy(samples, (sample) => [sample.resource, sample.queryClass]);

  const rows = groups
    .map((group) => {
      const [{ resource, queryClass }] = group;
      const runs = group.length;
      const ocuSeconds = sum(group.map((sample) => sample.ocuSeconds));

      return {
        resource,
        queryClass,
        runs,
        seconds: sum(group.map((sample) => sample.seconds)),
        ocuSeconds,
        calls: sum(group.map((sample) => sample.calls)),
        ocuSecondsPerRun: runs > 0 ? ocuSeconds / runs : null,
      };
    })
    .sort((a, b) => b.ocuSeconds - a.ocuSeconds);

  return rows;
}

const EMPTY_INGESTION_TOTALS = Object.freeze({
  runs: 0,
  documents: 0,
  pages: 0,
  assets: 0,
  bytes: 0,
  chunks: 0,
  totalMs: 0,
});

// Volume split by API type: the input to cost per page and cost per
// document.
//
// Only ingestion runs carry these numbers — byApi and the volume counters
// are written by the ingestion pipeline and by nothing else. So the run type
// is pinned, in both directions:
//
//   undefined runType  -> narrowed to ingestion, never widened to every run
//   runType=ingestion  -> the same query
//   any other runType  -> intersects to nothing, so an empty report
export async function aggregateIngestionVolume(options = {}) {
  const { runType } = options;

  if (runType !== undefined && runType !== TELEMETRY_RUN_TYPES.INGESTION) {
    return {
      totals: { ...EMPTY_INGESTION_TOTALS, msPerPage: null, msPerDocument: null },
      byApi: [],
    };
  }

  const records = await fetchTelemetryRecords({ ...options, runType: TELEMETRY_RUN_TYPES.INGESTION });

  const totals = { ...EMPTY_INGESTION_TOTALS };
  const apiSamples = [];

  for (const record of records) {
    totals.runs += 1;
    totals.documents += record.ingestion?.documentCount ?? 0;
    totals.pages += record.ingestion?.pageCount ?? 0;
    totals.assets += record.ingestion?.assetCount ?? 0;
    totals.bytes += record.ingestion?.byteCount ?? 0;
    totals.chunks += record.ingestion?.chunkCount ?? 0;
    totals.totalMs += record.totalDurationMs ?? 0;

    for (const [apiType, usage] of toEntries(record.ingestion?.byApi)) {
      apiSamples.push({ apiType, usage: usage ?? {} });
    }
  }

  const byApi = groupBy(apiSamples, (sample) => sample.apiType)
    .map((group) => {
      const [{ apiType }] = group;
      const durationMs = sum(group.map((sample) => sample.usage.durationMs ?? 0));
      const pages = sum(group.map((sample) => sample.usage.pages ?? 0));

      return {
        apiType,
        apiCalls: sum(group.map((sample) => sample.usage.apiCalls ?? 0)),
        documents: sum(group.map((sample) => sample.usage.documents ?? 0)),
        pages,
        assets: sum(group.map((sample) => sample.usage.assets ?? 0)),
        bytes: sum(group.map((sample) => sample.usage.bytes ?? 0)),
        chunks: sum(group.map((sample) => sample.usage.chunks ?? 0)),
        tokensIn: sum(group.map((sample) => sample.usage.tokensIn ?? 0)),
        tokensOut: sum(group.map((sample) => sample.usage.tokensOut ?? 0)),
        failures: sum(group.map((sample) => sample.usage.failures ?? 0)),
        durationMs,
        // Per-API rate, unlike totals.msPerPage which divides whole-run time
        // by pages and so charges S3 and embedding time to the page count.
        msPerPage: pages > 0 ? durationMs / pages : null,
      };
    })
    .sort((a, b) => b.pages - a.pages);

  return {
    totals: {
      ...totals,
      msPerPage: totals.pages > 0 ? totals.totalMs / totals.pages : null,
      msPerDocument: totals.documents > 0 ? totals.totalMs / totals.documents : null,
    },
    byApi,
  };
}

// How often a cold start happened and what it cost, kept apart from the warm
// numbers so both stay honest.
//
// The rate is reported per run type and never blended. Every HTTP request
// produces a record and almost none are cold, while a startup connection
// almost always is; a single rate over both answers no question anyone asks.
export async function aggregateColdStarts(options = {}) {
  const records = await fetchTelemetryRecords(options);

  const runTypeGroups = groupBy(records, (record) => record.runType);

  const byRunType = runTypeGroups
    .map((group) => {
      const [{ runType }] = group;
      const runs = group.length;
      const coldRuns = group.filter((record) => record.coldStart?.detected).length;

      return {
        runType,
        runs,
        coldRuns,
        warmRuns: runs - coldRuns,
        coldStartRate: runs > 0 ? coldRuns / runs : null,
        totalRecoveryMs: sum(group.map((record) => record.coldStart?.totalRecoveryMs ?? 0)),
      };
    })
    .sort((a, b) => b.runs - a.runs);

  // Totals carry counts but deliberately no rate: see the note above.
  const totals = byRunType.reduce(
    (accumulator, row) => ({
      runs: accumulator.runs + row.runs,
      coldRuns: accumulator.coldRuns + row.coldRuns,
      warmRuns: accumulator.warmRuns + row.warmRuns,
      totalRecoveryMs: accumulator.totalRecoveryMs + row.totalRecoveryMs,
    }),
    { runs: 0, coldRuns: 0, warmRuns: 0, totalRecoveryMs: 0 },
  );

  const events = [];

  for (const record of records) {
    if (!record.coldStart?.detected) continue;

    for (const event of record.coldStart.events ?? []) {
      events.push(event);
    }
  }

  const byResource = groupBy(events, (event) => event.resource)
    .map((group) => {
      const [{ resource }] = group;
      const recoveries = group.map((event) => event.recoveryMs);

      return {
        resource,
        events: group.length,
        avgRecoveryMs: sum(recoveries) / group.length,
        maxRecoveryMs: Math.max(...recoveries),
      };
    })
    .sort((a, b) => b.events - a.events);

  return { totals, byRunType, byResource };
}

// Which stages have started reporting. Makes the gap between "structure
// exists" and "stage is instrumented" visible without reading code.
export async function aggregateStageCoverage(options = {}) {
  const records = await fetchTelemetryRecords(options);

  const statusSamples = [];

  for (const record of records) {
    for (const [stageName, stage] of toEntries(record.stages)) {
      statusSamples.push({ runType: record.runType, stage: stageName, status: stage?.status });
    }
  }

  const rows = groupBy(statusSamples, (sample) => [sample.runType, sample.stage])
    .map((group) => {
      const [{ runType, stage }] = group;

      const byStatus = groupBy(group, (sample) => sample.status).map((statusGroup) => ({
        status: statusGroup[0].status,
        count: statusGroup.length,
      }));

      return {
        runType,
        stage,
        total: group.length,
        byStatus,
        // A stage counts as instrumented only once it has actually run.
        // Skipped means the recorder knows about it but the story that
        // builds it has not landed, which is the same reporting gap as
        // not_implemented.
        instrumented: byStatus.some(
          (entry) =>
            entry.count > 0 &&
            entry.status !== STAGE_STATUSES.NOT_IMPLEMENTED &&
            entry.status !== STAGE_STATUSES.SKIPPED,
        ),
      };
    })
    .sort((a, b) => (a.runType === b.runType ? a.stage.localeCompare(b.stage) : a.runType.localeCompare(b.runType)));

  return rows;
}

export async function getTelemetrySummary(options = {}) {
  const [
    stageLatency,
    stageLatencyByQueryClass,
    runLatency,
    compute,
    ingestion,
    coldStarts,
    coverage,
  ] = await Promise.all([
    aggregateStageLatency(options),
    // The bottleneck-within-a-class figure. Reported alongside the coarser
    // split rather than replacing it: the class-blind rows stay the right
    // answer for runTypes that have no meaningful class (startup, ingestion).
    aggregateStageLatency({ ...options, byQueryClass: true }),
    aggregateRunLatencyByQueryClass(options),
    aggregateComputeByResource(options),
    aggregateIngestionVolume(options),
    aggregateColdStarts(options),
    aggregateStageCoverage(options),
  ]);

  return {
    window: { from: options.from || null, to: options.to || null },
    stageLatency,
    stageLatencyByQueryClass,
    runLatency,
    compute,
    ingestion,
    coldStarts,
    coverage,
  };
}
