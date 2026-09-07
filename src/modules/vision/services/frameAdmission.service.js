import {
  FRAME_ADMISSION_MODE,
  FRAME_ADMISSION_REASON,
} from "../constants/frameAdmission.constants.js";

import {
  createFrameAdmissionResult,
} from "../types/frameAdmission.types.js";


function validateFrameQuality(
  frameQuality,
) {
  if (
    !frameQuality ||
    typeof frameQuality !== "object"
  ) {
    throw new TypeError(
      "frameQuality is required.",
    );
  }


  if (
    typeof frameQuality.frameId !==
    "string" ||
    frameQuality.frameId.trim().length ===
      0
  ) {
    throw new TypeError(
      "frameQuality.frameId must be provided.",
    );
  }


  if (
    typeof frameQuality.usable !==
    "boolean"
  ) {
    throw new TypeError(
      "frameQuality.usable must be a boolean.",
    );
  }
}


function validatePersonVisibility(
  personVisibility,
) {
  if (
    !personVisibility ||
    typeof personVisibility !== "object"
  ) {
    throw new TypeError(
      "personVisibility is required for person analysis.",
    );
  }


  if (
    typeof personVisibility
      .sufficientVisibility !==
    "boolean"
  ) {
    throw new TypeError(
      "personVisibility.sufficientVisibility must be a boolean.",
    );
  }
}


export function evaluateFrameAdmission({
  frameQuality,

  personVisibility = null,

  mode =
    FRAME_ADMISSION_MODE
      .GENERAL_CAPTION,
} = {}) {
  validateFrameQuality(
    frameQuality,
  );


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


  const reasons =
    [];


  if (!frameQuality.usable) {
    reasons.push(
      FRAME_ADMISSION_REASON
        .QUALITY_UNUSABLE,
    );
  }


 if (
  mode ===
    FRAME_ADMISSION_MODE
      .PERSON_ANALYSIS &&
  frameQuality.usable
) {
  validatePersonVisibility(
    personVisibility,
  );


  if (
    !personVisibility
      .sufficientVisibility
  ) {
    reasons.push(
      FRAME_ADMISSION_REASON
        .PERSON_VISIBILITY_INSUFFICIENT,
    );
  }
}


  return createFrameAdmissionResult({
    frameId:
      frameQuality.frameId,

    mode,

    eligible:
      reasons.length === 0,

    reasons,

    frameQuality,

    personVisibility,
  });
}