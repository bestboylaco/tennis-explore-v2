
import {
  retrieveRelevantChunks,
} from "../../retrieval/retrieval.service.js";


/**
 * Validate the common input used by retrievers.
 *
 * Every retriever should accept the same basic contract:
 *
 * {
 *   question,
 *   sourceTypes,
 *   candidateLimit
 * }
 *
 * @param {Object} options
 * @param {string} options.question
 * @param {string[]} options.sourceTypes
 * @param {number} options.candidateLimit
 *
 * @returns {{
 *   question: string,
 *   sourceTypes: string[],
 *   candidateLimit: number
 * }}
 */
export function validateRetrieverInput({
  question,
  sourceTypes = [],
  candidateLimit = 10,
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Retriever question must be a non-empty string."
    );
  }

  if (!Array.isArray(sourceTypes)) {
    throw new TypeError(
      "Retriever source types must be an array."
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
      "Every retriever source type must be a non-empty string."
    );
  }

  if (
    !Number.isInteger(candidateLimit) ||
    candidateLimit <= 0
  ) {
    throw new TypeError(
      "Retriever candidate limit must be a positive integer."
    );
  }

  return {
    question:
      question.trim(),

    sourceTypes:
      sourceTypes.map(
        (sourceType) =>
          sourceType.trim()
      ),

    candidateLimit,
  };
}

/**
 * Build a consistent retriever result.
 *
 * Every specialized retriever should return this shape.
 *
 * @param {Object} options
 * @param {string} options.moduleId
 * @param {Object[]} options.results
 *
 * @returns {{
 *   moduleId: string,
 *   totalResults: number,
 *   results: Object[]
 * }}
 */
export function buildRetrieverResult({
  moduleId,
  results = [],
} = {}) {
  if (
    typeof moduleId !== "string" ||
    moduleId.trim().length === 0
  ) {
    throw new TypeError(
      "Retriever module ID must be a non-empty string."
    );
  }

  if (!Array.isArray(results)) {
    throw new TypeError(
      "Retriever results must be an array."
    );
  }

  return {
    moduleId:
      moduleId.trim(),

    totalResults:
      results.length,

    results,
  };
}

/**
 * Create a generic knowledge retriever for a module.
 *
 * The retrieval plan supplies the relevant source types
 * and candidate limit at execution time.
 *
 * @param {Object} options
 * @param {string} options.moduleId
 *
 * @returns {(options?: Object) => Promise<Object>}
 */
export function createKnowledgeRetriever({
  moduleId,
} = {}) {
  if (
    typeof moduleId !== "string" ||
    moduleId.trim().length === 0
  ) {
    throw new TypeError(
      "A valid module ID is required to create a retriever."
    );
  }

  const normalisedModuleId =
    moduleId.trim();

  return async function retrieveKnowledge(
    options = {}
  ) {
    const input =
      validateRetrieverInput(
        options
      );

    const retrieval =
      await retrieveRelevantChunks({
        question:
          input.question,

        limit:
          input.candidateLimit,

        sourceTypes:
          input.sourceTypes,
      });

    return buildRetrieverResult({
      moduleId:
        normalisedModuleId,

      results:
        retrieval.results,
    });
  };
}