import {
  FRAME_ADMISSION_MODE,
} from "../constants/frameAdmission.constants.js";

import {
  FRAME_INTERPRETABILITY_STATUS,
} from "../constants/frameInterpretability.constants.js";


function isNonEmptyString(
  value,
) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function assertMode(
  mode,
) {
  if (
    !Object.values(
      FRAME_ADMISSION_MODE,
    ).includes(
      mode,
    )
  ) {
    throw new TypeError(
      `Invalid frame interpretability mode: ${mode}`,
    );
  }
}


function assertStatus(
  status,
) {
  if (
    !Object.values(
      FRAME_INTERPRETABILITY_STATUS,
    ).includes(
      status,
    )
  ) {
    throw new TypeError(
      `Invalid frame interpretability status: ${status}`,
    );
  }
}


export function createFrameInterpretabilityResult({
  frameId,

  mode,

  status,

  obstructionDetected,

  reason,
} = {}) {
  if (
    !isNonEmptyString(
      frameId,
    )
  ) {
    throw new TypeError(
      "frameId must be a non-empty string.",
    );
  }


  assertMode(
    mode,
  );


  assertStatus(
    status,
  );


  if (
    typeof obstructionDetected !==
      "boolean"
  ) {
    throw new TypeError(
      "obstructionDetected must be a boolean.",
    );
  }


  if (
    !isNonEmptyString(
      reason,
    )
  ) {
    throw new TypeError(
      "Interpretability reason must be provided.",
    );
  }


  const interpretable =
    status !==
    FRAME_INTERPRETABILITY_STATUS
      .INSUFFICIENT;


  return {
    frameId:
      frameId.trim(),

    mode,

    status,

    obstructionDetected,

    interpretable,

    evidenceEligible:
      interpretable,

    reason:
      reason.trim(),
  };
}