import {
  FRAME_QUALITY_STATUS,
} from "../constants/frameQuality.constants.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}


function assertStatus(status) {
  const validStatuses =
    Object.values(
      FRAME_QUALITY_STATUS,
    );

  if (
    !validStatuses.includes(status)
  ) {
    throw new TypeError(
      `Invalid frame quality status: ${status}`,
    );
  }
}


/**
 * Creates the stable quality result consumed
 * by future visual-processing services.
 *
 * This contract deliberately separates:
 *
 * - status: classification of the frame
 * - usable: whether downstream captioning may continue
 * - qualityScore: normalized 0..1 quality value
 * - issues: machine-readable quality problems
 * - metrics: raw deterministic measurements
 * - source: traceability back to the original asset
 */
export function createFrameQualityResult({
  frameId,

  status,

  usable,

  qualityScore,

  issues = [],

  metrics = {},

  source = {},
} = {}) {
  if (!isNonEmptyString(frameId)) {
    throw new TypeError(
      "frameId must be a non-empty string.",
    );
  }


  assertStatus(status);


  if (typeof usable !== "boolean") {
    throw new TypeError(
      "usable must be a boolean.",
    );
  }


  if (
    !isFiniteNumber(
      qualityScore,
    ) ||
    qualityScore < 0 ||
    qualityScore > 1
  ) {
    throw new TypeError(
      "qualityScore must be a finite number between 0 and 1.",
    );
  }


  if (!Array.isArray(issues)) {
    throw new TypeError(
      "issues must be an array.",
    );
  }


  return {
    frameId:
      frameId.trim(),

    status,

    usable,

    qualityScore,

    issues: [
      ...issues,
    ],

    metrics: {
      ...metrics,
    },

    source: {
      videoId:
        source.videoId ??
        null,

      timestampSeconds:
        isFiniteNumber(
          source.timestampSeconds,
        )
          ? source.timestampSeconds
          : null,

      framePath:
        source.framePath ??
        null,
    },
  };
}