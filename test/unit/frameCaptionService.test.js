import test from "node:test";
import assert from "node:assert/strict";

import {
  createFrameCaptionProvider,
  generateFrameCaption,
  FRAME_CAPTION_STATUS,
} from "../../src/modules/vision/index.js";


function createProvider() {
  return createFrameCaptionProvider({
    name:
      "test-provider",

    model:
      "test-model",

    generate:
      async () =>
        "A presenter is visible beside a slide.",
  });
}


test(
  "generates a caption for an admitted frame",
  async () => {
    const provider =
      createProvider();


    const result =
      await generateFrameCaption({
        frameId:
          "frame_001.jpg",

        imageInput:
          "frame_001.jpg",

        admission: {
          eligible:
            true,

          reasons:
            [],
        },

        provider,
      });


    assert.equal(
      result.status,
      FRAME_CAPTION_STATUS
        .GENERATED,
    );

    assert.equal(
      result.caption,
      "A presenter is visible beside a slide.",
    );

    assert.equal(
      result.generation.provider,
      "test-provider",
    );
  },
);


test(
  "abstains when the frame is not admitted",
  async () => {
    let providerCalled =
      false;


    const provider =
      createFrameCaptionProvider({
        name:
          "test-provider",

        model:
          "test-model",

        generate:
          async () => {
            providerCalled =
              true;

            return "Should not run.";
          },
      });


    const result =
      await generateFrameCaption({
        frameId:
          "frame_002.jpg",

        imageInput:
          "frame_002.jpg",

        admission: {
          eligible:
            false,

          reasons: [
            "quality_unusable",
          ],
        },

        provider,
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
      "quality_unusable",
    );

    assert.equal(
      providerCalled,
      false,
    );
  },
);


test(
  "preserves source metadata",
  async () => {
    const provider =
      createProvider();


    const result =
      await generateFrameCaption({
        frameId:
          "frame_010.jpg",

        imageInput:
          "frame_010.jpg",

        admission: {
          eligible:
            true,

          reasons:
            [],
        },

        provider,

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
  },
);


test(
  "rejects a missing caption provider",
  async () => {
    await assert.rejects(
      () =>
        generateFrameCaption({
          frameId:
            "frame_001.jpg",

          imageInput:
            "frame_001.jpg",

          admission: {
            eligible:
              true,

            reasons:
              [],
          },
        }),

      /valid caption provider/,
    );
  },
);


test(
  "rejects invalid image input",
  async () => {
    const provider =
      createProvider();


    await assert.rejects(
      () =>
        generateFrameCaption({
          frameId:
            "frame_001.jpg",

          imageInput:
            123,

          admission: {
            eligible:
              true,

            reasons:
              [],
          },

          provider,
        }),

      /imageInput must be/,
    );
  },
);


test(
  "rejects an invalid admission result",
  async () => {
    const provider =
      createProvider();


    await assert.rejects(
      () =>
        generateFrameCaption({
          frameId:
            "frame_001.jpg",

          imageInput:
            "frame_001.jpg",

          admission: {},

          provider,
        }),

      /admission.eligible/,
    );
  },
);

test(
  "records the caption prompt version",
  async () => {
    const provider =
      createProvider();


    const result =
      await generateFrameCaption({
        frameId:
          "frame_001.jpg",

        imageInput:
          "frame_001.jpg",

        admission: {
          eligible:
            true,

          reasons:
            [],
        },

        provider,
      });


    assert.equal(
      result.generation.promptVersion,
      "frame-caption-v1",
    );
  },
);