import {
  FRAME_CAPTION_STATUS,
} from "../constants/frameCaption.constants.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}


function assertStatus(status) {
  const validStatuses =
    Object.values(
      FRAME_CAPTION_STATUS,
    );


  if (
    !validStatuses.includes(status)
  ) {
    throw new TypeError(
      `Invalid frame caption status: ${status}`,
    );
  }
}


/*
 * Stable result returned by any
 * frame-caption provider.
 */
export function createFrameCaptionResult({
  frameId,

  status,

  caption = null,

  reason = null,

  generation = {},

  source = {},
} = {}) {
  if (!isNonEmptyString(frameId)) {
    throw new TypeError(
      "frameId must be a non-empty string.",
    );
  }


  assertStatus(status);


  if (
    status ===
      FRAME_CAPTION_STATUS.GENERATED &&
    !isNonEmptyString(caption)
  ) {
    throw new TypeError(
      "Generated captions require non-empty caption text.",
    );
  }


  if (
    status ===
      FRAME_CAPTION_STATUS.ABSTAINED &&
    caption !== null
  ) {
    throw new TypeError(
      "Abstained captions must have caption set to null.",
    );
  }


  if (
    reason !== null &&
    !isNonEmptyString(reason)
  ) {
    throw new TypeError(
      "reason must be a non-empty string or null.",
    );
  }


  return {
    frameId:
      frameId.trim(),

    status,

    caption:
      isNonEmptyString(caption)
        ? caption.trim()
        : null,

    reason:
      isNonEmptyString(reason)
        ? reason.trim()
        : null,

    generation: {
      provider:
        generation.provider ??
        null,

      model:
        generation.model ??
        null,

     promptVersion:
        generation.promptVersion ??
        null,
    },
    source: {
      videoId:
        source.videoId ??
        null,

      timestampSeconds:
        isFiniteNumber(
          source.timestampSeconds,
        )
          ? source.timestampSeconds
          : null,

      framePath:
        source.framePath ??
        null,
    },
  };
}