import {
  EXPECTED_VECTOR_DIMENSIONS,
  VECTOR_COLLECTION_NAME,
  VECTOR_STORAGE_PROVIDER,
} from "./vector.types.js";

import {
  buildVectorPoints,
} from "./vectorBuilder.js";

import {
  validateVectorPoint,
  validateVectorPoints,
} from "./vectorValidator.js";

import {
  ensureVectorCollection,
  storeVectorPoints,
} from "../../../infrastructure/vector/vectorStore.service.js";

/**
 * Store the embedded chunks from one ingestion pipeline
 * in the configured vector database.
 *
 * Flow:
 *
 * Pipeline
 *   ↓
 * Build Qdrant-ready points
 *   ↓
 * Validate points
 *   ↓
 * Ensure collection exists
 *   ↓
 * Store valid points
 *   ↓
 * Return storage summary
 *
 * Invalid chunks are rejected without preventing valid chunks
 * from being stored.
 *
 * @param {Object} pipeline
 *
 * @returns {Promise<{
 *   success: boolean,
 *   provider: string,
 *   collection: string,
 *   operation: string,
 *   totalRequested: number,
 *   totalValid: number,
 *   totalRejected: number,
 *   totalStored: number,
 *   warnings: Array<Object>,
 *   failures: Array<Object>
 * }>}
 */
export async function storePipelineVectors(
  pipeline
) {
  if (!pipeline || typeof pipeline !== "object") {
    throw new TypeError(
      "Pipeline must be a valid object."
    );
  }

  if (!Array.isArray(pipeline.chunks)) {
    throw new TypeError(
      "Pipeline chunks must be an array."
    );
  }

  const points =
    buildVectorPoints(pipeline);

  const validation =
    validateVectorPoints(points);

  const warnings =
    collectVectorWarnings(
      validation.validPoints
    );

  const failures =
    validation.rejectedPoints.map(
      (rejected) => ({
        index: rejected.index,

        pointId:
          rejected.point?.id ||
          null,

        errors:
          rejected.validation?.errors ||
          [],

        warnings:
          rejected.validation?.warnings ||
          [],
      })
    );

  /*
   * If no valid vector points remain, do not contact Qdrant.
   *
   * This prevents empty or fully invalid documents from being
   * incorrectly reported as successfully indexed.
   */
  if (validation.totalValid === 0) {
    return {
      success: false,
      provider:
        VECTOR_STORAGE_PROVIDER.QDRANT,

      collection:
        VECTOR_COLLECTION_NAME,

      operation:
        "upsert",

      totalRequested:
        validation.totalRequested,

      totalValid: 0,

      totalRejected:
        validation.totalRejected,

      totalStored: 0,

      warnings,

      failures,
    };
  }

  await ensureVectorCollection(
    VECTOR_COLLECTION_NAME,
    EXPECTED_VECTOR_DIMENSIONS
  );

  const storageResult =
    await storeVectorPoints(
      VECTOR_COLLECTION_NAME,
      validation.validPoints
    );

  return {
    success:
      storageResult.totalStored ===
      validation.totalValid,

    provider:
      VECTOR_STORAGE_PROVIDER.QDRANT,

    collection:
      VECTOR_COLLECTION_NAME,

    operation:
      "upsert",

    totalRequested:
      validation.totalRequested,

    totalValid:
      validation.totalValid,

    totalRejected:
      validation.totalRejected,

    totalStored:
      storageResult.totalStored,

    warnings,

    failures,
  };
}

/**
 * Collect warnings from otherwise valid vector points.
 *
 * A point may be valid enough to store while still containing
 * non-blocking warnings, such as a missing section title.
 *
 * @param {Object[]} points
 *
 * @returns {Array<{
 *   index: number,
 *   pointId: string|null,
 *   warnings: string[]
 * }>}
 */
function collectVectorWarnings(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  const warnings = [];

  points.forEach((point, index) => {
    const validation =
      validateVectorPoint(point);

    if (validation.warnings.length === 0) {
      return;
    }

    warnings.push({
      index,

      pointId:
        point?.id ||
        null,

      warnings:
        validation.warnings,
    });
  });

  return warnings;
}



