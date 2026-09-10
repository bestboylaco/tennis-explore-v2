/**
 * Stable frame-quality states used throughout
 * TennisExplore visual processing.
 */
export const FRAME_QUALITY_STATUS = Object.freeze({
  GOOD: "good",
  CAUTION: "caution",
  BAD: "bad",
});


/**
 * Machine-readable reasons explaining why
 * a frame may not be suitable for trusted
 * visual evidence.
 *
 * These values should remain stable because
 * downstream services and telemetry may rely
 * on them.
 */
export const FRAME_QUALITY_ISSUES = Object.freeze({
  LOW_RESOLUTION:
    "low_resolution",

  TOO_DARK:
    "too_dark",

  OVEREXPOSED:
    "overexposed",

  LOW_CONTRAST:
    "low_contrast",

  MODERATE_BLUR:
    "moderate_blur",

  SEVERE_BLUR:
    "severe_blur",

  MODERATE_NOISE:
  "moderate_noise",

  SEVERE_NOISE:
  "severe_noise",

  SEVERE_COMPRESSION:
  "severe_compression",

  PLAYER_NOT_VISIBLE:
    "player_not_visible",

  PLAYER_VISIBILITY_LOW:
    "player_visibility_low",

  IRRELEVANT_SCENE:
    "irrelevant_scene",
});