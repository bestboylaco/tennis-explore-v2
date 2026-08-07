import {
  createEvidenceConfidence,
} from "./evidenceConfidence.types.js";

const SOURCE_TYPE_QUALITY = Object.freeze({
  research_paper: 0.9,
  ranking_data: 0.9,
  match_report: 0.8,
  player_report: 0.8,
  coach_interview: 0.75,
  conference_transcript: 0.75,
  internal_note: 0.65,
});

const DEFAULT_SOURCE_QUALITY = 0.6;

/**
 * Keep a numeric value between 0 and 1.
 *
 * @param {number} value
 * @returns {number}
 */
function clampScore(value) {
  return Math.min(
    1,
    Math.max(0, value)
  );
}

/**
 * Calculate metadata completeness for one
 * retrieval result.
 *
 * @param {Object} result
 * @returns {number}
 */
function calculateMetadataQuality(
  result
) {
  const requiredValues = [
    result?.sourceId,
    result?.sourceType,
    result?.documentTitle,
    result?.pointId,
    result?.text,
  ];

  const completedValues =
    requiredValues.filter((value) => {
      if (typeof value === "string") {
        return value.trim().length > 0;
      }

      return (
        value !== null &&
        value !== undefined
      );
    }).length;

  return (
    completedValues /
    requiredValues.length
  );
}

/**
 * Calculate source-type quality.
 *
 * This is an initial configurable heuristic,
 * not an academic quality assessment.
 *
 * @param {Object} result
 * @returns {number}
 */
function calculateSourceQuality(
  result
) {
  const sourceType =
    result?.sourceType ||
    result?.payload?.sourceType ||
    null;

  if (
    typeof sourceType !== "string" ||
    sourceType.trim().length === 0
  ) {
    return DEFAULT_SOURCE_QUALITY;
  }

  return (
    SOURCE_TYPE_QUALITY[
      sourceType.trim()
    ] ||
    DEFAULT_SOURCE_QUALITY
  );
}

/**
 * Calculate a warning penalty.
 *
 * @param {Object} result
 * @returns {{
 *   score: number,
 *   warnings: string[]
 * }}
 */
function calculateWarningQuality(
  result
) {
  const warnings =
    result?.metadata
      ?.validationWarnings ||
    result?.payload
      ?.metadata
      ?.validationWarnings ||
    [];

  if (!Array.isArray(warnings)) {
    return {
      score: 1,
      warnings: [],
    };
  }

  const normalisedWarnings =
    warnings.filter(
      (warning) =>
        typeof warning === "string" &&
        warning.trim().length > 0
    );

  const penalty =
    normalisedWarnings.length * 0.1;

  return {
    score:
      clampScore(1 - penalty),

    warnings:
      normalisedWarnings,
  };
}

/**
 * Add confidence information to one
 * retrieval result.
 *
 * @param {Object} result
 * @returns {Object}
 */
export function enrichEvidenceConfidence(
  result
) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    throw new TypeError(
      "A valid retrieval result is required."
    );
  }

  const similarity =
    typeof result.score === "number"
      ? clampScore(result.score)
      : 0;

  const metadataQuality =
    calculateMetadataQuality(
      result
    );

  const sourceQuality =
    calculateSourceQuality(
      result
    );

  const warningQuality =
    calculateWarningQuality(
      result
    );

  const overall =
    clampScore(
      similarity * 0.5 +
      metadataQuality * 0.2 +
      sourceQuality * 0.2 +
      warningQuality.score * 0.1
    );

  return {
    ...result,

    confidence:
        createEvidenceConfidence({
            overall:
            Number(overall.toFixed(4)),

            similarity:
            Number(similarity.toFixed(4)),

            metadataQuality:
            Number(metadataQuality.toFixed(4)),

            sourceQuality:
            Number(sourceQuality.toFixed(4)),

            warningQuality:
            Number(
                warningQuality.score.toFixed(4)
            ),

            warnings:
            warningQuality.warnings,
        }),
        };
}

/**
 * Add confidence information to multiple
 * retrieval results.
 *
 * @param {Object[]} results
 * @returns {Object[]}
 */
export function enrichEvidenceCollection(
  results = []
) {
  if (!Array.isArray(results)) {
    throw new TypeError(
      "Evidence results must be an array."
    );
  }

  return results.map(
    enrichEvidenceConfidence
  );
}