

import {
  analyseEvidence,
} from "../evidence/index.js";


/**
 * Remove duplicate retrieval results.
 *
 * A duplicate is identified by:
 * sourceId + chunkIndex
 *
 * @param {Object[]} results
 *
 * @returns {Object[]}
 */
export function removeDuplicateResults(
  results = []
) {
  if (!Array.isArray(results)) {
    throw new TypeError(
      "Retrieval results must be an array."
    );
  }

  const seen = new Set();

  return results.filter((result) => {
    const sourceId =
      result?.sourceId ||
      result?.payload?.sourceId ||
      "unknown-source";

    const chunkIndex =
      result?.chunkIndex ??
      result?.payload?.chunkIndex ??
      "unknown-chunk";

    const duplicateKey =
      `${sourceId}:${chunkIndex}`;

    if (seen.has(duplicateKey)) {
      return false;
    }

    seen.add(duplicateKey);

    return true;
  });
}

/**
 * Filter retrieval results by minimum score.
 *
 * @param {Object[]} results
 * @param {number} minimumScore
 *
 * @returns {Object[]}
 */
export function filterResultsByScore(
  results = [],
  minimumScore = 0.6
) {
  if (!Array.isArray(results)) {
    throw new TypeError(
      "Retrieval results must be an array."
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

  return results.filter(
    (result) =>
      typeof result?.score === "number" &&
      result.score >= minimumScore
  );
}




/**
 * Limit how many results can come from one module.
 *
 * Results must already be sorted from highest
 * similarity score to lowest.
 *
 * @param {Object} options
 * @param {Object[]} options.results
 * @param {number} [options.maxPerModule=3]
 *
 * @returns {Object[]}
 */
export function diversifyResultsByModule({
  results = [],
  maxPerModule = 3,
} = {}) {
  if (!Array.isArray(results)) {
    throw new TypeError(
      "Retrieval results must be an array."
    );
  }

  if (
    !Number.isInteger(maxPerModule) ||
    maxPerModule <= 0
  ) {
    throw new TypeError(
      "Maximum results per module must be a positive integer."
    );
  }

  const moduleCounts =
    new Map();

  return results.filter((result) => {
    const moduleKey =
      result?.moduleId ||
      "unknown-module";

    const currentCount =
      moduleCounts.get(moduleKey) || 0;

    if (
      currentCount >=
      maxPerModule
    ) {
      return false;
    }

    moduleCounts.set(
      moduleKey,
      currentCount + 1
    );

    return true;
  });
}


/**
 * Rank retrieval results for final evidence selection.
 *
 * Ranking flow:
 * 1. Remove results below the minimum similarity score.
 * 2. Remove duplicate chunks.
 * 3. Enrich evidence with confidence information.
 * 4. Sort by overall confidence.
 * 5. Use similarity score as a tie-breaker.
 * 6. Limit chunks from the same source.
 * 7. Limit chunks from the same module.
 * 8. Return the final requested number of results.
 *
 * @param {Object} options
 * @param {Object[]} options.results
 * @param {number} [options.minimumScore=0.6]
 * @param {number} [options.limit=5]
 * @param {number} [options.maxPerSource=2]
 *
 * @returns {Object[]}
 */
export function rankRetrievalResults({
  results = [],
  minimumScore = 0.6,
  limit = 5,
  maxPerSource = 2,
  maxPerModule = 3,
} = {}) {
  if (
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new TypeError(
      "Ranking limit must be a positive integer."
    );
  }

  if (
    !Number.isInteger(maxPerSource) ||
    maxPerSource <= 0
  ) {
    throw new TypeError(
      "Maximum results per source must be a positive integer."
    );
  }

  if (
    !Number.isInteger(maxPerModule) ||
    maxPerModule <= 0
  ) {
    throw new TypeError(
      "Maximum results per module must be a positive integer."
    );
  }

  const scoreFiltered =
    filterResultsByScore(
        results,
        minimumScore
    );

    const uniqueResults =
    removeDuplicateResults(
        scoreFiltered
    );

    const evidenceAnalysis =
     analyseEvidence({
        evidence:
         uniqueResults,
    });

    const confidenceEnriched =
     evidenceAnalysis.evidence;

    const sortedResults =
    [...confidenceEnriched].sort(
        (first, second) => {
        const firstConfidence =
            first?.confidence?.overall ??
            0;

        const secondConfidence =
            second?.confidence?.overall ??
            0;

        if (
            secondConfidence !==
            firstConfidence
        ) {
            return (
            secondConfidence -
            firstConfidence
            );
        }

        return (
            second.score -
            first.score
        );
        }
    );

  const sourceDiversified =
    diversifyResultsBySource({
      results:
        sortedResults,

      maxPerSource,
    });

  const moduleDiversified =
    diversifyResultsByModule({
      results:
        sourceDiversified,

      maxPerModule,
    });

  return moduleDiversified.slice(
    0,
    limit
  );
}


/**
 * Limit how many chunks can come from the same source.
 *
 * Results should already be sorted from highest score
 * to lowest score before this function is called.
 *  
 * @param {Object} options
 * @param {Object[]} options.results
 * @param {number} [options.maxPerSource=2]
 *
 * @returns {Object[]}
 */
export function diversifyResultsBySource({
  results = [],
  maxPerSource = 2,
} = {}) {
  if (!Array.isArray(results)) {
    throw new TypeError(
      "Retrieval results must be an array."
    );
  }

  if (
    !Number.isInteger(maxPerSource) ||
    maxPerSource <= 0
  ) {
    throw new TypeError(
      "Maximum results per source must be a positive integer."
    );
  }

  const sourceCounts = new Map();

  return results.filter((result) => {
    const sourceKey =
      result?.sourceId ||
      result?.documentTitle ||
      result?.pointId ||
      "unknown-source";

    const currentCount =
      sourceCounts.get(sourceKey) || 0;

    if (currentCount >= maxPerSource) {
      return false;
    }

    sourceCounts.set(
      sourceKey,
      currentCount + 1
    );

    return true;
  });
}