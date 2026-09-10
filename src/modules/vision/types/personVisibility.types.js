function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}


/*
 * Stable result returned by any future
 * person-detection provider.
 */
export function createPersonVisibilityResult({
  detected,

  personCount,

  maxCoverage,

  sufficientVisibility,
} = {}) {
  if (typeof detected !== "boolean") {
    throw new TypeError(
      "detected must be a boolean.",
    );
  }


  if (
    !Number.isInteger(personCount) ||
    personCount < 0
  ) {
    throw new TypeError(
      "personCount must be a non-negative integer.",
    );
  }


  if (
    !isFiniteNumber(maxCoverage) ||
    maxCoverage < 0 ||
    maxCoverage > 1
  ) {
    throw new TypeError(
      "maxCoverage must be between 0 and 1.",
    );
  }


  if (
    typeof sufficientVisibility !==
    "boolean"
  ) {
    throw new TypeError(
      "sufficientVisibility must be a boolean.",
    );
  }


  /*
   * Keep the fields internally consistent.
   */
  if (
    !detected &&
    personCount !== 0
  ) {
    throw new TypeError(
      "personCount must be 0 when no person is detected.",
    );
  }


  if (
    !detected &&
    maxCoverage !== 0
  ) {
    throw new TypeError(
      "maxCoverage must be 0 when no person is detected.",
    );
  }


  if (
    sufficientVisibility &&
    !detected
  ) {
    throw new TypeError(
      "sufficientVisibility cannot be true when no person is detected.",
    );
  }


  return {
    detected,

    personCount,

    maxCoverage,

    sufficientVisibility,
  };
}