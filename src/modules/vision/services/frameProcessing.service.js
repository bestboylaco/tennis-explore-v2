import path from "node:path";

import {
  FRAME_QUALITY_THRESHOLDS,
} from "../config/frameQuality.config.js";

import {
  FRAME_ADMISSION_MODE,
} from "../constants/frameAdmission.constants.js";

import {
  createPersonDetector,
} from "../providers/personDetector.provider.js";

import {
  createOllamaFrameCaptionProvider,
} from "../providers/ollamaFrameCaption.provider.js";

import {
  measureImageMetrics,
} from "./imageMetrics.service.js";

import {
  evaluateFrameQuality,
} from "./frameQuality.service.js";

import {
  evaluateFrameInterpretability,
} from "./frameInterpretability.service.js";

import {
  evaluatePersonVisibility,
} from "./personVisibility.service.js";

import {
  evaluateFrameAdmission,
} from "./frameAdmission.service.js";

import {
  generateFrameCaption,
} from "./frameCaption.service.js";

import {
  verifyFrameCaption,
} from "./captionVerification.service.js";

import {
  groundFrameCaption,
} from "./captionGrounding.service.js";

import {
  buildTrustedVisualEvidence,
} from "./trustedVisualEvidence.service.js";


const defaultPersonDetector =
  createPersonDetector();

const defaultCaptionProvider =
  createOllamaFrameCaptionProvider();


function isValidImageInput(value) {
  return (
    (
      typeof value === "string" &&
      value.trim().length > 0
    ) ||
    Buffer.isBuffer(value)
  );
}


function resolveFrameId(
  frameId,
  imageInput,
) {
  if (
    typeof frameId ===
      "string" &&
    frameId.trim().length > 0
  ) {
    return frameId.trim();
  }

  if (
    typeof imageInput ===
      "string"
  ) {
    return path.basename(
      imageInput,
    );
  }

  throw new TypeError(
    "frameId is required when imageInput is a Buffer.",
  );
}


function assertMode(
  mode,
) {
  const validModes =
    Object.values(
      FRAME_ADMISSION_MODE,
    );

  if (
    !validModes.includes(
      mode,
    )
  ) {
    throw new TypeError(
      `Invalid frame processing mode: ${mode}`,
    );
  }
}


export async function processFrame({
  frameId,

  imageInput,

  mode =
    FRAME_ADMISSION_MODE
      .GENERAL_CAPTION,

  source = {},

  personDetector =
    defaultPersonDetector,

  captionProvider =
    defaultCaptionProvider,
} = {}) {
  if (
    !isValidImageInput(
      imageInput,
    )
  ) {
    throw new TypeError(
      "processFrame requires an image path or Buffer.",
    );
  }

  assertMode(
    mode,
  );

  const resolvedFrameId =
    resolveFrameId(
      frameId,
      imageInput,
    );

  const resolvedSource = {
    ...source,

    framePath:
      source.framePath ??
      (
        typeof imageInput ===
          "string"
          ? imageInput
          : null
      ),
  };


  // 1. Measure technical image quality.
  const metrics =
    await measureImageMetrics(
      imageInput,
    );


  // 2. Decide whether the frame is
  // technically usable.
  const frameQuality =
    evaluateFrameQuality({
      frameId:
        resolvedFrameId,

      metrics,

      thresholds:
        FRAME_QUALITY_THRESHOLDS,

      source:
        resolvedSource,
    });


  // 3. Check semantic obstruction only
  // when technical quality is usable.
  let interpretability =
    null;

  if (
    frameQuality.usable
  ) {
    interpretability =
      await evaluateFrameInterpretability({
        frameId:
          resolvedFrameId,

        imageInput,

        mode,
      });
  }


  // 4. Person visibility is only needed
  // for person-focused analysis.
  let personVisibility =
    null;

  if (
    frameQuality.usable &&
    (
      !interpretability ||
      interpretability
        .evidenceEligible !== false
    ) &&
    mode ===
      FRAME_ADMISSION_MODE
        .PERSON_ANALYSIS
  ) {
    if (
      !personDetector ||
      typeof personDetector.detect !==
        "function"
    ) {
      throw new TypeError(
        "A valid person detector is required.",
      );
    }

    const detection =
      await personDetector.detect(
        imageInput,
      );

    personVisibility =
      evaluatePersonVisibility({
        detections:
          detection.detections,

        imageWidth:
          detection.imageWidth,

        imageHeight:
          detection.imageHeight,
      });
  }


  // 5. Final admission decision.
  const admission =
    evaluateFrameAdmission({
      frameQuality,

      personVisibility,

      interpretability,

      mode,
    });


  // 6. Caption only admitted frames.
  const caption =
    await generateFrameCaption({
      frameId:
        resolvedFrameId,

      imageInput,

      admission,

      provider:
        captionProvider,

      source:
        resolvedSource,
    });


  const verification =
    verifyFrameCaption({
      captionResult:
        caption,
    });


  // 7. Re-check generated visual claims
  // directly against the source frame.
  let grounding =
    null;

  if (
    caption.status ===
      "generated" &&
    verification.evidenceEligible ===
      true
  ) {
    grounding =
      await groundFrameCaption({
        imagePath:
          resolvedSource.framePath,

        caption:
          caption.caption,
      });
  }


  // 8. Build trusted evidence only after
  // caption verification and grounding.
  const trustedEvidence =
    buildTrustedVisualEvidence({
      frameQuality,

      admission,

      caption,

      verification,

      grounding,

      source:
        resolvedSource,
    });


  return {
    frameId:
      resolvedFrameId,

    mode,

    metrics,

    frameQuality,

    interpretability,

    personVisibility,

    admission,

    caption,

    verification,

    grounding,

    trustedEvidence,
  };
}

