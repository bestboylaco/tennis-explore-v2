import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import mongoose from "mongoose";

import TelemetryRecord from "../../src/modules/telemetry/models/telemetryRecord.model.js";
import {
  aggregateColdStarts,
  aggregateComputeByResource,
  aggregateIngestionVolume,
  aggregateRunLatencyByQueryClass,
  aggregateStageCoverage,
  aggregateStageLatency,
  getTelemetrySummary,
} from "../../src/modules/telemetry/services/telemetryAggregation.service.js";
import {
  API_TYPES,
  COLD_START_RESOURCES,
  PIPELINE_STAGE_NAMES,
  QUERY_CLASSES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "../../src/shared/constants/telemetry.js";

dotenv.config();

// The aggregations are the part of telemetry that answers questions, and they
// are pure MongoDB pipelines — $objectToArray over a Map field, $unwind, grouped
// $percentile with a fallback. None of that is exercised by the unit tests, so
// it is verified here against a real server.
//
// Every seeded record shares one correlationId and every aggregation is scoped
// to it, so this suite neither reads nor removes anything else in the database.

const mongoUri = process.env.MONGODB_URI;
const correlationId = `itest:telemetry-aggregation:${randomUUID()}`;
const startedAt = new Date("2026-07-01T00:00:00.000Z");

// Connect once for the whole file, not once per describe block. Each suite
// used to open its own connection in before() and close it in after() on
// mongoose's shared default connection -- disconnecting between suites and
// immediately reconnecting for the next one raced the topology/primary
// discovery that reconnecting has to redo, which was invisible on a fast
// local network but showed up as missing seed records under CI's higher
// round-trip latency to Atlas (writes proceeding against a connection whose
// topology discovery had not actually settled yet, despite the connect()
// promise having resolved).
before(async () => {
  if (mongoUri) {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  }
});

after(async () => {
  if (mongoUri) {
    await mongoose.disconnect();
  }
});

// Every record carries the four pipeline stages from day one (E6-20a), so the
// fixtures do too. This is exactly what made a single global grouping useless:
// one HTTP request contributes four not_implemented stages.
function pipelineStages(overrides = {}) {
  const stages = {};

  for (const stage of PIPELINE_STAGE_NAMES) {
    stages[stage] = { status: STAGE_STATUSES.NOT_IMPLEMENTED };
  }

  return { ...stages, ...overrides };
}

function baseRecord(runType, queryClass) {
  return {
    recordId: randomUUID(),
    runType,
    correlationId,
    queryClass,
    status: RUN_STATUSES.SUCCESS,
    startedAt,
    completedAt: startedAt,
  };
}

function seedRecords() {
  // Three HTTP requests that measured a fast retrieval, plus one real query that
  // measured a slow one. Same stage name, different workloads: blended into one
  // row they produce an average that describes neither.
  const apiRequests = [10, 20, 30].map((durationMs) => ({
    ...baseRecord(TELEMETRY_RUN_TYPES.API_REQUEST, QUERY_CLASSES.NOT_APPLICABLE),
    totalDurationMs: durationMs,
    stages: pipelineStages({
      retrieval: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs,
        apiType: API_TYPES.OPENSEARCH,
        apiCalls: 1,
      },
    }),
    http: { method: "GET", route: "/api/sources", statusCode: 200 },
  }));

  const query = {
    ...baseRecord(TELEMETRY_RUN_TYPES.QUERY, QUERY_CLASSES.DOCUMENT),
    totalDurationMs: 950,
    stages: pipelineStages({
      retrieval: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: 900,
        apiType: API_TYPES.OPENSEARCH,
        apiCalls: 1,
        tokensIn: 120,
      },
    }),
  };

  // A first database connection is almost always over the 2s threshold, so the
  // startup run is cold. Under a record level exclusion this run disappeared
  // from stage latency entirely.
  const startup = {
    ...baseRecord(TELEMETRY_RUN_TYPES.STARTUP, QUERY_CLASSES.NOT_APPLICABLE),
    totalDurationMs: 6200,
    stages: pipelineStages({
      mongodb_connect: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: 6000,
        coldStart: true,
      },
    }),
    coldStart: {
      detected: true,
      count: 1,
      totalRecoveryMs: 6000,
      events: [
        {
          resource: COLD_START_RESOURCES.MONGODB,
          stage: "mongodb_connect",
          recoveryMs: 6000,
          thresholdMs: 2000,
        },
      ],
    },
  };

  // One ingestion paid a cold start in index; its extract stage is still a
  // perfectly good warm sample and must survive the exclusion.
  const coldIngestion = {
    ...baseRecord(TELEMETRY_RUN_TYPES.INGESTION, QUERY_CLASSES.NOT_APPLICABLE),
    totalDurationMs: 9000,
    stages: pipelineStages({
      extract: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: 100,
        apiType: API_TYPES.TEXTRACT,
      },
      index: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: 8000,
        apiType: API_TYPES.OPENSEARCH,
        coldStart: true,
      },
    }),
    coldStart: {
      detected: true,
      count: 1,
      totalRecoveryMs: 8000,
      events: [
        {
          resource: COLD_START_RESOURCES.OPENSEARCH,
          stage: "index",
          recoveryMs: 8000,
          thresholdMs: 5000,
        },
      ],
    },
    ingestion: {
      documentCount: 1,
      pageCount: 10,
      chunkCount: 40,
      byApi: {
        [API_TYPES.TEXTRACT]: {
          apiCalls: 1,
          documents: 1,
          pages: 10,
          durationMs: 100,
        },
        [API_TYPES.BEDROCK_EMBEDDING]: {
          apiCalls: 2,
          chunks: 40,
          durationMs: 8000,
        },
      },
    },
  };

  const warmIngestion = {
    ...baseRecord(TELEMETRY_RUN_TYPES.INGESTION, QUERY_CLASSES.NOT_APPLICABLE),
    totalDurationMs: 600,
    stages: pipelineStages({
      extract: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: 200,
        apiType: API_TYPES.TEXTRACT,
      },
      index: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: 300,
        apiType: API_TYPES.OPENSEARCH,
      },
    }),
    ingestion: {
      documentCount: 1,
      pageCount: 20,
      chunkCount: 10,
      byApi: {
        [API_TYPES.TEXTRACT]: {
          apiCalls: 1,
          documents: 1,
          pages: 20,
          durationMs: 200,
        },
        [API_TYPES.BEDROCK_EMBEDDING]: {
          apiCalls: 1,
          chunks: 10,
          durationMs: 300,
        },
      },
    },
  };

  return [...apiRequests, query, startup, coldIngestion, warmIngestion];
}

