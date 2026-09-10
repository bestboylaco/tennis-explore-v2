import {
  createPersonVisibilityResult,
} from "../types/personVisibility.types.js";

import {
  PERSON_VISIBILITY_CONFIG,
} from "../config/personVisibility.config.js";


function isFinitePositiveNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
}


// Calculate how much of the frame a person occupies.
function calculateCoverage(
  box,
  imageWidth,
  imageHeight,
) {
  if (
    !box ||
    !isFinitePositiveNumber(box.width) ||
    !isFinitePositiveNumber(box.height)
  ) {
    return 0;
  }

  const frameArea =
    imageWidth *
    imageHeight;

  const boxArea =
    box.width *
    box.height;

  return Math.min(
    boxArea / frameArea,
    1,
  );
}


// Convert detector output into visibility information.
export function evaluatePersonVisibility({
  detections = [],

  imageWidth,

  imageHeight,

  minConfidence =
  PERSON_VISIBILITY_CONFIG.minConfidence,

  minCoverage =
  PERSON_VISIBILITY_CONFIG.minCoverage,
} = {}) {
  if (!Array.isArray(detections)) {
    throw new TypeError(
      "detections must be an array.",
    );
  }


  if (
    !isFinitePositiveNumber(imageWidth) ||
    !isFinitePositiveNumber(imageHeight)
  ) {
    throw new TypeError(
      "imageWidth and imageHeight must be positive numbers.",
    );
  }


  if (
    typeof minConfidence !== "number" ||
    minConfidence < 0 ||
    minConfidence > 1
  ) {
    throw new TypeError(
      "minConfidence must be between 0 and 1.",
    );
  }


  if (
    typeof minCoverage !== "number" ||
    minCoverage < 0 ||
    minCoverage > 1
  ) {
    throw new TypeError(
      "minCoverage must be between 0 and 1.",
    );
  }


  // Keep confident person detections only.
  const people =
    detections.filter(
      (detection) =>
        detection?.label === "person" &&
        typeof detection?.confidence === "number" &&
        detection.confidence >= minConfidence,
    );


  if (people.length === 0) {
    return createPersonVisibilityResult({
      detected:
        false,

      personCount:
        0,

      maxCoverage:
        0,

      sufficientVisibility:
        false,
    });
  }


  const coverages =
    people.map(
      (person) =>
        calculateCoverage(
          person.box,
          imageWidth,
          imageHeight,
        ),
    );


  const maxCoverage =
    Math.max(
      ...coverages,
    );


  return createPersonVisibilityResult({
    detected:
      true,

    personCount:
      people.length,

    maxCoverage,

    sufficientVisibility:
      maxCoverage >=
      minCoverage,
  });
}