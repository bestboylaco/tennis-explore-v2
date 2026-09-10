import {
  TRUSTED_VISUAL_EVIDENCE_STATUS,
} from "../constants/trustedVisualEvidence.constants.js";


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


function assertFrameId(
  frameId,
) {
  if (
    typeof frameId !==
      "string" ||
    frameId.trim().length ===
      0
  ) {
    throw new TypeError(
      "Trusted visual evidence requires frameId.",
    );
  }
}


function assertStatus(
  status,
) {
  if (
    !Object.values(
      TRUSTED_VISUAL_EVIDENCE_STATUS,
    ).includes(
      status,
    )
  ) {
    throw new TypeError(
      `Invalid trusted visual evidence status: ${status}`,
    );
  }
}


function assertSource(
  source,
) {
  if (
    !isObject(
      source,
    )
  ) {
    throw new TypeError(
      "Trusted visual evidence requires source metadata.",
    );
  }


  const hasFramePath =
    typeof source.framePath ===
      "string" &&
    source.framePath.trim().length >
      0;


  const hasVideoTrace =
    typeof source.videoId ===
      "string" &&
    source.videoId.trim().length >
      0 &&
    typeof source.timestampSeconds ===
      "number" &&
    Number.isFinite(
      source.timestampSeconds,
    );


  if (
    !hasFramePath &&
    !hasVideoTrace
  ) {
    throw new TypeError(
      "Trusted visual evidence requires framePath or videoId with timestampSeconds.",
    );
  }
}


function assertCaption(
  caption,
  evidenceEligible,
) {
  if (
    !isObject(
      caption,
    )
  ) {
    throw new TypeError(
      "Trusted visual evidence requires caption metadata.",
    );
  }


  if (
    evidenceEligible &&
    (
      typeof caption.text !==
        "string" ||
      caption.text.trim().length ===
        0
    )
  ) {
    throw new TypeError(
      "Eligible visual evidence requires caption text.",
    );
  }
}


function assertQuality(
  quality,
) {
  if (
    !isObject(
      quality,
    )
  ) {
    throw new TypeError(
      "Trusted visual evidence requires quality metadata.",
    );
  }


  if (
    typeof quality.status !==
      "string" ||
    typeof quality.usable !==
      "boolean" ||
    typeof quality.qualityScore !==
      "number" ||
    !Number.isFinite(
      quality.qualityScore,
    )
  ) {
    throw new TypeError(
      "Trusted visual evidence has invalid quality metadata.",
    );
  }


  if (
    !Array.isArray(
      quality.issues,
    )
  ) {
    throw new TypeError(
      "Trusted visual evidence quality issues must be an array.",
    );
  }
}


function assertVerification(
  verification,
) {
  if (
    !isObject(
      verification,
    ) ||
    typeof verification.status !==
      "string" ||
    typeof verification.evidenceEligible !==
      "boolean"
  ) {
    throw new TypeError(
      "Trusted visual evidence requires verification metadata.",
    );
  }
}


export function createTrustedVisualEvidence({
  frameId,

  status,

  evidenceEligible,

  quality,

  caption,

  verification,

  grounding = null,

  source,
} = {}) {
  assertFrameId(
    frameId,
  );


  assertStatus(
    status,
  );


  if (
    typeof evidenceEligible !==
      "boolean"
  ) {
    throw new TypeError(
      "Trusted visual evidence requires evidenceEligible.",
    );
  }


  assertQuality(
    quality,
  );


  assertCaption(
    caption,
    evidenceEligible,
  );


  assertVerification(
    verification,
  );


  assertSource(
    source,
  );


  if (
    grounding !== null &&
    !isObject(
      grounding,
    )
  ) {
    throw new TypeError(
      "Trusted visual evidence grounding must be an object or null.",
    );
  }


  if (
    status ===
      TRUSTED_VISUAL_EVIDENCE_STATUS.TRUSTED &&
    !evidenceEligible
  ) {
    throw new TypeError(
      "Trusted visual evidence cannot have evidenceEligible=false.",
    );
  }


  if (
    status ===
      TRUSTED_VISUAL_EVIDENCE_STATUS.REJECTED &&
    evidenceEligible
  ) {
    throw new TypeError(
      "Rejected visual evidence cannot have evidenceEligible=true.",
    );
  }


  return {
    frameId:
      frameId.trim(),

    status,

    evidenceEligible,

    quality: {
      status:
        quality.status,

      usable:
        quality.usable,

      qualityScore:
        quality.qualityScore,

      issues:
        [
          ...quality.issues,
        ],

      metrics:
        quality.metrics ??
        null,
    },

    caption: {
      text:
        typeof caption.text ===
          "string"
          ? caption.text.trim()
          : null,

      status:
        caption.status ??
        null,

      reason:
        caption.reason ??
        null,

      generation:
        caption.generation ??
        null,
    },

    verification: {
      status:
        verification.status,

      evidenceEligible:
        verification.evidenceEligible,

      issues:
        Array.isArray(
          verification.issues,
        )
          ? [
              ...verification.issues,
            ]
          : [],
    },

    grounding,

    source: {
      videoId:
        source.videoId ??
        null,

      timestampSeconds:
        source.timestampSeconds ??
        null,

      framePath:
        source.framePath ??
        null,
    },
  };
}