import {
  CAPTION_VERIFICATION_STATUS,
} from "../constants/captionVerification.constants.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function assertStatus(status) {
  const validStatuses =
    Object.values(
      CAPTION_VERIFICATION_STATUS,
    );


  if (!validStatuses.includes(status)) {
    throw new TypeError(
      `Invalid caption verification status: ${status}`,
    );
  }
}


export function createCaptionVerificationResult({
  frameId,

  status,

  evidenceEligible,

  rawCaption = null,

  issues = [],

  checks = {},
} = {}) {
  if (!isNonEmptyString(frameId)) {
    throw new TypeError(
      "frameId must be a non-empty string.",
    );
  }


  assertStatus(
    status,
  );


  if (
    typeof evidenceEligible !==
    "boolean"
  ) {
    throw new TypeError(
      "evidenceEligible must be a boolean.",
    );
  }


  if (
    rawCaption !== null &&
    !isNonEmptyString(rawCaption)
  ) {
    throw new TypeError(
      "rawCaption must be a non-empty string or null.",
    );
  }


  if (!Array.isArray(issues)) {
    throw new TypeError(
      "issues must be an array.",
    );
  }


  if (
    status ===
      CAPTION_VERIFICATION_STATUS
        .ABSTAINED &&
    rawCaption !== null
  ) {
    throw new TypeError(
      "Abstained verification cannot contain a raw caption.",
    );
  }


  if (
    status ===
      CAPTION_VERIFICATION_STATUS
        .ABSTAINED &&
    evidenceEligible
  ) {
    throw new TypeError(
      "Abstained verification cannot be evidence eligible.",
    );
  }


  if (
    status ===
      CAPTION_VERIFICATION_STATUS
        .VERIFIED &&
    issues.length > 0
  ) {
    throw new TypeError(
      "Verified captions cannot contain verification issues.",
    );
  }


  if (
    status ===
      CAPTION_VERIFICATION_STATUS
        .VERIFIED_WITH_WARNINGS &&
    issues.length === 0
  ) {
    throw new TypeError(
      "Verified-with-warnings captions require at least one issue.",
    );
  }


  if (
    status ===
      CAPTION_VERIFICATION_STATUS
        .UNRELIABLE &&
    evidenceEligible
  ) {
    throw new TypeError(
      "Unreliable captions cannot be evidence eligible.",
    );
  }


  return {
    frameId:
      frameId.trim(),

    status,

    evidenceEligible,

    rawCaption:
      rawCaption === null
        ? null
        : rawCaption.trim(),

    issues: [
      ...issues,
    ],

    checks: {
      ...checks,
    },
  };
}