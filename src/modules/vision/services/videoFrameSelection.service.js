import {
  extractCandidateFrames,
} from "./videoFrameExtraction.service.js";

import {
  evaluateFrameSelection,
} from "./frameSelection.service.js";

import {
  FRAME_SELECTION_CONFIG,
} from "../config/frameSelection.config.js";




export async function selectMeaningfulVideoFrames({
  videoPath,
  outputDirectory,
  videoId = null,
  intervalSeconds =
    FRAME_SELECTION_CONFIG
    .candidateIntervalSeconds,
  differenceThreshold =
    FRAME_SELECTION_CONFIG
        .differenceThreshold,
}) {
  const candidates =
    await extractCandidateFrames({
      videoPath,
      outputDirectory,
      videoId,
      intervalSeconds,
    });


  const selectedFrames =
    [];

  const skippedFrames =
    [];


  let lastKeptFrame =
    null;


  for (
    const candidate of
      candidates
  ) {
    const selection =
        await evaluateFrameSelection({
            referenceImage:
            lastKeptFrame?.path ??
            null,

            candidateImage:
            candidate.path,

            differenceThreshold,
        });


    const result = {
      ...candidate,

      selection: {
        differenceScore:
          selection.differenceScore,

        keep:
          selection.keep,

        reason:
          selection.reason,

        differenceThreshold:
          selection.differenceThreshold,
      },
    };


    if (
      selection.keep
    ) {
      selectedFrames.push(
        result,
      );

      /*
       * Critical rule:
       *
       * Only meaningful frames become
       * the next comparison reference.
       */
      lastKeptFrame =
        candidate;
    } else {
      skippedFrames.push(
        result,
      );
    }
  }


  return {
    videoId,

    intervalSeconds,

    candidates,

    selectedFrames,

    skippedFrames,

    statistics: {
      candidates:
        candidates.length,

      selected:
        selectedFrames.length,

      skipped:
        skippedFrames.length,

      keepRate:
        candidates.length >
        0
          ? selectedFrames.length /
            candidates.length
          : 0,
    },
  };
}