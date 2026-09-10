import {
  FRAME_ADMISSION_MODE,
} from "../constants/frameAdmission.constants.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function assertMode(mode) {
  const validModes =
    Object.values(
      FRAME_ADMISSION_MODE,
    );


  if (
    !validModes.includes(mode)
  ) {
    throw new TypeError(
      `Invalid frame admission mode: ${mode}`,
    );
  }
}


/*
 * Stable decision returned before
 * downstream visual processing.
 */
export function createFrameAdmissionResult({
  frameId,

  mode,

  eligible,

  reasons = [],

  frameQuality,

  interpretability = null,

  personVisibility = null,
} = {}) {
  if (!isNonEmptyString(frameId)) {
    throw new TypeError(
      "frameId must be a non-empty string.",
    );
  }


  assertMode(mode);


  if (typeof eligible !== "boolean") {
    throw new TypeError(
      "eligible must be a boolean.",
    );
  }


  if (!Array.isArray(reasons)) {
    throw new TypeError(
      "reasons must be an array.",
    );
  }


  if (
    !frameQuality ||
    typeof frameQuality !== "object"
  ) {
    throw new TypeError(
      "frameQuality must be provided.",
    );
  }


  if (
    interpretability !== null &&
    typeof interpretability !==
      "object"
  ) {
    throw new TypeError(
      "interpretability must be an object or null.",
    );
  }


  if (
    personVisibility !== null &&
    typeof personVisibility !== "object"
  ) {
    throw new TypeError(
      "personVisibility must be an object or null.",
    );
  }


  return {
    frameId:
      frameId.trim(),

    mode,

    eligible,

    reasons: [
      ...reasons,
    ],

    frameQuality: {
      ...frameQuality,
    },

    interpretability:
      interpretability
        ? {
            ...interpretability,
          }
        : null,

    personVisibility:
      personVisibility
        ? {
            ...personVisibility,
          }
        : null,
  };
}