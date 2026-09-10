import test from "node:test";
import assert from "node:assert/strict";

import {
  createFrameCaptionResult,
  FRAME_CAPTION_STATUS,
} from "../../src/modules/vision/index.js";


test(
  "creates a generated frame caption",
  () => {
    const result =
      createFrameCaptionResult({
        frameId:
          "frame_001.jpg",

        status:
          FRAME_CAPTION_STATUS
            .GENERATED,

        caption:
          "A presenter is speaking beside a presentation slide.",

        generation: {
          provider:
            "test",

          model:
            "test-model",
        },
      });


    assert.equal(
      result.status,
      FRAME_CAPTION_STATUS
        .GENERATED,
    );

    assert.equal(
      result.caption,
      "A presenter is speaking beside a presentation slide.",
    );
  },
);


test(
  "preserves generation metadata",
  () => {
    const result =
      createFrameCaptionResult({
        frameId:
          "frame_001.jpg",

        status:
          FRAME_CAPTION_STATUS
            .GENERATED,

        caption:
          "A tennis player is visible.",

        generation: {
          provider:
            "onnx-test",

          model:
            "vision-model",
        },
      });


    assert.equal(
      result.generation.provider,
      "onnx-test",
    );

    assert.equal(
      result.generation.model,
      "vision-model",
    );
  },
);


test(
  "preserves source traceability",
  () => {
    const result =
      createFrameCaptionResult({
        frameId:
          "frame_010.jpg",

        status:
          FRAME_CAPTION_STATUS
            .GENERATED,

        caption:
          "A presentation slide is visible.",

        source: {
          videoId:
            "video-123",

          timestampSeconds:
            405,

          framePath:
            "frames/frame_010.jpg",
        },
      });


    assert.equal(
      result.source.videoId,
      "video-123",
    );

    assert.equal(
      result.source.timestampSeconds,
      405,
    );

    assert.equal(
      result.source.framePath,
      "frames/frame_010.jpg",
    );
  },
);


test(
  "creates an abstained caption",
  () => {
    const result =
      createFrameCaptionResult({
        frameId:
          "frame_020.jpg",

        status:
          FRAME_CAPTION_STATUS
            .ABSTAINED,

        caption:
          null,

        reason:
          "insufficient_visual_evidence",
      });


    assert.equal(
      result.status,
      FRAME_CAPTION_STATUS
        .ABSTAINED,
    );

    assert.equal(
      result.caption,
      null,
    );

    assert.equal(
      result.reason,
      "insufficient_visual_evidence",
    );
  },
);


test(
  "rejects generated results without caption text",
  () => {
    assert.throws(
      () =>
        createFrameCaptionResult({
          frameId:
            "frame_001.jpg",

          status:
            FRAME_CAPTION_STATUS
              .GENERATED,

          caption:
            "",
        }),

      /Generated captions require/,
    );
  },
);


test(
  "rejects caption text when status is abstained",
  () => {
    assert.throws(
      () =>
        createFrameCaptionResult({
          frameId:
            "frame_001.jpg",

          status:
            FRAME_CAPTION_STATUS
              .ABSTAINED,

          caption:
            "This should not exist.",
        }),

      /Abstained captions/,
    );
  },
);


test(
  "rejects an unsupported caption status",
  () => {
    assert.throws(
      () =>
        createFrameCaptionResult({
          frameId:
            "frame_001.jpg",

          status:
            "unknown",
        }),

      /Invalid frame caption status/,
    );
  },
);