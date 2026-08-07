/**
 * Create a standardized evidence-analysis result.
 *
 * @param {Object} options
 * @param {Object[]} [options.evidence=[]]
 * @param {Object|null} [options.summary=null]
 * @param {Object|null} [options.consensus=null]
 *
 * @returns {{
 *   evidence: Object[],
 *   summary: Object|null,
 *   consensus: Object|null,
 *   totalEvidence: number
 * }}
 */
export function createEvidenceAnalysis({
  evidence = [],
  summary = null,
  consensus = null,
} = {}) {
  if (!Array.isArray(evidence)) {
    throw new TypeError(
      "Evidence must be an array."
    );
  }

  return Object.freeze({
    evidence,
    summary,
    consensus,

    totalEvidence:
      evidence.length,
  });
}