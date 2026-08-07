/**
 * Create a standardized evidence confidence object.
 *
 * @param {Object} options
 * @param {number} options.overall
 * @param {number} options.similarity
 * @param {number} options.metadataQuality
 * @param {number} options.sourceQuality
 * @param {number} options.warningQuality
 * @param {string[]} [options.warnings=[]]
 *
 * @returns {{
 *   overall:number,
 *   similarity:number,
 *   metadataQuality:number,
 *   sourceQuality:number,
 *   warningQuality:number,
 *   warnings:string[]
 * }}
 */
export function createEvidenceConfidence({
  overall = 0,
  similarity = 0,
  metadataQuality = 0,
  sourceQuality = 0,
  warningQuality = 0,
  warnings = [],
} = {}) {
  return Object.freeze({
    overall,
    similarity,
    metadataQuality,
    sourceQuality,
    warningQuality,
    warnings,
  });
}