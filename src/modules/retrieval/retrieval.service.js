import {
  embedText,
} from "../ingestion/embedding/embedding.service.js";

import {
  searchVectorPoints,
} from "../../infrastructure/vector/vectorStore.service.js";

import {
  VECTOR_COLLECTION_NAME,
} from "../ingestion/vector/vector.types.js";

import {
  rankRetrievalResults,
} from "./ranking.service.js";

/**
 * Retrieve the most relevant stored chunks for a question.
 *
 * @param {Object} options
 * @param {string} options.question
 * @param {number} [options.limit=5]
 * @param {number} [options.minimumScore=0.6]
 * @param {string[]} [options.sourceTypes=[]]
 *
 * @returns {Promise<{
 *   question: string,
 *   embedding: {
 *     provider: string,
 *     model: string,
 *     dimensions: number
 *   },
 *   totalCandidates: number,
 *   totalResults: number,
 *   results: Object[]
 * }>}
 */
export async function retrieveRelevantChunks({
  question,
  limit = 5,
  minimumScore = 0.6,
  sourceTypes = [],
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Question must be a non-empty string."
    );
  }

  if (
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new TypeError(
      "Limit must be a positive integer."
    );
  }

  if (
    typeof minimumScore !== "number" ||
    minimumScore < 0 ||
    minimumScore > 1
  ) {
    throw new TypeError(
      "Minimum score must be between 0 and 1."
    );
  }

  if (!Array.isArray(sourceTypes)) {
    throw new TypeError(
      "Source types must be an array."
    );
  }

  const hasInvalidSourceType =
    sourceTypes.some(
      (sourceType) =>
        typeof sourceType !== "string" ||
        sourceType.trim().length === 0
    );

  if (hasInvalidSourceType) {
    throw new TypeError(
      "Every source type must be a non-empty string."
    );
  }

  const normalisedSourceTypes =
    sourceTypes.map(
      (sourceType) =>
        sourceType.trim()
    );

  const normalisedQuestion =
    question.trim();

  const questionEmbedding =
    await embedText(
      normalisedQuestion
    );

  /*
   * Retrieve more candidates than the final result limit.
   * This gives the ranking layer enough results to filter
   * weak scores and remove duplicates.
   */
  const candidateLimit =
    Math.max(limit * 4, 20);

  const searchResults =
    await searchVectorPoints({
      collectionName:
        VECTOR_COLLECTION_NAME,

      queryVector:
        questionEmbedding.vector,

      limit:
        candidateLimit,

      sourceTypes:
        normalisedSourceTypes,
    });

  const candidates =
    searchResults.map((result) => ({
      pointId:
        result.id,

      score:
        result.score,

      text:
        result.payload?.text ||
        "",

      sourceId:
        result.payload?.sourceId ||
        null,

      sourceType:
        result.payload?.sourceType ||
        null,

      documentTitle:
        result.payload?.documentTitle ||
        null,

      sectionTitle:
        result.payload?.sectionTitle ||
        null,

      chunkIndex:
        result.payload?.chunkIndex ??
        null,

      metadata:
        result.payload?.metadata ||
        {},
    }));

  const rankedResults =
    rankRetrievalResults({
      results:
        candidates,

      minimumScore,

      limit,

      maxPerSource: 2,
    });

  return {
    question:
      normalisedQuestion,

    embedding: {
      provider:
        questionEmbedding.provider,

      model:
        questionEmbedding.model,

      dimensions:
        questionEmbedding.dimensions,
    },

    totalCandidates:
      candidates.length,

    totalResults:
      rankedResults.length,

    results:
      rankedResults,
  };
}