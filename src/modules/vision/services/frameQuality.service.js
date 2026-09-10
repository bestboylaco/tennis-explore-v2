import {
  FRAME_QUALITY_ISSUES,
  FRAME_QUALITY_STATUS,
} from "../constants/frameQuality.constants.js";

import {
  createFrameQualityResult,
} from "../types/frameQuality.types.js";


function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}


function assertMetrics(metrics) {
  if (
    !metrics ||
    typeof metrics !== "object"
  ) {
    throw new TypeError(
      "Frame quality evaluation requires metrics.",
    );
  }


  const required =
    [
      "width",
      "height",
      "brightness",
      "contrast",
      "sharpness",
      "noiseScore",
      "blockinessScore",
    ];


  for (const field of required) {
    if (
      !isFiniteNumber(
        metrics[field],
      )
    ) {
      throw new TypeError(
        `Frame metric "${field}" must be a finite number.`,
      );
    }
  }
}


function assertThresholds(
  thresholds,
) {
  if (
    !thresholds ||
    typeof thresholds !== "object"
  ) {
    throw new TypeError(
      "Frame quality evaluation requires thresholds.",
    );
  }


  const required =
    [
      "minWidth",
      "minHeight",

      "badMinBrightness",
      "cautionMinBrightness",

      "cautionMaxBrightness",
      "badMaxBrightness",

      "badMinContrast",
      "cautionMinContrast",

      "badMinSharpness",
      "cautionMinSharpness",
    ];


  for (const field of required) {
    if (
      !isFiniteNumber(
        thresholds[field],
      )
    ) {
      throw new TypeError(
        `Frame quality threshold "${field}" must be a finite number.`,
      );
    }
  }
}


/**
 * Determine frame usability from deterministic
 * image measurements.
 *
 * Threshold values are injected deliberately.
 * We will calibrate the real TennisExplore
 * thresholds against representative tennis
 * footage rather than burying arbitrary numbers
 * inside this service.
 */
export function evaluateFrameQuality({
  frameId,

  metrics,

  thresholds,

  source = {},
} = {}) {
  assertMetrics(
    metrics,
  );

  assertThresholds(
    thresholds,
  );


  const severeIssues = [];

  const cautionIssues = [];


  /*
   * Resolution.
   */
  if (
    metrics.width <
      thresholds.minWidth ||
    metrics.height <
      thresholds.minHeight
  ) {
    severeIssues.push(
      FRAME_QUALITY_ISSUES
        .LOW_RESOLUTION,
    );
  }


  /*
   * Brightness.
   */
  if (
    metrics.brightness <
    thresholds.badMinBrightness
  ) {
    severeIssues.push(
      FRAME_QUALITY_ISSUES
        .TOO_DARK,
    );
  } else if (
    metrics.brightness <
    thresholds.cautionMinBrightness
  ) {
    cautionIssues.push(
      FRAME_QUALITY_ISSUES
        .TOO_DARK,
    );
  }


  if (
    metrics.brightness >
    thresholds.badMaxBrightness
  ) {
    severeIssues.push(
      FRAME_QUALITY_ISSUES
        .OVEREXPOSED,
    );
  } else if (
    metrics.brightness >
    thresholds.cautionMaxBrightness
  ) {
    cautionIssues.push(
      FRAME_QUALITY_ISSUES
        .OVEREXPOSED,
    );
  }


  /*
   * Contrast.
   */
  if (
    metrics.contrast <
    thresholds.badMinContrast
  ) {
    severeIssues.push(
      FRAME_QUALITY_ISSUES
        .LOW_CONTRAST,
    );
  } else if (
    metrics.contrast <
    thresholds.cautionMinContrast
  ) {
    cautionIssues.push(
      FRAME_QUALITY_ISSUES
        .LOW_CONTRAST,
    );
  }


  /*
   * Sharpness / blur.
   */
  if (
    metrics.sharpness <
    thresholds.badMinSharpness
  ) {
    severeIssues.push(
      FRAME_QUALITY_ISSUES
        .SEVERE_BLUR,
    );
  } else if (
    metrics.sharpness <
    thresholds.cautionMinSharpness
  ) {
    cautionIssues.push(
      FRAME_QUALITY_ISSUES
        .MODERATE_BLUR,
    );
  }

  /*
 * Noise.
 */
  if (
    metrics.noiseScore >=
    thresholds.badMinNoiseScore
  ) {
    severeIssues.push(
      FRAME_QUALITY_ISSUES
        .SEVERE_NOISE,
    );
  } else if (
    metrics.noiseScore >=
    thresholds.cautionMinNoiseScore
  ) {
    cautionIssues.push(
      FRAME_QUALITY_ISSUES
        .MODERATE_NOISE,
    );
  }

  /*
 * Compression artifacts.
 *
 * Only classify otherwise sufficient-resolution
 * frames because resizing can also increase
 * the blockiness measurement.
 */
  if (
    metrics.width >=
      thresholds.minWidth &&
    metrics.height >=
      thresholds.minHeight &&
    metrics.blockinessScore >=
      thresholds.badMinBlockinessScore
  ) {
    severeIssues.push(
      FRAME_QUALITY_ISSUES
        .SEVERE_COMPRESSION,
    );
  }

  let status =
    FRAME_QUALITY_STATUS.GOOD;

  let usable =
    true;


  if (
    severeIssues.length > 0
  ) {
    status =
      FRAME_QUALITY_STATUS.BAD;

    usable =
      false;
  } else if (
    cautionIssues.length > 0
  ) {
    status =
      FRAME_QUALITY_STATUS.CAUTION;
  }


  const issues =
    [
      ...new Set([
        ...severeIssues,
        ...cautionIssues,
      ]),
    ];


  /*
   * Temporary interpretable score.
   *
   * The classification itself is driven by
   * explicit rules above.
   *
   * Later calibration can replace this scoring
   * approach without changing the result contract.
   */
  const qualityScore =
    status ===
    FRAME_QUALITY_STATUS.GOOD
      ? 1
      : status ===
        FRAME_QUALITY_STATUS.CAUTION
        ? 0.6
        : 0;


  return createFrameQualityResult({
    frameId,

    status,

    usable,

    qualityScore,

    issues,

    metrics,

    source,
  });
}