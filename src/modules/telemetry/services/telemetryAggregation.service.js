import {
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";
import TelemetryRecord from "../models/telemetryRecord.model.js";
import { buildTelemetryFilter } from "./telemetryStore.service.js";

// Aggregations TENISE-27 needs. They exist now so the record structure can be
// reviewed against real queries rather than against an intention.

// $percentile needs MongoDB 7.0+. If the cluster is older the aggregation still
// returns counts and averages, with percentiles null and a flag saying why.
async function runWithPercentileFallback(pipelineWithPercentiles, pipelineFallback) {
  try {
    const results = await TelemetryRecord.aggregate(pipelineWithPercentiles);

    return { results, percentilesSupported: true };
  } catch (error) {
    if (!/percentile/i.test(error.message)) {
      throw error;
    }

    const results = await TelemetryRecord.aggregate(pipelineFallback);

    return { results, percentilesSupported: false };
  }
}

function stageUnwindStages(filter, { excludeColdStart }) {
  const stages = [
    { $match: filter },
    { $addFields: { stageEntries: { $objectToArray: "$stages" } } },
    { $unwind: "$stageEntries" },
    { $match: { "stageEntries.v.durationMs": { $ne: null } } },
  ];

  if (excludeColdStart) {
    stages.push({ $match: { "stageEntries.v.coldStart": { $ne: true } } });
  }

  return stages;
}

// Per-stage latency. Cold start affected stages can be excluded so the roughly
// 10 second OpenSearch recovery does not sit inside the warm distribution.
//
// Grouped by run type as well as stage name: a stage name is only unique within
// a pipeline, and the same key would otherwise merge a startup's mongodb_connect
// with an ingestion's, or hide either behind the api_request records that
// outnumber both.
export async function aggregateStageLatency(options = {}) {
  const { excludeColdStart = true } = options;

  // Exclusion is per stage, not per record. A run that paid a cold start in one
  // stage still holds usable warm samples in the others, and dropping the whole
  // record would discard them — which for startup runs means discarding all of
  // them, since a first connection is almost always over the threshold.
  const filter = buildTelemetryFilter(options);

  const base = stageUnwindStages(filter, { excludeColdStart });

  const groupCommon = {
    _id: { runType: "$runType", stage: "$stageEntries.k" },
    samples: { $sum: 1 },
    avgMs: { $avg: "$stageEntries.v.durationMs" },
    minMs: { $min: "$stageEntries.v.durationMs" },
    maxMs: { $max: "$stageEntries.v.durationMs" },
    totalMs: { $sum: "$stageEntries.v.durationMs" },
    apiCalls: { $sum: "$stageEntries.v.apiCalls" },
    tokensIn: { $sum: "$stageEntries.v.tokensIn" },
    tokensOut: { $sum: "$stageEntries.v.tokensOut" },
    failures: {
      $sum: {
        $cond: [{ $eq: ["$stageEntries.v.status", STAGE_STATUSES.FAILED] }, 1, 0],
      },
    },
  };

  const withPercentiles = [
    ...base,
    {
      $group: {
        ...groupCommon,
        percentiles: {
          $percentile: {
            input: "$stageEntries.v.durationMs",
            p: [0.5, 0.95, 0.99],
            method: "approximate",
          },
        },
      },
    },
    { $sort: { totalMs: -1 } },
  ];

  const withoutPercentiles = [...base, { $group: groupCommon }, { $sort: { totalMs: -1 } }];

  const { results, percentilesSupported } = await runWithPercentileFallback(
    withPercentiles,
    withoutPercentiles,
  );

  return {
    percentilesSupported,
    excludeColdStart,
    stages: results.map((row) => ({
      runType: row._id.runType,
      stage: row._id.stage,
      samples: row.samples,
      avgMs: row.avgMs,
      minMs: row.minMs,
      maxMs: row.maxMs,
      totalMs: row.totalMs,
      p50Ms: row.percentiles?.[0] ?? null,
      p95Ms: row.percentiles?.[1] ?? null,
      p99Ms: row.percentiles?.[2] ?? null,
      apiCalls: row.apiCalls,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      failures: row.failures,
    })),
  };
}

// End to end latency per query class, which is what a "how long does a question
// take" figure is built from.
export async function aggregateRunLatencyByQueryClass(options = {}) {
  const { excludeColdStart = true } = options;
  const filter = buildTelemetryFilter({
    ...options,
    coldStart: excludeColdStart ? false : options.coldStart,
  });

  const results = await TelemetryRecord.aggregate([
    { $match: { ...filter, totalDurationMs: { $ne: null } } },
    {
      $group: {
        _id: { queryClass: "$queryClass", runType: "$runType" },
        runs: { $sum: 1 },
        avgMs: { $avg: "$totalDurationMs" },
        minMs: { $min: "$totalDurationMs" },
        maxMs: { $max: "$totalDurationMs" },
        failures: {
          $sum: { $cond: [{ $eq: ["$status", RUN_STATUSES.FAILED] }, 1, 0] },
        },
      },
    },
    { $sort: { runs: -1 } },
  ]);

  return results.map((row) => ({
    queryClass: row._id.queryClass,
    runType: row._id.runType,
    runs: row.runs,
    avgMs: row.avgMs,
    minMs: row.minMs,
    maxMs: row.maxMs,
    failures: row.failures,
  }));
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

// Volume split by API type: the input to cost per page and cost per document.
//
// Only ingestion runs carry these numbers — byApi and the volume counters are
// written by the ingestion pipeline and by nothing else. So the run type is
// pinned, in both directions:
//
//   undefined runType  -> narrowed to ingestion, never widened to every run
//   runType=ingestion  -> the same query
//   any other runType  -> intersects to nothing, so an empty report
//
// The last case is the one that matters. Letting a caller's runType through
// here redirected the aggregation onto other records and returned them under
// an "ingestion" label: asking the summary for api_request reported the
// api_request count as ingestion.totals.runs. Honouring the filter and
// returning zero is the honest answer; silently ignoring it would repeat the
// dropped-filter bug fixed in buildTelemetryFilter.
export async function aggregateIngestionVolume(options = {}) {
  const { runType } = options;

  if (runType !== undefined && runType !== TELEMETRY_RUN_TYPES.INGESTION) {
    return {
      totals: { ...EMPTY_INGESTION_TOTALS, msPerPage: null, msPerDocument: null },
      byApi: [],
    };
  }

  const filter = buildTelemetryFilter({
    ...options,
    runType: TELEMETRY_RUN_TYPES.INGESTION,
  });

  const [byApi, totals] = await Promise.all([
    TelemetryRecord.aggregate([
      { $match: filter },
      { $addFields: { apiEntries: { $objectToArray: "$ingestion.byApi" } } },
      { $unwind: "$apiEntries" },
      {
        $group: {
          _id: "$apiEntries.k",
          apiCalls: { $sum: "$apiEntries.v.apiCalls" },
          documents: { $sum: "$apiEntries.v.documents" },
          pages: { $sum: "$apiEntries.v.pages" },
          assets: { $sum: "$apiEntries.v.assets" },
          bytes: { $sum: "$apiEntries.v.bytes" },
          chunks: { $sum: "$apiEntries.v.chunks" },
          tokensIn: { $sum: "$apiEntries.v.tokensIn" },
          tokensOut: { $sum: "$apiEntries.v.tokensOut" },
          failures: { $sum: "$apiEntries.v.failures" },
          durationMs: { $sum: "$apiEntries.v.durationMs" },
        },
      },
      { $sort: { pages: -1 } },
    ]),
    TelemetryRecord.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          runs: { $sum: 1 },
          documents: { $sum: "$ingestion.documentCount" },
          pages: { $sum: "$ingestion.pageCount" },
          assets: { $sum: "$ingestion.assetCount" },
          bytes: { $sum: "$ingestion.byteCount" },
          chunks: { $sum: "$ingestion.chunkCount" },
          totalMs: { $sum: "$totalDurationMs" },
        },
      },
    ]),
  ]);

  const total = totals[0] || EMPTY_INGESTION_TOTALS;

  return {
    totals: {
      runs: total.runs,
      documents: total.documents,
      pages: total.pages,
      assets: total.assets,
      bytes: total.bytes,
      chunks: total.chunks,
      totalMs: total.totalMs,
      msPerPage: total.pages > 0 ? total.totalMs / total.pages : null,
      msPerDocument: total.documents > 0 ? total.totalMs / total.documents : null,
    },
    byApi: byApi.map((row) => ({
      apiType: row._id,
      apiCalls: row.apiCalls,
      documents: row.documents,
      pages: row.pages,
      assets: row.assets,
      bytes: row.bytes,
      chunks: row.chunks,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      failures: row.failures,
      durationMs: row.durationMs,
      // Per-API rate, unlike totals.msPerPage which divides whole-run time by
      // pages and so charges S3 and embedding time to the page count.
      msPerPage: row.pages > 0 ? row.durationMs / row.pages : null,
    })),
  };
}

