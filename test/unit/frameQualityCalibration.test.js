import test from "node:test";

import assert from "node:assert/strict";

import {
  FRAME_QUALITY_STATUS,
  FRAME_QUALITY_THRESHOLDS,
  evaluateFrameQuality,
} from "../../src/modules/vision/index.js";


function classify(metrics) {
  return evaluateFrameQuality({
    frameId:
      "calibration-frame",

    metrics: {
      noiseScore: 0,
      blockinessScore: 0,
      ...metrics,
    },

    thresholds:
      FRAME_QUALITY_THRESHOLDS,
  });
}


test(
  "accepts a representative original frame",
  () => {
    const result =
      classify({
        width:
          1920,

        height:
          1080,

        brightness:
          145.439,

        contrast:
          113.452,

        sharpness:
          3.724,
      });


    assert.equal(
      result.status,
      FRAME_QUALITY_STATUS.GOOD,
    );

    assert.equal(
      result.usable,
      true,
    );
  },
);


test(
  "allows mild blur",
  () => {
    const result =
      classify({
        width:
          1920,

        height:
          1080,

        brightness:
          145.466,

        contrast:
          112.133,

        sharpness:
          1.8,
      });


    assert.equal(
      result.status,
      FRAME_QUALITY_STATUS.GOOD,
    );
  },
);


test(
  "flags medium blur as caution",
  () => {
    const result =
      classify({
        width:
          1920,

        height:
          1080,

        brightness:
          145.857,

        contrast:
          109.516,

        sharpness:
          0.259,
      });


    assert.equal(
      result.status,
      FRAME_QUALITY_STATUS.CAUTION,
    );

    assert.equal(
      result.usable,
      true,
    );

    assert.ok(
      result.issues.includes(
        "moderate_blur",
      ),
    );
  },
);


test(
  "rejects severe blur",
  () => {
    const result =
      classify({
        width:
          1920,

        height:
          1080,

        brightness:
          145.571,

        contrast:
          106.699,

        sharpness:
          0.119,
      });


    assert.equal(
      result.status,
      FRAME_QUALITY_STATUS.BAD,
    );

    assert.equal(
      result.usable,
      false,
    );
  },
);


test(
  "flags a dark frame as caution",
  () => {
    const result =
      classify({
        width:
          1920,

        height:
          1080,

        brightness:
          62.066,

        contrast:
          48.191,

        sharpness:
          1.538,
      });


    assert.equal(
      result.status,
      FRAME_QUALITY_STATUS.CAUTION,
    );
  },
);


test(
  "rejects a very dark frame",
  () => {
    const result =
      classify({
        width:
          1920,

        height:
          1080,

        brightness:
          29.31,

        contrast:
          24.318,

        sharpness:
          0.706,
      });


    assert.equal(
      result.status,
      FRAME_QUALITY_STATUS.BAD,
    );

    assert.equal(
      result.usable,
      false,
    );
  },
);


test(
  "rejects a genuinely low-resolution frame",
  () => {
    const result =
      classify({
        width:
          240,

        height:
          135,

        brightness:
          145.039,

        contrast:
          108.13,

        sharpness:
          5.823,
      });


    assert.equal(
      result.status,
      FRAME_QUALITY_STATUS.BAD,
    );

    assert.equal(
      result.usable,
      false,
    );

    assert.ok(
      result.issues.includes(
        "low_resolution",
      ),
    );
  },
);