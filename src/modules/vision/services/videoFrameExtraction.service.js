import {
  mkdir,
  readdir,
} from "node:fs/promises";

import path from "node:path";

import {
  spawn,
} from "node:child_process";

import {
  FRAME_SELECTION_CONFIG,
} from "../config/frameSelection.config.js";




/**
 * Runs a child process and resolves when it exits
 * successfully.
 */
function runProcess(
  command,
  args,
) {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const child =
        spawn(
          command,
          args,
          {
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        );


      let stderr =
        "";


      child.stderr.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();
        },
      );


      child.on(
        "error",
        (error) => {
          reject(
            error,
          );
        },
      );


      child.on(
        "close",
        (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `${command} exited with code ${code}.\n${stderr}`,
              ),
            );

            return;
          }


          resolve();
        },
      );
    },
  );
}


/**
 * Extracts candidate frames from a video at
 * a fixed interval.
 *
 * This service does NOT decide whether a frame
 * is meaningful.
 *
 * It only creates candidates.
 */
export async function extractCandidateFrames({
  videoPath,
  outputDirectory,
  videoId = null,
  intervalSeconds =
    FRAME_SELECTION_CONFIG
    .candidateIntervalSeconds,
}) {
  if (
    typeof videoPath !==
      "string" ||
    videoPath.trim().length ===
      0
  ) {
    throw new Error(
      "videoPath is required.",
    );
  }


  if (
    typeof outputDirectory !==
      "string" ||
    outputDirectory.trim().length ===
      0
  ) {
    throw new Error(
      "outputDirectory is required.",
    );
  }


  if (
    !Number.isFinite(
      intervalSeconds,
    ) ||
    intervalSeconds <=
      0
  ) {
    throw new Error(
      "intervalSeconds must be greater than 0.",
    );
  }


  await mkdir(
    outputDirectory,
    {
      recursive:
        true,
    },
  );


  const outputPattern =
    path.join(
      outputDirectory,
      "candidate_%04d.jpg",
    );


  await runProcess(
    "ffmpeg",
    [
      "-y",

      "-i",
      videoPath,

      "-vf",
      `fps=1/${intervalSeconds}`,

      "-q:v",
      "2",

      outputPattern,
    ],
  );


  const files =
    (
      await readdir(
        outputDirectory,
      )
    )
      .filter(
        (file) =>
          /^candidate_\d+\.jpg$/i.test(
            file,
          ),
      )
      .sort();


  return files.map(
    (
      fileName,
      index,
    ) => ({
      index,

      imageId:
        path.basename(
          fileName,
          path.extname(
            fileName,
          ),
        ),

      title:
        "Video frame",

      path:
        path.join(
          outputDirectory,
          fileName,
        ),

      sourceDocument:
        null,

      page:
        null,

      legacyCaption:
        "",

      ocrText:
        "",

      videoId,

      timestampSeconds:
        index *
        intervalSeconds,
    }),
  );
}