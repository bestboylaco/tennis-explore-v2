export const PERSON_VISIBILITY_CONFIG =
  Object.freeze({
    // Keep confidence conservative for now.
    minConfidence:
      0.5,

    // Provisional threshold from our real-frame calibration.
    minCoverage:
      0.12,
  });