function findStage(rows, runType, stage) {
  return rows.find((row) => row.runType === runType && row.stage === stage);
}

describe(
  "telemetry aggregations",
  { skip: mongoUri ? false : "MONGODB_URI is not set" },
  () => {
    before(async () => {
      await TelemetryRecord.insertMany(seedRecords());
    });

    after(async () => {
      await TelemetryRecord.deleteMany({ correlationId });
    });

    it("reports the cold start rate per run type and never blends them", async () => {
      const result = await aggregateColdStarts({ correlationId });
      const byRunType = Object.fromEntries(
        result.byRunType.map((row) => [row.runType, row]),
      );

      assert.equal(byRunType.api_request.runs, 3);
      assert.equal(byRunType.api_request.coldStartRate, 0);

      assert.equal(byRunType.startup.runs, 1);
      assert.equal(byRunType.startup.coldStartRate, 1);

      assert.equal(byRunType.ingestion.runs, 2);
      assert.equal(byRunType.ingestion.coldStartRate, 0.5);

      assert.equal(result.totals.runs, 7);
      assert.equal(result.totals.coldRuns, 2);
      assert.equal(result.totals.warmRuns, 5);

      // 2/7 is the blended rate. It describes no real workload, so it is not
      // offered at all rather than left for a reader to misread.
      assert.equal(result.coldStartRate, undefined);
      assert.equal(result.totals.coldStartRate, undefined);
    });

    it("attributes cold start recovery to the resource that paid it", async () => {
      const result = await aggregateColdStarts({ correlationId });
      const byResource = Object.fromEntries(
        result.byResource.map((row) => [row.resource, row]),
      );

      assert.equal(byResource.opensearch_serverless.events, 1);
      assert.equal(byResource.opensearch_serverless.avgRecoveryMs, 8000);
      assert.equal(byResource.mongodb.avgRecoveryMs, 6000);
    });

    it("keys stage latency by run type so one stage name is not two workloads", async () => {
      const result = await aggregateStageLatency({ correlationId });

      const apiRetrieval = findStage(
        result.stages,
        TELEMETRY_RUN_TYPES.API_REQUEST,
        "retrieval",
      );
      const queryRetrieval = findStage(
        result.stages,
        TELEMETRY_RUN_TYPES.QUERY,
        "retrieval",
      );

      // Grouped on stage name alone these four samples averaged 240ms, which is
      // neither the HTTP figure nor the query figure.
      assert.equal(apiRetrieval.samples, 3);
      assert.equal(apiRetrieval.avgMs, 20);
      assert.equal(queryRetrieval.samples, 1);
      assert.equal(queryRetrieval.avgMs, 900);

      assert.equal(typeof result.percentilesSupported, "boolean");
    });

    it("excludes a cold stage without discarding the warm stages beside it", async () => {
      const result = await aggregateStageLatency({ correlationId });

      // Both ingestion runs contribute their extract sample, including the run
      // whose index stage was cold.
      const extract = findStage(
        result.stages,
        TELEMETRY_RUN_TYPES.INGESTION,
        "extract",
      );

      assert.equal(extract.samples, 2);
      assert.equal(extract.avgMs, 150);

      // The cold stage itself is the only thing dropped.
      const index = findStage(result.stages, TELEMETRY_RUN_TYPES.INGESTION, "index");

      assert.equal(index.samples, 1);
      assert.equal(index.avgMs, 300);

      assert.equal(
        findStage(result.stages, TELEMETRY_RUN_TYPES.STARTUP, "mongodb_connect"),
        undefined,
      );
    });

    it("includes cold stages when asked, and keeps them under their own run type", async () => {
      const result = await aggregateStageLatency({
        correlationId,
        excludeColdStart: false,
      });

      const connect = findStage(
        result.stages,
        TELEMETRY_RUN_TYPES.STARTUP,
        "mongodb_connect",
      );

      assert.equal(connect.samples, 1);
      assert.equal(connect.avgMs, 6000);

      const index = findStage(result.stages, TELEMETRY_RUN_TYPES.INGESTION, "index");

      assert.equal(index.samples, 2);
      assert.equal(index.maxMs, 8000);
    });

    it("reports stage coverage per run type", async () => {
      const rows = await aggregateStageCoverage({ correlationId });

      // retrieval is instrumented for HTTP requests and not for ingestion. A
      // single global row cannot express that, and would have read
      // not_implemented because api_request records outnumber the rest.
      assert.equal(
        findStage(rows, TELEMETRY_RUN_TYPES.API_REQUEST, "retrieval").instrumented,
        true,
      );
      assert.equal(
        findStage(rows, TELEMETRY_RUN_TYPES.INGESTION, "retrieval").instrumented,
        false,
      );

      assert.equal(
        findStage(rows, TELEMETRY_RUN_TYPES.INGESTION, "extract").instrumented,
        true,
      );

      const routing = findStage(rows, TELEMETRY_RUN_TYPES.API_REQUEST, "routing");

      assert.equal(routing.instrumented, false);
      assert.equal(routing.total, 3);
      assert.deepEqual(routing.byStatus, [
        { status: STAGE_STATUSES.NOT_IMPLEMENTED, count: 3 },
      ]);
    });

    it("splits ingestion volume by billed API type", async () => {
      const result = await aggregateIngestionVolume({ correlationId });
      const byApi = Object.fromEntries(
        result.byApi.map((row) => [row.apiType, row]),
      );

      assert.equal(byApi.textract.pages, 30);
      assert.equal(byApi.textract.apiCalls, 2);

      // Chunks are attributed to the API that was billed for them, not only
      // rolled up on the run.
      assert.equal(byApi.bedrock_embedding.chunks, 50);
      assert.equal(byApi.bedrock_embedding.apiCalls, 3);

      assert.equal(result.totals.runs, 2);
      assert.equal(result.totals.pages, 30);
      assert.equal(result.totals.chunks, 50);
      assert.equal(result.totals.msPerPage, 9600 / 30);
    });

    it("reports time per billed API, not only whole-run time", async () => {
      const result = await aggregateIngestionVolume({ correlationId });
      const byApi = Object.fromEntries(
        result.byApi.map((row) => [row.apiType, row]),
      );

      assert.equal(byApi.textract.durationMs, 300);
      assert.equal(byApi.textract.msPerPage, 10);

      // Embedding time is real but pays per token, so a page rate for it is not
      // a number anyone should be shown.
      assert.equal(byApi.bedrock_embedding.durationMs, 8300);
      assert.equal(byApi.bedrock_embedding.msPerPage, null);

      // The whole-run rate charges every API's time to the page count, which is
      // why the per-API rate exists alongside it.
      assert.notEqual(result.totals.msPerPage, byApi.textract.msPerPage);
    });

    it("pins ingestion volume to ingestion runs whatever runType is asked for", async () => {
      // Seven records share the correlationId; only the two ingestion runs may
      // reach this aggregation.
      const defaulted = await aggregateIngestionVolume({ correlationId });

      assert.equal(defaulted.totals.runs, 2);
      assert.equal(defaulted.totals.documents, 2);

      // Naming the run type explicitly is the same query.
      const explicit = await aggregateIngestionVolume({
        correlationId,
        runType: TELEMETRY_RUN_TYPES.INGESTION,
      });

      assert.equal(explicit.totals.runs, 2);

      // Any other run type intersects to nothing. It must never redirect the
      // aggregation onto those records and return them under an ingestion
      // label — that reported the api_request count as ingestion.totals.runs.
      const other = await aggregateIngestionVolume({
        correlationId,
        runType: TELEMETRY_RUN_TYPES.API_REQUEST,
      });

      assert.equal(other.totals.runs, 0);
      assert.equal(other.totals.msPerPage, null);
      assert.deepEqual(other.byApi, []);
    });

    it("keeps every summary block honest when filtered to one run type", async () => {
      const summary = await getTelemetrySummary({
        correlationId,
        runType: TELEMETRY_RUN_TYPES.API_REQUEST,
      });

      assert.equal(summary.ingestion.totals.runs, 0);
      assert.deepEqual(summary.ingestion.byApi, []);

      assert.ok(
        summary.stageLatency.stages.every(
          (row) => row.runType === TELEMETRY_RUN_TYPES.API_REQUEST,
        ),
      );
      assert.ok(
        summary.coverage.every(
          (row) => row.runType === TELEMETRY_RUN_TYPES.API_REQUEST,
        ),
      );
    });

    it("reports end to end latency per query class and run type", async () => {
      const rows = await aggregateRunLatencyByQueryClass({ correlationId });
      const apiRequests = rows.find(
        (row) =>
          row.runType === TELEMETRY_RUN_TYPES.API_REQUEST &&
          row.queryClass === QUERY_CLASSES.NOT_APPLICABLE,
      );

      assert.equal(apiRequests.runs, 3);
      assert.equal(apiRequests.avgMs, 20);

      // Run level latency still excludes cold runs wholesale: an end to end
      // figure that included a 6s recovery would not describe a warm request.
      assert.equal(
        rows.some((row) => row.runType === TELEMETRY_RUN_TYPES.STARTUP),
        false,
      );
    });

    it("assembles the summary from every aggregation", async () => {
      const summary = await getTelemetrySummary({ correlationId });

      assert.deepEqual(Object.keys(summary).sort(), [
        "coldStarts",
        "compute",
        "coverage",
        "ingestion",
        "runLatency",
        "stageLatency",
        "stageLatencyByQueryClass",
        "window",
      ]);

      assert.equal(summary.coldStarts.totals.runs, 7);
      assert.ok(summary.stageLatency.stages.every((row) => row.runType));
      assert.ok(summary.coverage.every((row) => row.runType));
    });
  },
);

