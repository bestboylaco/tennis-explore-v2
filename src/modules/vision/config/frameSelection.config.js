/**
 * Configuration for meaningful video-frame selection.
 *
 * These values control Gate 1 only:
 *
 * "Is this candidate frame worth analysing?"
 *
 * They do NOT control:
 *
 * - frame quality
 * - interpretability
 * - person visibility
 * - caption generation
 * - caption verification
 * - trusted visual evidence
 */
export const FRAME_SELECTION_CONFIG =
  Object.freeze({
    /*
     * Extract one candidate frame every
     * 25 seconds.
     *
     * This is the current MVP sampling interval.
     */
    candidateIntervalSeconds:
      25,


    /*
     * Frames are resized before comparison so
     * Gate 1 remains cheap.
     */
    comparisonWidth:
      160,


    /*
     * Mean absolute grayscale pixel-difference
     * threshold.
     *
     * Calibrated against the Tom Larner test
     * video.
     *
     * This is an MVP value and should be
     * recalibrated against additional videos
     * before being treated as universal.
     */
    differenceThreshold:
      0.02,
  });