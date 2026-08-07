/**
 * Create a standardized evidence-consensus result.
 *
 * @param {Object} options
 * @param {number} [options.independentSources=0]
 * @param {number} [options.moduleCount=0]
 * @param {Object} [options.moduleDistribution={}]
 * @param {Object} [options.sourceTypeDistribution={}]
 * @param {string|null} [options.dominantModule=null]
 * @param {string|null} [options.dominantSourceType=null]
 * @param {"broad"|"moderate"|"narrow"|"none"} [options.coverage="none"]
 *
 * @returns {Object}
 */
export function createEvidenceConsensus({
  independentSources = 0,
  moduleCount = 0,
  moduleDistribution = {},
  sourceTypeDistribution = {},
  dominantModule = null,
  dominantSourceType = null,
  coverage = "none",
} = {}) {
  return Object.freeze({
    independentSources,
    moduleCount,
    moduleDistribution:
      Object.freeze({
        ...moduleDistribution,
      }),
    sourceTypeDistribution:
      Object.freeze({
        ...sourceTypeDistribution,
      }),
    dominantModule,
    dominantSourceType,
    coverage,
  });
}