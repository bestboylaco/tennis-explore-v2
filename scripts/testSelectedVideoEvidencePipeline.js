import {
  access,
  rm,
} from "node:fs/promises";

import path from "node:path";

import {
  selectMeaningfulVideoFrames,
} from "../src/modules/vision/services/videoFrameSelection.service.js";

import {
  prepareVisualEvidence,
} from "../src/modules/ingestion/visualEvidencePreparation.service.js";


/*
 * Usage:
 *
 * node scripts/testSelectedVideoEvidencePipeline.js "C:\path\to\video.mp4"
 *
 * The video path is supplied from the terminal,
 * so this script does not need to be edited for
 * every new video.
 */
const inputVideoPath =
  process.argv[2];


if (!inputVideoPath) {
  console.error("");
  console.error(
    "Missing video path.",
  );

  console.error("");
  console.error(
    'Usage: node scripts/testSelectedVideoEvidencePipeline.js "C:\\path\\to\\video.mp4"',
  );

  process.exit(1);
}


/*
 * Resolve the supplied path.
 */
const VIDEO_PATH =
  path.resolve(
    inputVideoPath,
  );


/*
 * Automatically derive a video ID from
 * the filename.
 *
 * Example:
 *
 * callum_beale_session_v1 (1080p).mp4
 *
 * becomes:
 *
 * callum_beale_session_v1_1080p
 */
const VIDEO_ID =
  path
    .basename(
      VIDEO_PATH,
      path.extname(VIDEO_PATH),
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "_",
    )
    .replace(
      /^_+|_+$/g,
      "",
    );


/*
 * Give every video its own test output
 * directory.
 *
 * This prevents Callum's extracted frames
 * from being mixed with Tom's frames.
 */
const OUTPUT_DIRECTORY =
  path.join(
    "C:\\TennisExploreData\\selected-video-evidence-test",
    VIDEO_ID,
  );


async function main() {
  /*
   * Make sure the supplied video actually
   * exists before starting FFmpeg/Qwen work.
   */
  try {
    await access(
      VIDEO_PATH,
    );
  } catch {
    throw new Error(
      `Video file not found: ${VIDEO_PATH}`,
    );
  }


  console.log("");
  console.log(
    "Selected Video Evidence Pipeline",
  );

  console.log({
    videoPath:
      VIDEO_PATH,

    videoId:
      VIDEO_ID,

    outputDirectory:
      OUTPUT_DIRECTORY,
  });


  /*
   * Start with a clean extraction directory
   * for THIS video only.
   */
  await rm(
    OUTPUT_DIRECTORY,
    {
      recursive: true,
      force: true,
    },
  );


  /*
   * GATE 1
   *
   * Extract candidates and remove
   * redundant frames.
   */
  const selectionResult =
    await selectMeaningfulVideoFrames({
      videoPath:
        VIDEO_PATH,

      outputDirectory:
        OUTPUT_DIRECTORY,

      videoId:
        VIDEO_ID,

      intervalSeconds:
        25,

      differenceThreshold:
        0.02,
    });


  console.log("");
  console.log(
    "Gate 1 complete.",
  );

  console.log({
    candidates:
      selectionResult.statistics.candidates,

    meaningful:
      selectionResult.statistics.selected,

    redundant:
      selectionResult.statistics.skipped,
  });


  /*
   * GATE 2
   *
   * Send ONLY meaningful frames through
   * the existing TENISE-53 visual evidence
   * pipeline.
   */
  const results =
    [];


  for (
    const frame of
      selectionResult.selectedFrames
  ) {
    console.log("");

    console.log(
      `Processing ${frame.imageId} at ${frame.timestampSeconds}s...`,
    );


    try {
      const prepared =
        await prepareVisualEvidence({
          image: {
            index:
              frame.index,

            imageId:
              frame.imageId,

            title:
              frame.title,

            path:
              frame.path,

            sourceDocument:
              frame.sourceDocument,

            page:
              frame.page,

            legacyCaption:
              frame.legacyCaption,

            ocrText:
              frame.ocrText,

            videoId:
              frame.videoId,

            timestampSeconds:
              frame.timestampSeconds,
          },
        });


      results.push({
        frame:
          frame.imageId,

        timestampSeconds:
          frame.timestampSeconds,

        gate1:
          "meaningful",

        gate2:
          prepared
            ? "trusted"
            : "rejected",

        qualityStatus:
          prepared?.qualityStatus ??
          null,

        verificationStatus:
          prepared?.verificationStatus ??
          null,

        caption:
          prepared?.trustedCaption ??
          null,
      });


      console.log(
        prepared
          ? "TENISE-53: TRUSTED"
          : "TENISE-53: REJECTED",
      );
    } catch (error) {
      results.push({
        frame:
          frame.imageId,

        timestampSeconds:
          frame.timestampSeconds,

        gate1:
          "meaningful",

        gate2:
          "error",

        qualityStatus:
          null,

        verificationStatus:
          null,

        caption:
          null,

        error:
          error.message,
      });


      console.error(
        "TENISE-53 processing error:",
        error.message,
      );
    }
  }


  console.log("");
  console.log(
    "Selected Video Evidence Pipeline Results",
  );


  console.table(
    results.map(
      (result) => ({
        frame:
          result.frame,

        timestampSeconds:
          result.timestampSeconds,

        gate1:
          result.gate1,

        gate2:
          result.gate2,

        qualityStatus:
          result.qualityStatus,

        verificationStatus:
          result.verificationStatus,
      }),
    ),
  );


  const trusted =
    results.filter(
      (result) =>
        result.gate2 ===
        "trusted",
    ).length;


  const rejected =
    results.filter(
      (result) =>
        result.gate2 ===
        "rejected",
    ).length;


  const errors =
    results.filter(
      (result) =>
        result.gate2 ===
        "error",
    ).length;


  console.log("");

  console.log(
    "Full pipeline summary:",
  );

  console.log({
    video:
      VIDEO_ID,

    candidates:
      selectionResult.statistics.candidates,

    redundantSkipped:
      selectionResult.statistics.skipped,

    meaningfulSelected:
      selectionResult.statistics.selected,

    tenise53Trusted:
      trusted,

    tenise53Rejected:
      rejected,

    tenise53Errors:
      errors,
  });


  console.log("");

  console.log(
    "Trusted captions:",
  );


  for (
    const result of
      results
  ) {
    if (
      result.gate2 ===
      "trusted"
    ) {
      console.log("");

      console.log(
        `[${result.timestampSeconds}s] ${result.frame}`,
      );

      console.log(
        result.caption,
      );
    }
  }
}


main().catch(
  (error) => {
    console.error("");
    console.error(
      "Selected video evidence pipeline failed:",
    );

    console.error(
      error,
    );

    process.exitCode =
      1;
  },
);