// TENISE-30 acceptance criterion 6: aggregation across a set of queries produces
// per-class latency figures.
//
// Seeded under its own correlationId so the counts above stay untouched.
const queryCorrelationId = `itest:telemetry-per-class:${randomUUID()}`;

function queryRecord({
  queryClass,
  routingMs,
  generationMs,
  totalDurationMs,
  compute,
}) {
  return {
    recordId: randomUUID(),
    runType: TELEMETRY_RUN_TYPES.QUERY,
    correlationId: queryCorrelationId,
    queryClass,
    status: RUN_STATUSES.SUCCESS,
    startedAt,
    completedAt: startedAt,
    totalDurationMs,
    stages: pipelineStages({
      routing: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: routingMs,
        apiType: API_TYPES.LOCAL,
      },
      retrieval: { status: STAGE_STATUSES.SKIPPED, reason: "not_implemented" },
      generation: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: generationMs,
        apiType: API_TYPES.OLLAMA_GENERATION,
        apiCalls: 1,
        tokensIn: 100,
        tokensOut: 50,
      },
    }),
    tokens: { input: 100, output: 50 },
    compute,
  };
}

// Seconds are chosen to sum exactly in binary, so the assertions test the
// aggregation rather than floating point.
function seedQueryRecords() {
  return [
    queryRecord({
      queryClass: QUERY_CLASSES.STATISTICS,
      routingMs: 1,
      generationMs: 1000,
      totalDurationMs: 1010,
      compute: {
        ocuSeconds: 1.5,
        basis: "estimated",
        byResource: {
          ollama: { seconds: 1, ocu: 1, ocuSeconds: 1, calls: 1 },
          // Stands in for the retrieval compute TENISE-15/17 will report. The
          // split has to work before that lands, or the first real retrieval
          // figures arrive with nowhere to be attributed.
          qdrant: { seconds: 0.5, ocu: 1, ocuSeconds: 0.5, calls: 1 },
        },
      },
    }),
    queryRecord({
      queryClass: QUERY_CLASSES.STATISTICS,
      routingMs: 1,
      generationMs: 2000,
      totalDurationMs: 2010,
      compute: {
        ocuSeconds: 2.5,
        basis: "estimated",
        byResource: {
          ollama: { seconds: 2, ocu: 1, ocuSeconds: 2, calls: 1 },
          qdrant: { seconds: 0.5, ocu: 1, ocuSeconds: 0.5, calls: 1 },
        },
      },
    }),
    queryRecord({
      queryClass: QUERY_CLASSES.DOCUMENT,
      routingMs: 1,
      generationMs: 200,
      totalDurationMs: 210,
      compute: {
        ocuSeconds: 0.25,
        basis: "estimated",
        byResource: { ollama: { seconds: 0.25, ocu: 1, ocuSeconds: 0.25, calls: 1 } },
      },
    }),
    queryRecord({
      queryClass: QUERY_CLASSES.DOCUMENT,
      routingMs: 1,
      generationMs: 400,
      totalDurationMs: 410,
      compute: {
        ocuSeconds: 0.75,
        basis: "estimated",
        byResource: { ollama: { seconds: 0.75, ocu: 1, ocuSeconds: 0.75, calls: 1 } },
      },
    }),
  ];
}

