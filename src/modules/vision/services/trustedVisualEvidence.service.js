import {
  FRAME_CAPTION_STATUS,
} from "../constants/frameCaption.constants.js";

import {
  TRUSTED_VISUAL_EVIDENCE_STATUS,
} from "../constants/trustedVisualEvidence.constants.js";

import {
  createTrustedVisualEvidence,
} from "../types/trustedVisualEvidence.types.js";


function isObject(
  value,
) {
  return (
    value !== null &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value,
    )
  );
}


function assertInputs({
  frameQuality,
  admission,
  caption,
  verification,
}) {
  if (
    !isObject(
      frameQuality,
    )
  ) {
    throw new TypeError(
      "Trusted visual evidence requires frame quality.",
    );
  }


  if (
    !isObject(
      admission,
    ) ||
    typeof admission.eligible !==
      "boolean"
  ) {
    throw new TypeError(
      "Trusted visual evidence requires frame admission.",
    );
  }


  if (
    !isObject(
      caption,
    )
  ) {
    throw new TypeError(
      "Trusted visual evidence requires caption result.",
    );
  }


  if (
    !isObject(
      verification,
    ) ||
    typeof verification.evidenceEligible !==
      "boolean"
  ) {
    throw new TypeError(
      "Trusted visual evidence requires caption verification.",
    );
  }
}


export function buildTrustedVisualEvidence({
  frameQuality,

  admission,

  caption,

  verification,

  grounding =
    null,

  source = {},
} = {}) {
  assertInputs({
    frameQuality,

    admission,

    caption,

    verification,
  });


  const evidenceEligible =
    (
      frameQuality.usable ===
        true &&
      admission.eligible ===
        true &&
      caption.status ===
        FRAME_CAPTION_STATUS.GENERATED &&
      verification.evidenceEligible ===
        true
    );


  const status =
    evidenceEligible
      ? TRUSTED_VISUAL_EVIDENCE_STATUS
          .TRUSTED
      : TRUSTED_VISUAL_EVIDENCE_STATUS
          .REJECTED;


  const resolvedSource = {
    ...(
      frameQuality.source ??
      {}
    ),

    ...(
      caption.source ??
      {}
    ),

    ...source,
  };


  return createTrustedVisualEvidence({
    frameId:
      caption.frameId ??
      frameQuality.frameId,

    status,

    evidenceEligible,

    quality:
      frameQuality,

    caption: {
      text:
        caption.caption,

      status:
        caption.status,

      reason:
        caption.reason,

      generation:
        caption.generation,
    },

    verification,

    grounding,

    source:
      resolvedSource,
  });
}