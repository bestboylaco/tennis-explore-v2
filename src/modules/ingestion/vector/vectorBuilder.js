
import { randomUUID } from "node:crypto";

/**
 * Build the vector payload for one pipeline chunk.
 *
 * @param {Object} pipeline
 * @param {Object} chunk
 *
 * @returns {import("./vector.types.js").VectorPayload}
 */
export function buildVectorPayload(pipeline, chunk) {
  const source = pipeline?.source || {};
  const document = pipeline?.document || {};
  const chunkMetadata = chunk?.metadata || {};

  return {
    sourceId:
      source.id?.toString?.() ||
      source._id?.toString?.() ||
      "",

    sourceType:
      source.sourceType ||
      document.semanticMetadata?.documentType ||
      null,

    documentTitle:
      source.title ||
      document.title ||
      null,

    sectionTitle:
      chunkMetadata.sectionTitle ||
      null,

    chunkIndex:
      Number.isInteger(chunk.index)
        ? chunk.index
        : 0,

    text:
      typeof chunk.text === "string"
        ? chunk.text
        : "",

    metadata: {
      chunkId:
        chunk.id ||
        null,

      originalFileName:
        source.file?.originalName ||
        null,

      mimeType:
        source.file?.mimeType ||
        null,

      s3Bucket:
        source.file?.bucket ||
        null,

      s3Key:
        source.file?.key ||
        null,

      language:
        document.technicalMetadata?.language ||
        null,

      documentType:
        document.semanticMetadata?.documentType ||
        null,

      pageNumber:
        chunkMetadata.pageNumber ??
        null,

      slideNumber:
        chunkMetadata.slideNumber ??
        null,

      players:
        document.domainMetadata?.players ||
        [],

      tournament:
        document.domainMetadata?.tournament ||
        null,

      round:
        document.domainMetadata?.round ||
        null,

      matchDate:
        document.domainMetadata?.matchDate ||
        null,

      winner:
        document.domainMetadata?.winner ||
        null,

      score:
        document.domainMetadata?.score ||
        null,

      characterCount:
        chunk.characterCount ??
        chunk.text?.length ??
        0,

      validationWarnings:
        chunkMetadata.validationWarnings ||
        [],
    },
  };
}

/**
 * Convert one embedded pipeline chunk into
 * a vector-store-compatible point.
 *
 * @param {Object} pipeline
 * @param {Object} chunk
 *
 * @returns {import("./vector.types.js").VectorPoint}
 */
export function buildVectorPoint(pipeline, chunk) {
  return {
    id: randomUUID(),

    vector:
      Array.isArray(chunk?.embedding?.vector)
        ? chunk.embedding.vector
        : [],

    payload:
      buildVectorPayload(
        pipeline,
        chunk
      ),
  };
}

/**
 * Convert all embedded pipeline chunks into
 * vector-store-compatible points.
 *
 * @param {Object} pipeline
 *
 * @returns {import("./vector.types.js").VectorPoint[]}
 */
export function buildVectorPoints(pipeline) {
  if (!pipeline || typeof pipeline !== "object") {
    throw new TypeError(
      "Pipeline must be an object."
    );
  }

  if (!Array.isArray(pipeline.chunks)) {
    throw new TypeError(
      "Pipeline chunks must be an array."
    );
  }

  return pipeline.chunks.map((chunk) =>
    buildVectorPoint(
      pipeline,
      chunk
    )
  );
}