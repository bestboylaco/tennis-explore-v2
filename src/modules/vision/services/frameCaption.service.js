import {
  FRAME_CAPTION_STATUS,
} from "../constants/frameCaption.constants.js";

import {
  createFrameCaptionResult,
} from "../types/frameCaption.types.js";

import {
  FRAME_CAPTION_PROMPT_VERSION,
} from "../prompts/frameCaption.prompt.js";


export async function generateFrameCaption({
  frameId,

  imageInput,

  admission,

  provider,

  source = {},
} = {}) {
  if (
    typeof frameId !== "string" ||
    frameId.trim().length === 0
  ) {
    throw new TypeError(
      "frameId is required.",
    );
  }


  if (
    typeof imageInput !== "string" &&
    !Buffer.isBuffer(imageInput)
  ) {
    throw new TypeError(
      "imageInput must be an image path or Buffer.",
    );
  }


  if (
    !admission ||
    typeof admission !== "object"
  ) {
    throw new TypeError(
      "admission result is required.",
    );
  }


  if (
    typeof admission.eligible !==
    "boolean"
  ) {
    throw new TypeError(
      "admission.eligible must be a boolean.",
    );
  }


  if (
    !provider ||
    typeof provider.generate !==
    "function"
  ) {
    throw new TypeError(
      "A valid caption provider is required.",
    );
  }


  /*
   * Do not call the vision model
   * when the frame was rejected.
   */
  if (!admission.eligible) {
    return createFrameCaptionResult({
      frameId,

      status:
        FRAME_CAPTION_STATUS
          .ABSTAINED,

      caption:
        null,

      reason:
        admission.reasons?.[0] ??
        "frame_not_admitted",

      generation: {
        provider:
          provider.name,

        model:
          provider.model,

        promptVersion:
          FRAME_CAPTION_PROMPT_VERSION,
      },

      source,
    });
  }


  const caption =
    await provider.generate({
      frameId,

      imageInput,

      admission,
    });


  return createFrameCaptionResult({
    frameId,

    status:
      FRAME_CAPTION_STATUS
        .GENERATED,

    caption,

    generation: {
      provider:
        provider.name,

      model:
        provider.model,

      promptVersion:
        FRAME_CAPTION_PROMPT_VERSION,
    },

    source,
  });
}