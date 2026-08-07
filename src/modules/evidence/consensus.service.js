import {
  createEvidenceConsensus,
} from "./consensus.types.js";

/**
 * Count evidence items by a selected property.
 *
 * @param {Object[]} evidence
 * @param {(item: Object) => string|null} selector
 *
 * @returns {Object}
 */
function buildDistribution(
  evidence,
  selector
) {
  return evidence.reduce(
    (distribution, item) => {
      const key =
        selector(item);

      if (
        typeof key !== "string" ||
        key.trim().length === 0
      ) {
        return distribution;
      }

      const normalisedKey =
        key.trim();

      distribution[
        normalisedKey
      ] =
        (
          distribution[
            normalisedKey
          ] || 0
        ) + 1;

      return distribution;
    },
    {}
  );
}

/**
 * Find the key with the largest count.
 *
 * @param {Object} distribution
 * @returns {string|null}
 */
function findDominantValue(
  distribution
) {
  const entries =
    Object.entries(
      distribution
    );

  if (entries.length === 0) {
    return null;
  }

  return entries.reduce(
    (
      currentLeader,
      candidate
    ) =>
      candidate[1] >
      currentLeader[1]
        ? candidate
        : currentLeader
  )[0];
}

/**
 * Classify how broadly evidence is distributed.
 *
 * Version 1 uses structural breadth only.
 * It does not claim semantic agreement.
 *
 * @param {Object} options
 * @param {number} options.independentSources
 * @param {number} options.moduleCount
 *
 * @returns {"broad"|"moderate"|"narrow"|"none"}
 */
function classifyCoverage({
  independentSources,
  moduleCount,
}) {
  if (independentSources === 0) {
    return "none";
  }

  if (
    independentSources >= 4 &&
    moduleCount >= 2
  ) {
    return "broad";
  }

  if (
    independentSources >= 2
  ) {
    return "moderate";
  }

  return "narrow";
}

/**
 * Analyse the structural breadth of evidence.
 *
 * This version measures:
 * - independent source count
 * - module distribution
 * - source-type distribution
 * - dominant module and source type
 * - evidence coverage
 *
 * It does not yet detect semantic agreement
 * or contradiction.
 *
 * @param {Object} options
 * @param {Object[]} [options.evidence=[]]
 *
 * @returns {Object}
 */
export function analyseEvidenceConsensus({
  evidence = [],
} = {}) {
  if (!Array.isArray(evidence)) {
    throw new TypeError(
      "Evidence must be an array."
    );
  }

  const independentSourceIds =
    new Set(
      evidence
        .map(
          (item) =>
            item?.sourceId ||
            null
        )
        .filter(Boolean)
    );

  const moduleDistribution =
    buildDistribution(
      evidence,
      (item) =>
        item?.moduleId ||
        null
    );

  const sourceTypeDistribution =
    buildDistribution(
      evidence,
      (item) =>
        item?.sourceType ||
        null
    );

  const independentSources =
    independentSourceIds.size;

  const moduleCount =
    Object.keys(
      moduleDistribution
    ).length;

  return createEvidenceConsensus({
    independentSources,
    moduleCount,
    moduleDistribution,
    sourceTypeDistribution,

    dominantModule:
      findDominantValue(
        moduleDistribution
      ),

    dominantSourceType:
      findDominantValue(
        sourceTypeDistribution
      ),

    coverage:
      classifyCoverage({
        independentSources,
        moduleCount,
      }),
  });
}