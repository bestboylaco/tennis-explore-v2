import {
  selectMeaningfulVideoFrames,
} from "../vision/index.js";

import {
  prepareVisualEvidence,
} from "./visualEvidencePreparation.service.js";


/**
 * Prepares trusted visual evidence from a video.
 *
 * Responsibilities:
 *
 * 1. Ask Vision to extract candidate frames.
 * 2. Ask Vision to remove redundant frames (Gate 1).
 * 3. Send only meaningful frames through the existing
 *    visual evidence preparation pipeline (Gate 2).
 *
 * This service does NOT:
 *
 * - implement frame comparison
 * - implement FFmpeg extraction
 * - implement TENISE-53
 * - chunk evidence
 * - embed evidence
 * - write to the vector store
 */
export async function prepareVideoVisualEvidence({
  videoPath,
  outputDirectory,
  videoId = null,
  intervalSeconds,
  differenceThreshold,
  selectFramesFn =
    selectMeaningfulVideoFrames,
  prepareVisualEvidenceFn =
    prepareVisualEvidence,
} = {}) {
  if (
    typeof selectFramesFn !==
    "function"
  ) {
    throw new TypeError(
      "Video visual evidence preparation requires selectFramesFn.",
    );
  }


  if (
    typeof prepareVisualEvidenceFn !==
    "function"
  ) {
    throw new TypeError(
      "Video visual evidence preparation requires prepareVisualEvidenceFn.",
    );
  }


  const selection =
    await selectFramesFn({
      videoPath,
      outputDirectory,
      videoId,

      ...(intervalSeconds !== undefined
        ? {
            intervalSeconds,
          }
        : {}),

      ...(differenceThreshold !== undefined
        ? {
            differenceThreshold,
          }
        : {}),
    });


  const trustedFrames =
    [];

  const rejectedFrames =
    [];


  for (
    const frame of
      selection.selectedFrames
  ) {
    const prepared =
      await prepareVisualEvidenceFn({
        image:
          frame,
      });


    if (
      prepared
    ) {
      /*
       * Preserve both:
       *
       * - image.path:
       *   the exact extracted JPEG frame
       *
       * - mediaPath:
       *   the original video recording
       *
       * This allows downstream chunks to
       * retain the precise evidence frame
       * while citations can still point
       * back to the original video.
       */
      trustedFrames.push({
        ...prepared,

        mediaPath:
          videoPath,
      });
    } else {
      /*
       * The frame passed Gate 1 because it
       * contained a meaningful visual
       * change, but Gate 2 did not consider
       * it trusted visual evidence.
       */
      rejectedFrames.push(
        frame,
      );
    }
  }


  return {
    videoId,

    /*
     * All frames sampled from the recording
     * before meaningful-frame selection.
     */
    candidates:
      selection.candidates,

    /*
     * Frames that passed Gate 1.
     */
    selectedFrames:
      selection.selectedFrames,

    /*
     * Frames skipped by Gate 1 because they
     * were visually redundant compared with
     * the last kept meaningful frame.
     */
    skippedFrames:
      selection.skippedFrames,

    /*
     * Frames that passed both:
     *
     * Gate 1:
     * meaningful visual change
     *
     * Gate 2:
     * trusted visual evidence
     */
    trustedFrames,

    /*
     * Frames that passed Gate 1 but failed
     * Gate 2.
     */
    rejectedFrames,

    statistics: {
      candidates:
        selection.statistics.candidates,

      redundantSkipped:
        selection.statistics.skipped,

      meaningfulSelected:
        selection.statistics.selected,

      trusted:
        trustedFrames.length,

      rejected:
        rejectedFrames.length,
    },
  };
}