// A Sprint 1 record: schemaVersion 1, written before the compute block existed.
// Inserted through the driver rather than the model so Mongoose does not helpfully
// apply the new defaults and turn it into a record that cannot reproduce the bug.
function legacyQueryRecord() {
  return {
    schemaVersion: 1,
    recordId: randomUUID(),
    runType: TELEMETRY_RUN_TYPES.QUERY,
    correlationId: queryCorrelationId,
    queryClass: QUERY_CLASSES.DOCUMENT,
    status: RUN_STATUSES.SUCCESS,
    startedAt,
    completedAt: startedAt,
    totalDurationMs: 460,
    stages: {
      routing: { status: STAGE_STATUSES.NOT_IMPLEMENTED },
      retrieval: { status: STAGE_STATUSES.NOT_IMPLEMENTED },
      rerank: { status: STAGE_STATUSES.NOT_IMPLEMENTED },
      generation: {
        status: STAGE_STATUSES.SUCCESS,
        durationMs: 450,
        apiType: API_TYPES.OLLAMA_GENERATION,
        apiCalls: 1,
        tokensIn: 100,
        tokensOut: 50,
      },
    },
    tokens: { input: 100, output: 50 },
    coldStart: { detected: false, count: 0, totalRecoveryMs: 0, events: [] },
  };
}

