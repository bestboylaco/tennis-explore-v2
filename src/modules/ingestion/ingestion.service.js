import {
  API_TYPES,
  COLD_START_RESOURCES,
  INGESTION_STAGES,
  QUERY_CLASSES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "../../shared/constants/telemetry.js";
import {
  startTelemetryRun,
  withColdStartDetection,
} from "../telemetry/services/telemetryRecorder.service.js";
import Source from "../sources/models/source.model.js";

// Instrumented ingestion run (TENISE-26 / E6-20a).
//
// The extraction, chunking, embedding and indexing services are stubs owned by
// Epic 2 stories. This orchestrator measures each of those stages and updates
// the source lifecycle; it deliberately does not implement them. A stage with
// no handler is recorded as skipped, so the telemetry says which parts of the
// pipeline exist rather than implying they ran.
//
// When a stage lands, its story registers a handler here and its counts flow
// into telemetry with no change to the record structure.

const PIPELINE = [
  { stage: INGESTION_STAGES.EXTRACT, apiType: API_TYPES.TEXTRACT },
  { stage: INGESTION_STAGES.CHUNK, apiType: API_TYPES.BEDROCK_KNOWLEDGE_BASE },
  { stage: INGESTION_STAGES.EMBED, apiType: API_TYPES.BEDROCK_EMBEDDING },
  { stage: INGESTION_STAGES.INDEX, apiType: API_TYPES.OPENSEARCH },
];

// Stages that talk to a resource which can cold start.
const COLD_START_RESOURCE_BY_STAGE = {
  [INGESTION_STAGES.INDEX]: COLD_START_RESOURCES.OPENSEARCH,
  [INGESTION_STAGES.CHUNK]: COLD_START_RESOURCES.BEDROCK_RUNTIME,
  [INGESTION_STAGES.EMBED]: COLD_START_RESOURCES.BEDROCK_RUNTIME,
};

function toUsage(result = {}) {
  return {
    apiCalls: result.apiCalls ?? 1,
    documents: result.documents ?? 0,
    pages: result.pages ?? 0,
    assets: result.assets ?? 0,
    bytes: result.bytes ?? 0,
    tokensIn: result.tokensIn ?? 0,
    tokensOut: result.tokensOut ?? 0,
    chunks: result.chunks ?? 0,
    failures: result.failures ?? 0,
  };
}

export async function runIngestion(sourceId, { handlers = {} } = {}) {
  const run = startTelemetryRun({
    runType: TELEMETRY_RUN_TYPES.INGESTION,
    // Ingestion is not a query, but the class tag is present on every record so
    // aggregation by class never needs a backfill.
    queryClass: QUERY_CLASSES.NOT_APPLICABLE,
    correlationId: `ingestion:${sourceId}`,
    sourceId,
  });

  let source;

  try {
    source = await withColdStartDetection(
      run,
      {
        resource: COLD_START_RESOURCES.MONGODB,
        stage: INGESTION_STAGES.FETCH_SOURCE,
      },
      () =>
        run.measureStage(
          INGESTION_STAGES.FETCH_SOURCE,
          () => Source.findOne({ _id: sourceId, isActive: true }),
          { apiType: API_TYPES.LOCAL, apiCalls: 1, itemsOut: 1 },
        ),
    );
  } catch (error) {
    run.fail(error);
    await run.finish(RUN_STATUSES.FAILED);
    throw error;
  }

  if (!source) {
    const error = new Error("Source not found.");

    error.code = "SOURCE_NOT_FOUND";
    error.statusCode = 404;

    run.fail(error);
    await run.finish(RUN_STATUSES.FAILED);

    throw error;
  }

  run.setSource({ sourceType: source.sourceType });

  // The source document itself is one asset, counted against the store it
  // currently lives in. It moves to the s3 key once uploads are wired.
  run.recordApiUsage(API_TYPES.LOCAL, { documents: 1, assets: 1, apiCalls: 0 });

  try {
    await Source.updateOne(
      { _id: source._id },
      { processingStatus: "processing" },
    );

    for (const { stage, apiType } of PIPELINE) {
      const handler = handlers[stage];

      if (typeof handler !== "function") {
        run.skipStage(stage, "not_implemented");

        // The API key exists with zero volume, so a report shows which billed
        // APIs are wired without inventing usage that did not happen.
        run.recordApiUsage(apiType, { apiCalls: 0 });
        continue;
      }

      const coldStartResource = COLD_START_RESOURCE_BY_STAGE[stage];

      const result = await withColdStartDetection(
        run,
        { resource: coldStartResource, stage },
        () =>
          run.measureStage(stage, () => handler({ source, run }), { apiType }),
      );

      run.recordApiUsage(apiType, toUsage(result));
    }

    const ranAnyStage = PIPELINE.some(
      ({ stage }) => typeof handlers[stage] === "function",
    );

    await Source.updateOne(
      { _id: source._id },
      { processingStatus: ranAnyStage ? "completed" : "uploaded" },
    );

    const record = await run.finish(
      ranAnyStage ? RUN_STATUSES.SUCCESS : RUN_STATUSES.PARTIAL,
    );

    return {
      sourceId: String(source._id),
      status: record.status,
      telemetryRecordId: record.recordId,
      durationMs: record.totalDurationMs,
      stages: Object.fromEntries(
        Object.entries(record.stages).map(([name, stage]) => [
          name,
          stage.status ?? STAGE_STATUSES.NOT_IMPLEMENTED,
        ]),
      ),
      volume: {
        documents: record.ingestion.documentCount,
        pages: record.ingestion.pageCount,
        assets: record.ingestion.assetCount,
        byApi: record.ingestion.byApi,
      },
      coldStart: record.coldStart,
    };
  } catch (error) {
    await Source.updateOne({ _id: source._id }, { processingStatus: "failed" });

    run.fail(error);
    await run.finish(RUN_STATUSES.FAILED);

    throw error;
  }
}
