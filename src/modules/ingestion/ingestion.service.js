import fs from "fs/promises";
import os from "os";
import path from "path";

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

import {
  extractTextFromFile,
} from "./extraction.service.js";

import {
  enrichMetadata,
} from "./metadata.service.js";

import {
  createPipelineDocument,
} from "./pipeline.types.js";

import {
  updateSourceProcessingStatus,
} from "../sources/services/source.service.js";

import {
  chunkDocument,
} from "./chunking/chunking.service.js";

import {
  embedPipelineChunks,
} from "./embedding/embedding.service.js";

import {
  storePipelineVectors,
} from "./vector/vector.service.js";

import {
  downloadFile,
} from "../../infrastructure/storage/index.js";

import {
  PROCESSING_STATUSES,
} from "../../shared/constants/processingStatuses.js";


/*
 * ============================================================
 * TELEMETRY-AWARE INGESTION ORCHESTRATOR
 * ============================================================
 */

const PIPELINE = [
  {
    stage: INGESTION_STAGES.EXTRACT,
    apiType: API_TYPES.TEXTRACT,
  },
  {
    stage: INGESTION_STAGES.CHUNK,
    apiType: API_TYPES.BEDROCK_KNOWLEDGE_BASE,
  },
  {
    stage: INGESTION_STAGES.EMBED,
    apiType: API_TYPES.BEDROCK_EMBEDDING,
  },
  {
    stage: INGESTION_STAGES.INDEX,
    apiType: API_TYPES.OPENSEARCH,
  },
];

const COLD_START_RESOURCE_BY_STAGE = {
  [INGESTION_STAGES.INDEX]:
    COLD_START_RESOURCES.OPENSEARCH,

  [INGESTION_STAGES.CHUNK]:
    COLD_START_RESOURCES.BEDROCK_RUNTIME,

  [INGESTION_STAGES.EMBED]:
    COLD_START_RESOURCES.BEDROCK_RUNTIME,
};

function toUsage(result = {}) {
  return {
    apiCalls:
      result.apiCalls ?? 1,

    documents:
      result.documents ?? 0,

    pages:
      result.pages ?? 0,

    assets:
      result.assets ?? 0,

    bytes:
      result.bytes ?? 0,

    tokensIn:
      result.tokensIn ?? 0,

    tokensOut:
      result.tokensOut ?? 0,

    chunks:
      result.chunks ?? 0,

    failures:
      result.failures ?? 0,
  };
}


/**
 * Run telemetry-aware ingestion.
 *
 * Individual ingestion stages can be supplied as handlers.
 */
export async function runIngestion(
  sourceId,
  {
    handlers = {},
  } = {}
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
                _id: sourceId,
                isActive: true,
              }),
            {
              apiType:
                API_TYPES.LOCAL,

              apiCalls:
                1,

              itemsOut:
                1,
            }
          )
      );
  } catch (error) {
    run.fail(error);

    await run.finish(
      RUN_STATUSES.FAILED
    );

    throw error;
  }

  if (!source) {
    const error =
      new Error(
        "Source not found."
      );

    error.code =
      "SOURCE_NOT_FOUND";

    error.statusCode =
      404;

    run.fail(error);

    await run.finish(
      RUN_STATUSES.FAILED
    );

    throw error;
  }

  run.setSource({
    sourceType:
      source.sourceType,
  });

  run.recordApiUsage(
    API_TYPES.LOCAL,
    {
      documents: 1,
      assets: 1,
      apiCalls: 0,
    }
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
      }
    );

    for (
      const {
        stage,
        apiType,
      } of PIPELINE
    ) {
      const handler =
        handlers[stage];

      if (
        typeof handler !==
        "function"
      ) {
        run.skipStage(
          stage,
          "not_implemented"
        );

        run.recordApiUsage(
          apiType,
          {
            apiCalls: 0,
          }
        );

        continue;
      }

      const coldStartResource =
        COLD_START_RESOURCE_BY_STAGE[
          stage
        ];

      const result =
        await withColdStartDetection(
          run,
          {
            resource:
              coldStartResource,

            stage,
          },
          () =>
            run.measureStage(
              stage,
              () =>
                handler({
                  source,
                  run,
                }),
              {
                apiType,
              }
            )
        );

      run.recordApiUsage(
        apiType,
        toUsage(result)
      );
    }

    const ranAnyStage =
      PIPELINE.some(
        ({
          stage,
        }) =>
          typeof handlers[
            stage
          ] === "function"
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
      }
    );

    const record =
      await run.finish(
        ranAnyStage
          ? RUN_STATUSES.SUCCESS
          : RUN_STATUSES.PARTIAL
      );

    return {
      sourceId:
        String(source._id),

      status:
        record.status,

      telemetryRecordId:
        record.recordId,

      durationMs:
        record.totalDurationMs,

      stages:
        Object.fromEntries(
          Object.entries(
            record.stages
          ).map(
            ([
              name,
              stage,
            ]) => [
              name,
              stage.status ??
                STAGE_STATUSES.NOT_IMPLEMENTED,
            ]
          )
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
      }
    );

    run.fail(error);

    await run.finish(
      RUN_STATUSES.FAILED
    );

    throw error;
  }
}


