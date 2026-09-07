import sharp from "sharp";

import {
  FRAME_SELECTION_CONFIG,
} from "../config/frameSelection.config.js";


const DEFAULT_COMPARISON_WIDTH =
  160;


const DEFAULT_DIFFERENCE_THRESHOLD =
  0.02;


/**
 * Loads an image, resizes it to a small common width,
 * converts it to grayscale, and returns raw pixel data.
 *
 * This keeps frame comparison cheap and deterministic.
 */
async function normaliseImage(
  imageInput,
  width =
    FRAME_SELECTION_CONFIG
        .comparisonWidth,
) {
  const {
    data,
    info,
  } =
    await sharp(
      imageInput,
    )
      .resize({
        width,
        withoutEnlargement: true,
      })
      .grayscale()
      .raw()
      .toBuffer({
        resolveWithObject: true,
      });


  return {
    data,
    width:
      info.width,
    height:
      info.height,
  };
}


/**
 * Compares two images using mean absolute
 * pixel difference.
 *
 * Score range:
 *
 * 0.0 = visually identical
 * 1.0 = maximally different
 */
export async function measureFrameDifference({
  referenceImage,
  candidateImage,
}) {
  if (!referenceImage) {
    throw new Error(
      "referenceImage is required.",
    );
  }


  if (!candidateImage) {
    throw new Error(
      "candidateImage is required.",
    );
  }


  const reference =
    await normaliseImage(
      referenceImage,
    );


  const candidate =
    await normaliseImage(
      candidateImage,
    );


  if (
    reference.width !==
      candidate.width ||
    reference.height !==
      candidate.height
  ) {
    throw new Error(
      "Normalised frame dimensions do not match.",
    );
  }


  if (
    reference.data.length !==
    candidate.data.length
  ) {
    throw new Error(
      "Normalised frame pixel counts do not match.",
    );
  }


  let totalDifference =
    0;


  for (
    let index = 0;
    index <
    reference.data.length;
    index += 1
  ) {
    totalDifference +=
      Math.abs(
        reference.data[index] -
          candidate.data[index],
      );
  }


  const meanDifference =
    totalDifference /
    reference.data.length;


  return (
    meanDifference /
    255
  );
}


/**
 * Decides whether a candidate frame should
 * continue into the expensive vision pipeline.
 *
 * This service ONLY answers:
 *
 * "Is this candidate meaningfully different
 * from the last kept frame?"
 *
 * It does not perform:
 *
 * - quality assessment
 * - interpretability assessment
 * - person detection
 * - caption generation
 * - evidence verification
 */
export async function evaluateFrameSelection({
  referenceImage,
  candidateImage,
  differenceThreshold =
    FRAME_SELECTION_CONFIG
    .differenceThreshold,
}) {
  if (
    !Number.isFinite(
      differenceThreshold,
    ) ||
    differenceThreshold <
      0 ||
    differenceThreshold >
      1
  ) {
    throw new Error(
      "differenceThreshold must be between 0 and 1.",
    );
  }


  /*
   * No meaningful frame exists yet.
   *
   * The first candidate must therefore
   * become our initial reference frame.
   */
  if (!referenceImage) {
    return {
      keep:
        true,

      reason:
        "first_frame",

      differenceScore:
        null,

      differenceThreshold,
    };
  }


  const differenceScore =
    await measureFrameDifference({
      referenceImage,
      candidateImage,
    });


  const keep =
    differenceScore >=
    differenceThreshold;


  return {
    keep,

    reason:
      keep
        ? "meaningful_change"
        : "redundant",

    differenceScore,

    differenceThreshold,
  };
}