function findClassStage(rows, queryClass, stage) {
  return rows.find((row) => row.queryClass === queryClass && row.stage === stage);
}

describe(
  "per class query telemetry",
  { skip: mongoUri ? false : "MONGODB_URI is not set" },
  () => {
    before(async () => {
      await TelemetryRecord.insertMany(seedQueryRecords());
      await TelemetryRecord.collection.insertOne(legacyQueryRecord());
    });

    after(async () => {
      await TelemetryRecord.deleteMany({ correlationId: queryCorrelationId });
    });

    it("reports stage latency per class, so a bottleneck can be named within a class", async () => {
      const result = await aggregateStageLatency({
        correlationId: queryCorrelationId,
        byQueryClass: true,
      });

      assert.equal(result.byQueryClass, true);

      const statistics = findClassStage(
        result.stages,
        QUERY_CLASSES.STATISTICS,
        "generation",
      );
      const document = findClassStage(
        result.stages,
        QUERY_CLASSES.DOCUMENT,
        "generation",
      );

      assert.equal(statistics.samples, 2);
      assert.equal(statistics.avgMs, 1500);

      // Three: the two current records plus the schemaVersion 1 one.
      assert.equal(document.samples, 3);
      assert.equal(document.avgMs, 350);

      // Routing is measured separately and is nowhere near the bottleneck —
      // which is the statement a single end to end figure cannot make.
      const routing = findClassStage(result.stages, QUERY_CLASSES.STATISTICS, "routing");

      assert.equal(routing.samples, 2);
      assert.ok(routing.avgMs < statistics.avgMs);
    });

    it("blends the classes without the dimension, which is why it exists", async () => {
      const blended = await aggregateStageLatency({
        correlationId: queryCorrelationId,
      });

      const generation = findStage(
        blended.stages,
        TELEMETRY_RUN_TYPES.QUERY,
        "generation",
      );

      assert.equal(blended.byQueryClass, false);
      assert.equal(generation.samples, 5);

      // 810ms describes neither class.
      assert.equal(generation.avgMs, 810);
    });

    it("reports OCU-seconds and tokens per class alongside latency", async () => {
      const rows = await aggregateRunLatencyByQueryClass({
        correlationId: queryCorrelationId,
      });
      const byClass = Object.fromEntries(rows.map((row) => [row.queryClass, row]));

      assert.equal(byClass.statistics.runs, 2);
      assert.equal(byClass.statistics.ocuSeconds, 4);
      assert.equal(byClass.statistics.avgOcuSeconds, 2);
      assert.equal(byClass.statistics.tokensIn, 200);

      // The schemaVersion 1 record has no compute block. It must contribute
      // zero and still count as a run — without $ifNull it contributes null,
      // which blanks the whole group's sum and silently wipes the figure for
      // any window reaching back into Sprint 1.
      assert.equal(byClass.document.runs, 3);
      assert.equal(byClass.document.ocuSeconds, 1);
      assert.equal(byClass.document.tokensIn, 300);
    });

    it("splits OCU-seconds by the resource that consumed them", async () => {
      const rows = await aggregateComputeByResource({
        correlationId: queryCorrelationId,
      });

      const ollamaStatistics = rows.find(
        (row) => row.resource === "ollama" && row.queryClass === QUERY_CLASSES.STATISTICS,
      );
      const qdrantStatistics = rows.find(
        (row) => row.resource === "qdrant" && row.queryClass === QUERY_CLASSES.STATISTICS,
      );

      assert.equal(ollamaStatistics.ocuSeconds, 3);
      assert.equal(ollamaStatistics.runs, 2);
      assert.equal(ollamaStatistics.ocuSecondsPerRun, 1.5);

      // Generation dominates compute for this class. That attribution is the
      // point: a single per-query total could not make it.
      assert.equal(qdrantStatistics.ocuSeconds, 1);
      assert.ok(qdrantStatistics.ocuSeconds < ollamaStatistics.ocuSeconds);

      // The record with no compute block contributes no rows and breaks nothing.
      assert.equal(
        rows.some((row) => row.resource === undefined || row.resource === null),
        false,
      );
    });

    it("carries the per class stage figures through the summary", async () => {
      const summary = await getTelemetrySummary({
        correlationId: queryCorrelationId,
      });

      assert.equal(summary.stageLatencyByQueryClass.byQueryClass, true);
      assert.ok(
        summary.stageLatencyByQueryClass.stages.every((row) => row.queryClass),
      );
      assert.ok(summary.compute.length > 0);
    });
  },
);