/*
 * ============================================================
 * ACTUAL S3 INGESTION PIPELINE
 * ============================================================
 */

/**
 * Ingest a source whose original file is stored in S3.
 *
 * Workflow:
 * 1. Mark source as processing.
 * 2. Download the S3 object.
 * 3. Write it to a temporary local file.
 * 4. Extract and process its content.
 * 5. Generate metadata.
 * 6. Chunk the document.
 * 7. Generate embeddings.
 * 8. Store vectors.
 * 9. Delete the temporary file.
 *
 * @param {Object} source
 * @returns {Promise<Object>}
 */
export async function ingestUploadedSource(
  source
) {
  const pipeline =
    createPipelineDocument(
      source
    );

  const sourceId =
    pipeline.source.id;

  let temporaryDirectory =
    null;

  try {
    await updateSourceProcessingStatus(
      sourceId,
      PROCESSING_STATUSES.PROCESSING
    );

    if (
      !source?.file?.key ||
      typeof source.file.key !==
        "string"
    ) {
      throw new Error(
        "The source does not contain a valid S3 storage key."
      );
    }

    if (
      !source?.file?.originalName ||
      typeof source.file
        .originalName !==
        "string"
    ) {
      throw new Error(
        "The source does not contain an original file name."
      );
    }

    /*
     * Download original file from S3.
     */
    const downloadedFile =
      await downloadFile({
        storageKey:
          source.file.key,
      });

    console.log(
      "✅ S3 download completed"
    );

    /*
     * Create temporary working directory.
     */
    temporaryDirectory =
      await fs.mkdtemp(
        path.join(
          os.tmpdir(),
          "tennis-explore-"
        )
      );

    const extension =
      path
        .extname(
          source.file.originalName
        )
        .toLowerCase();

    const temporaryFilePath =
      path.join(
        temporaryDirectory,
        `source${extension}`
      );

    /*
     * Write S3 buffer to temporary disk location.
     */
    await fs.writeFile(
      temporaryFilePath,
      downloadedFile.fileBuffer
    );

    const extractionFile = {
      path:
        temporaryFilePath,

      originalname:
        source.file.originalName,

      mimetype:
        source.file.mimeType ||
        downloadedFile.contentType ||
        "application/octet-stream",

      size:
        source.file.size ||
        downloadedFile.contentLength ||
        downloadedFile.fileBuffer.length,
    };

    /*
     * Extraction
     */
    const extractionResult =
      await extractTextFromFile(
        extractionFile
      );

    pipeline.document = {
      text:
        extractionResult.text,

      characterCount:
        extractionResult
          .characterCount,

      technicalMetadata: {
        language:
          null,

        characterCount:
          extractionResult
            .characterCount,

        wordCount:
          0,

        estimatedReadingTimeMinutes:
          0,

        extractedAt:
          new Date(),

        metadataGeneratedAt:
          null,
      },

      structuralMetadata:
        null,

      domainMetadata:
        null,

      domainValidation:
        null,

      semanticMetadata: {
        documentType:
          pipeline.source
            .sourceType,

        mentionedPlayers:
          [],

        detectedTopics:
          [],

        confidence:
          null,
      },
    };

    console.log(
      "✅ Extraction completed"
    );

    /*
     * Metadata enrichment
     */
    enrichMetadata(
      pipeline
    );

    console.log(
      "✅ Metadata completed"
    );

    /*
     * Chunking
     */
    chunkDocument(
      pipeline
    );

    console.log(
      `✅ Chunking completed: ${pipeline.chunks.length} chunks`
    );

    /*
     * Embeddings
     */
    await embedPipelineChunks(
      pipeline
    );

    console.log(
      `✅ Embedding completed: ${pipeline.chunks.length} chunks`
    );

    /*
     * Vector storage
     */
    const vectorStorage =
      await storePipelineVectors(
        pipeline
      );

    console.log(
      "✅ Vector storage result:",
      vectorStorage
    );

    pipeline.vectorStorage =
      vectorStorage;

    /*
     * Complete source lifecycle.
     */
    await updateSourceProcessingStatus(
      sourceId,
      PROCESSING_STATUSES.COMPLETED
    );

    pipeline.source
      .processingStatus =
      PROCESSING_STATUSES.COMPLETED;

    return pipeline;
  } catch (error) {
    pipeline.source
      .processingStatus =
      PROCESSING_STATUSES.FAILED;

    try {
      await updateSourceProcessingStatus(
        sourceId,
        PROCESSING_STATUSES.FAILED
      );
    } catch (statusError) {
      console.error(
        "Failed to update source processing status:",
        statusError
      );
    }

    throw error;
  } finally {
    /*
     * Always clean up temporary files.
     */
    if (
      temporaryDirectory
    ) {
      try {
        await fs.rm(
          temporaryDirectory,
          {
            recursive: true,
            force: true,
          }
        );

        console.log(
          "✅ Temporary ingestion file removed"
        );
      } catch (
        cleanupError
      ) {
        console.error(
          "Failed to remove temporary ingestion file:",
          cleanupError
        );
      }
    }
  }
}