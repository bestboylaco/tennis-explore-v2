import test from "node:test";

import assert from "node:assert/strict";

import {
  FRAME_QUALITY_STATUS,
  createFrameQualityResult,
} from "../../src/modules/vision/index.js";


test(
  "creates a valid GOOD frame quality result",
  () => {
    const result =
      createFrameQualityResult({
        frameId:
          "frame-00421",

        status:
          FRAME_QUALITY_STATUS.GOOD,

        usable:
          true,

        qualityScore:
          0.88,

        issues:
          [],

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            118,

          contrast:
            51,

          sharpness:
            226,
        },

        source: {
          videoId:
            "video-001",

          timestampSeconds:
            138.4,

          framePath:
            "frame-00421.jpg",
        },
      });


    assert.equal(
      result.status,
      "good",
    );

    assert.equal(
      result.usable,
      true,
    );

    assert.equal(
      result.qualityScore,
      0.88,
    );

    assert.equal(
      result.source.videoId,
      "video-001",
    );

    assert.equal(
      result.source.timestampSeconds,
      138.4,
    );
  },
);


test(
  "creates a valid BAD frame quality result",
  () => {
    const result =
      createFrameQualityResult({
        frameId:
          "frame-00422",

        status:
          FRAME_QUALITY_STATUS.BAD,

        usable:
          false,

        qualityScore:
          0.21,

        issues: [
          "severe_blur",
          "too_dark",
        ],

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            19,

          contrast:
            14,

          sharpness:
            25,
        },
      });


    assert.equal(
      result.status,
      "bad",
    );

    assert.equal(
      result.usable,
      false,
    );

    assert.deepEqual(
      result.issues,
      [
        "severe_blur",
        "too_dark",
      ],
    );
  },
);


test(
  "rejects a quality score outside the 0 to 1 range",
  () => {
    assert.throws(
      () =>
        createFrameQualityResult({
          frameId:
            "frame-invalid",

          status:
            FRAME_QUALITY_STATUS.GOOD,

          usable:
            true,

          qualityScore:
            1.5,
        }),

      /qualityScore/,
    );
  },
);


test(
  "rejects an unknown quality status",
  () => {
    assert.throws(
      () =>
        createFrameQualityResult({
          frameId:
            "frame-invalid",

          status:
            "excellent",

          usable:
            true,

          qualityScore:
            0.9,
        }),

      /Invalid frame quality status/,
    );
  },
);