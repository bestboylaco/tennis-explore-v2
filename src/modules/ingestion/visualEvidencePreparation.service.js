import path from "node:path";

import {
  FRAME_ADMISSION_MODE,
  processFrame,
} from "../vision/index.js";


function isObject(
  value,
) {
  return (
    value !== null &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value,
    )
  );
}


function assertImage(
  image,
) {
  if (
    !isObject(
      image,
    )
  ) {
    throw new TypeError(
      "Visual evidence preparation requires an image.",
    );
  }


  if (
    typeof image.path !==
      "string" ||
    image.path.trim().length ===
      0
  ) {
    throw new TypeError(
      "Visual evidence preparation requires image.path.",
    );
  }
}


function resolveImagePath(
  imagePath,
  manifestPath,
) {
  const trimmedPath =
    imagePath.trim();


  if (
    path.isAbsolute(
      trimmedPath,
    )
  ) {
    return trimmedPath;
  }


  if (
    typeof manifestPath ===
      "string" &&
    manifestPath.trim().length >
      0
  ) {
    return path.resolve(
      path.dirname(
        manifestPath,
      ),
      trimmedPath,
    );
  }


  return path.resolve(
    trimmedPath,
  );
}


function joinSearchableText(
  caption,
  ocrText,
) {
  return [
    caption,
    ocrText,
  ]
    .filter(
      (value) =>
        typeof value ===
          "string" &&
        value.trim().length >
          0,
    )
    .map(
      (value) =>
        value.trim(),
    )
    .join(
      " ",
    );
}


export async function prepareVisualEvidence({
  image,

  manifestPath =
    null,

  processFrameFn =
    processFrame,
} = {}) {
  assertImage(
    image,
  );


  if (
    typeof processFrameFn !==
      "function"
  ) {
    throw new TypeError(
      "Visual evidence preparation requires processFrameFn.",
    );
  }


  const imagePath =
    resolveImagePath(
      image.path,
      manifestPath,
    );


  const frameId =
    image.imageId ??
    path.basename(
      imagePath,
    );


  const result =
    await processFrameFn({
      frameId,

      imageInput:
        imagePath,

      mode:
        FRAME_ADMISSION_MODE
          .GENERAL_CAPTION,

      source: {
        videoId:
          image.videoId ??
          null,

        timestampSeconds:
          image.timestampSeconds ??
          null,

        framePath:
          imagePath,
      },
    });


  const trustedEvidence =
    result?.trustedEvidence;


  if (
    !trustedEvidence ||
    trustedEvidence
      .evidenceEligible !==
      true
  ) {
    return null;
  }


  const text =
    joinSearchableText(
      trustedEvidence
        .caption
        ?.text,

      image.ocrText,
    );


  if (
    text.length ===
    0
  ) {
    return null;
  }


  return {
    ...image,

    path:
      imagePath,

    text,

    trustedCaption:
      trustedEvidence
        .caption
        ?.text ??
      null,

    qualityStatus:
      trustedEvidence
        .quality
        .status,

    qualityScore:
      trustedEvidence
        .quality
        .qualityScore,

    qualityIssues:
      [
        ...trustedEvidence
          .quality
          .issues,
      ],

    verificationStatus:
      trustedEvidence
        .verification
        .status,

    evidenceEligible:
      true,

    videoId:
      trustedEvidence
        .source
        .videoId,

    timestampSeconds:
      trustedEvidence
        .source
        .timestampSeconds,

    framePath:
      trustedEvidence
        .source
        .framePath,
  };
}