// How often a cold start happened and what it cost, kept apart from the warm
// numbers so both stay honest.
//
// The rate is reported per run type and never blended. Every HTTP request
// produces a record and almost none are cold, while a startup connection almost
// always is; a single rate over both answers no question anyone asks.
export async function aggregateColdStarts(options = {}) {
  const filter = buildTelemetryFilter(options);

  const [byRunType, byResource] = await Promise.all([
    TelemetryRecord.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$runType",
          runs: { $sum: 1 },
          coldRuns: { $sum: { $cond: ["$coldStart.detected", 1, 0] } },
          totalRecoveryMs: { $sum: "$coldStart.totalRecoveryMs" },
        },
      },
      { $sort: { runs: -1 } },
    ]),
    TelemetryRecord.aggregate([
      { $match: { ...filter, "coldStart.detected": true } },
      { $unwind: "$coldStart.events" },
      {
        $group: {
          _id: "$coldStart.events.resource",
          events: { $sum: 1 },
          avgRecoveryMs: { $avg: "$coldStart.events.recoveryMs" },
          maxRecoveryMs: { $max: "$coldStart.events.recoveryMs" },
        },
      },
      { $sort: { events: -1 } },
    ]),
  ]);

  const runTypes = byRunType.map((row) => ({
    runType: row._id,
    runs: row.runs,
    coldRuns: row.coldRuns,
    warmRuns: row.runs - row.coldRuns,
    coldStartRate: row.runs > 0 ? row.coldRuns / row.runs : null,
    totalRecoveryMs: row.totalRecoveryMs,
  }));

  // Totals carry counts but deliberately no rate: see the note above.
  const totals = runTypes.reduce(
    (accumulator, row) => ({
      runs: accumulator.runs + row.runs,
      coldRuns: accumulator.coldRuns + row.coldRuns,
      warmRuns: accumulator.warmRuns + row.warmRuns,
      totalRecoveryMs: accumulator.totalRecoveryMs + row.totalRecoveryMs,
    }),
    { runs: 0, coldRuns: 0, warmRuns: 0, totalRecoveryMs: 0 },
  );

  return {
    totals,
    byRunType: runTypes,
    byResource: byResource.map((row) => ({
      resource: row._id,
      events: row.events,
      avgRecoveryMs: row.avgRecoveryMs,
      maxRecoveryMs: row.maxRecoveryMs,
    })),
  };
}

