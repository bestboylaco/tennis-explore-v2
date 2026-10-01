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

/*
 * Instrumented ingestion run (TENISE-26 / E6-20a).
 *
 * Current architecture:
 *
 * Source lifecycle: MongoDB Atlas
 * Extraction: local process
 * Chunking: local process
 * Embedding: local Ollama
 * Indexing: on-disk vector index + BM25
 *
 * No AWS service is required by this ingestion path.
 *
 * The actual ingestion implementation remains supplied by stage handlers.
 * A stage without a handler is recorded as skipped.
 */
const PIPELINE = [
    INGESTION_STAGES.EXTRACT,
    INGESTION_STAGES.CHUNK,
    INGESTION_STAGES.EMBED,
    INGESTION_STAGES.INDEX,
];

function toUsage(result = {}) {
    return {
        apiCalls:
            result.apiCalls ??
            0,

        documents:
            result.documents ??
            0,

        pages:
            result.pages ??
            0,

        assets:
            result.assets ??
            0,

        bytes:
            result.bytes ??
            0,

        tokensIn:
            result.tokensIn ??
            0,

        tokensOut:
            result.tokensOut ??
            0,

        chunks:
            result.chunks ??
            0,

        failures:
            result.failures ??
            0,
    };
}

export async function runIngestion(
    sourceId,
    {
        handlers =
        {},
    } = {},
) {
    const run =
        startTelemetryRun({
            runType:
                TELEMETRY_RUN_TYPES.INGESTION,

            queryClass:
                QUERY_CLASSES.NOT_APPLICABLE,

            correlationId:
                `ingestion:${sourceId}`,

            sourceId,
        });

    let source;

    try {
        /*
         * MongoDB Atlas is the only remote lifecycle dependency involved in this
         * orchestration layer, so it remains the only cold-start-aware resource.
         */
        source =
            await withColdStartDetection(
                run,
                {
                    resource:
                        COLD_START_RESOURCES.MONGODB,

                    stage:
                        INGESTION_STAGES.FETCH_SOURCE,
                },
                () =>
                    run.measureStage(
                        INGESTION_STAGES.FETCH_SOURCE,
                        () =>
                            Source.findOne({
                                _id:
                                    sourceId,

                                isActive:
                                    true,
                            }),
                        {
                            apiType:
                                API_TYPES.LOCAL,

                            apiCalls:
                                1,

                            itemsOut:
                                1,
                        },
                    ),
            );
    } catch (error) {
        run.fail(
            error,
        );

        await run.finish(
            RUN_STATUSES.FAILED,
        );

        throw error;
    }

    if (!source) {
        const error =
            new Error(
                "Source not found.",
            );

        error.code =
            "SOURCE_NOT_FOUND";

        error.statusCode =
            404;

        run.fail(
            error,
        );

        await run.finish(
            RUN_STATUSES.FAILED,
        );

        throw error;
    }

    run.setSource({
        sourceType:
            source.sourceType,
    });

    /*
     * The source is stored by the backend and its lifecycle is tracked in
     * MongoDB Atlas. The ingestion story itself uses local/backend storage.
     */
    run.recordApiUsage(
        API_TYPES.LOCAL,
        {
            documents:
                1,

            assets:
                1,

            apiCalls:
                0,
        },
    );

    try {
        await Source.updateOne(
            {
                _id:
                    source._id,
            },
            {
                processingStatus:
                    "processing",
            },
        );

        for (
            const stage of
            PIPELINE
        ) {
            const handler =
                handlers[stage];

            if (
                typeof handler !==
                "function"
            ) {
                run.skipStage(
                    stage,
                    "not_implemented",
                );

                continue;
            }

            const stageStartMs =
                Date.now();

            /*
             * The stage implementation is local from the platform's point of view:
             *
             * extract -> backend process
             * chunk   -> backend process
             * embed   -> local Ollama
             * index   -> data/index on disk
             *
             * Therefore it must not be attributed to legacy AWS API types.
             */
            const result =
                await run.measureStage(
                    stage,
                    () =>
                        handler({
                            source,
                            run,
                        }),
                    {
                        apiType:
                            API_TYPES.LOCAL,
                    },
                );

            run.recordApiUsage(
                API_TYPES.LOCAL,
                {
                    ...toUsage(
                        result,
                    ),

                    durationMs:
                        Date.now() -
                        stageStartMs,
                },
            );
        }

        const ranAnyStage =
            PIPELINE.some(
                (stage) =>
                    typeof handlers[
                    stage
                    ] ===
                    "function",
            );

        await Source.updateOne(
            {
                _id:
                    source._id,
            },
            {
                processingStatus:
                    ranAnyStage
                        ? "completed"
                        : "uploaded",
            },
        );

        const record =
            await run.finish(
                ranAnyStage
                    ? RUN_STATUSES.SUCCESS
                    : RUN_STATUSES.PARTIAL,
            );

        return {
            sourceId:
                String(
                    source._id,
                ),

            status:
                record.status,

            telemetryRecordId:
                record.recordId,

            durationMs:
                record.totalDurationMs,

            stages:
                Object.fromEntries(
                    Object.entries(
                        record.stages,
                    ).map(
                        ([
                            name,
                            stageResult,
                        ]) => [
                                name,

                                stageResult.status ??
                                STAGE_STATUSES.NOT_IMPLEMENTED,
                            ],
                    ),
                ),

            volume: {
                documents:
                    record.ingestion
                        .documentCount,

                pages:
                    record.ingestion
                        .pageCount,

                assets:
                    record.ingestion
                        .assetCount,

                /*
                 * Exposed explicitly because the PDF upload UI can display how many
                 * searchable chunks were added by the upload.
                 */
                chunks:
                    record.ingestion
                        .chunkCount ??
                    record.ingestion
                        .byApi
                        ?.[API_TYPES.LOCAL]
                        ?.chunks ??
                    0,

                byApi:
                    record.ingestion
                        .byApi,
            },

            coldStart:
                record.coldStart,
        };
    } catch (error) {
        await Source.updateOne(
            {
                _id:
                    source._id,
            },
            {
                processingStatus:
                    "failed",
            },
        );

        run.fail(
            error,
        );

        await run.finish(
            RUN_STATUSES.FAILED,
        );

        throw error;
    }
}