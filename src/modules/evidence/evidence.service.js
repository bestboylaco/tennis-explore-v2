import {
  enrichEvidenceCollection,
} from "../retrieval/evidenceConfidence.service.js";

import {
  createEvidenceAnalysis,
} from "./evidence.types.js";

import {
  analyseEvidenceConsensus,
} from "./consensus.service.js";

/**
 * Build a summary from confidence-enriched evidence.
 *
 * @param {Object[]} evidence
 *
 * @returns {{
 *   overall: number,
 *   level: "high" | "moderate" | "low" | "unknown",
 *   evidenceCount: number,
 *   sourceCount: number,
 *   warningCount: number
 * }}
 */
export function buildEvidenceSummary(
  evidence = []
) {
  const confidenceScores =
    evidence
      .map(
        (item) =>
          item?.confidence?.overall
      )
      .filter(
        (score) =>
          typeof score === "number" &&
          Number.isFinite(score)
      );

  const warningCount =
    evidence.reduce(
      (total, item) => {
        const warnings =
          item?.confidence?.warnings;

        return (
          total +
          (Array.isArray(warnings)
            ? warnings.length
            : 0)
        );
      },
      0
    );

  const sourceIds =
    new Set(
      evidence
        .map(
          (item) =>
            item?.sourceId || null
        )
        .filter(Boolean)
    );

  if (
    confidenceScores.length === 0
  ) {
    return {
      overall: 0,
      level: "unknown",
      evidenceCount:
        evidence.length,
      sourceCount:
        sourceIds.size,
      warningCount,
    };
  }

  const averageConfidence =
    confidenceScores.reduce(
      (total, score) =>
        total + score,
      0
    ) /
    confidenceScores.length;

  const overall =
    Number(
      averageConfidence.toFixed(4)
    );

  let level = "low";

  if (overall >= 0.8) {
    level = "high";
  } else if (overall >= 0.6) {
    level = "moderate";
  }

  return {
    overall,
    level,
    evidenceCount:
      evidence.length,
    sourceCount:
      sourceIds.size,
    warningCount,
  };
}


/**
 * Analyse a collection of retrieved evidence.
 *
 * Current capabilities:
 * - evidence confidence enrichment
 *
 * Future capabilities:
 * - consensus analysis
 * - freshness analysis
 * - reliability analysis
 * - contradiction detection
 *
 * @param {Object} options
 * @param {Object[]} [options.evidence=[]]
 *
 * @returns {{
 *   evidence: Object[],
 *   summary: Object|null,
 *   totalEvidence: number
 * }}
 */

export function analyseEvidence({
  evidence = [],
} = {}) {
  if (!Array.isArray(evidence)) {
    throw new TypeError(
      "Evidence must be an array."
    );
  }

  const confidenceEnrichedEvidence =
    enrichEvidenceCollection(
      evidence
    );

  const summary =
    buildEvidenceSummary(
      confidenceEnrichedEvidence
    );

  const consensus =
    analyseEvidenceConsensus({
      evidence:
        confidenceEnrichedEvidence,
    });

  return createEvidenceAnalysis({
    evidence:
      confidenceEnrichedEvidence,

    summary,

    consensus,
  });
}