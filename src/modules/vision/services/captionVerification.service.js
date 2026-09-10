import {
  FRAME_CAPTION_STATUS,
} from "../constants/frameCaption.constants.js";

import {
  CAPTION_VERIFICATION_STATUS,
  CAPTION_VERIFICATION_ISSUE,
} from "../constants/captionVerification.constants.js";

import {
  createCaptionVerificationResult,
} from "../types/captionVerification.types.js";


const SPECULATIVE_PATTERNS = [
  /\bprobably\b/i,
  /\blikely\b/i,
  /\bpossibly\b/i,
  /\bperhaps\b/i,
  /\bmaybe\b/i,
  /\bappears to be\b/i,
  /\bseems to be\b/i,
  /\blooks like\b/i,
  /\bpresumably\b/i,
  /\bmust be\b/i,
];


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function hasSpeculativeLanguage(
  caption,
) {
  return SPECULATIVE_PATTERNS.some(
    (pattern) =>
      pattern.test(caption),
  );
}


function hasPromptVersion(
  generation,
) {
  return isNonEmptyString(
    generation?.promptVersion,
  );
}


function hasSourceTraceability(
  source,
) {
  const hasFramePath =
    isNonEmptyString(
      source?.framePath,
    );


  const hasVideoReference =
    isNonEmptyString(
      source?.videoId,
    ) &&
    typeof source?.timestampSeconds ===
      "number" &&
    Number.isFinite(
      source.timestampSeconds,
    );


  return (
    hasFramePath ||
    hasVideoReference
  );
}


export function verifyFrameCaption({
  captionResult,
} = {}) {
  if (
    !captionResult ||
    typeof captionResult !== "object"
  ) {
    throw new TypeError(
      "captionResult is required.",
    );
  }


  if (
    !isNonEmptyString(
      captionResult.frameId,
    )
  ) {
    throw new TypeError(
      "captionResult.frameId is required.",
    );
  }


  if (
    captionResult.status ===
      FRAME_CAPTION_STATUS.ABSTAINED
  ) {
    return createCaptionVerificationResult({
      frameId:
        captionResult.frameId,

      status:
        CAPTION_VERIFICATION_STATUS
          .ABSTAINED,

      evidenceEligible:
        false,

      rawCaption:
        null,

      issues:
        [],

      checks: {
        captionGenerated:
          false,
      },
    });
  }


  if (
    captionResult.status !==
      FRAME_CAPTION_STATUS.GENERATED
  ) {
    throw new TypeError(
      `Unsupported caption status: ${captionResult.status}`,
    );
  }


  if (
    !isNonEmptyString(
      captionResult.caption,
    )
  ) {
    throw new TypeError(
      "Generated caption text is required.",
    );
  }


  const speculativeLanguage =
    hasSpeculativeLanguage(
      captionResult.caption,
    );


  const promptVersionPresent =
    hasPromptVersion(
      captionResult.generation,
    );


  const sourceTraceable =
    hasSourceTraceability(
      captionResult.source,
    );


  const issues =
    [];


  if (speculativeLanguage) {
    issues.push(
      CAPTION_VERIFICATION_ISSUE
        .SPECULATIVE_LANGUAGE,
    );
  }


  if (!promptVersionPresent) {
    issues.push(
      CAPTION_VERIFICATION_ISSUE
        .MISSING_PROMPT_VERSION,
    );
  }


  if (!sourceTraceable) {
    issues.push(
      CAPTION_VERIFICATION_ISSUE
        .MISSING_SOURCE_TRACEABILITY,
    );
  }


  const unreliable =
    speculativeLanguage;


  const status =
    unreliable
      ? CAPTION_VERIFICATION_STATUS
          .UNRELIABLE
      : issues.length === 0
        ? CAPTION_VERIFICATION_STATUS
            .VERIFIED
        : CAPTION_VERIFICATION_STATUS
            .VERIFIED_WITH_WARNINGS;


  return createCaptionVerificationResult({
    frameId:
      captionResult.frameId,

    status,

    evidenceEligible:
      !unreliable,

    rawCaption:
      captionResult.caption,

    issues,

    checks: {
      captionGenerated:
        true,

      speculativeLanguage,

      promptVersionPresent,

      sourceTraceable,
    },
  });
}