// Which stages have started reporting. Makes the gap between "structure exists"
// and "stage is instrumented" visible without reading code.
//
// Split by run type. Every record carries the four pipeline stages from day one
// (E6-20a), so without the split the api_request records — one per HTTP call —
// would keep every stage reading not_implemented long after ingestion had
// instrumented it. The record shape is right; the grouping was wrong.
export async function aggregateStageCoverage(options = {}) {
  const filter = buildTelemetryFilter(options);

  const results = await TelemetryRecord.aggregate([
    { $match: filter },
    { $addFields: { stageEntries: { $objectToArray: "$stages" } } },
    { $unwind: "$stageEntries" },
    {
      $group: {
        _id: {
          runType: "$runType",
          stage: "$stageEntries.k",
          status: "$stageEntries.v.status",
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: { runType: "$_id.runType", stage: "$_id.stage" },
        byStatus: { $push: { status: "$_id.status", count: "$count" } },
        total: { $sum: "$count" },
      },
    },
    { $sort: { "_id.runType": 1, "_id.stage": 1 } },
  ]);

  return results.map((row) => ({
    runType: row._id.runType,
    stage: row._id.stage,
    total: row.total,
    byStatus: row.byStatus,
    // A stage counts as instrumented only once it has actually run. Skipped
    // means the recorder knows about it but the story that builds it has not
    // landed, which is the same reporting gap as not_implemented.
    instrumented: row.byStatus.some(
      (entry) =>
        entry.count > 0 &&
        entry.status !== STAGE_STATUSES.NOT_IMPLEMENTED &&
        entry.status !== STAGE_STATUSES.SKIPPED,
    ),
  }));
}

export async function getTelemetrySummary(options = {}) {
  const [stageLatency, runLatency, ingestion, coldStarts, coverage] =
    await Promise.all([
      aggregateStageLatency(options),
      aggregateRunLatencyByQueryClass(options),
      aggregateIngestionVolume(options),
      aggregateColdStarts(options),
      aggregateStageCoverage(options),
    ]);

  return {
    window: { from: options.from || null, to: options.to || null },
    stageLatency,
    runLatency,
    ingestion,
    coldStarts,
    coverage,
  };
}
