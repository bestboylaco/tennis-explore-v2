/*
 * Provisional thresholds calibrated from the
 * current TennisExplore frame sample.
 *
 * These can be refined as more footage is tested.
 */
export const FRAME_QUALITY_THRESHOLDS = Object.freeze({
  minWidth:
    640,

  minHeight:
    360,


  // Darkness.
  badMinBrightness:
    35,

  cautionMinBrightness:
    65,


  // Excessive brightness.
  cautionMaxBrightness:
    155,

  badMaxBrightness:
    180,


  // Contrast.
  badMinContrast:
    25,

  cautionMinContrast:
    45,


  // Blur / sharpness.
  badMinSharpness:
    0.18,

  cautionMinSharpness:
    0.40,

    // Noise.
  cautionMinNoiseScore:
    5,

  badMinNoiseScore:
    15,

   // JPEG-style compression artifacts.
  badMinBlockinessScore:
    1.5,
});

