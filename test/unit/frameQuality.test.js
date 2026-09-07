import test from "node:test";

import assert from "node:assert/strict";

import {
  FRAME_QUALITY_STATUS,
  evaluateFrameQuality,
} from "../../src/modules/vision/index.js";


const TEST_THRESHOLDS = {
  minWidth:
    640,

  minHeight:
    360,


  badMinBrightness:
    30,

  cautionMinBrightness:
    50,

  cautionMaxBrightness:
    210,

  badMaxBrightness:
    230,


  badMinContrast:
    15,

  cautionMinContrast:
    25,


  badMinSharpness:
    20,

  cautionMinSharpness:
    50,


  cautionMinNoiseScore:
    5,

  badMinNoiseScore:
    15,


  badMinBlockinessScore:
    1.5,
};


test(
  "classifies a healthy frame as GOOD",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-good",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            0,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,
      });


    assert.equal(
      result.status,
      FRAME_QUALITY_STATUS.GOOD,
    );

    assert.equal(
      result.usable,
      true,
    );

    assert.deepEqual(
      result.issues,
      [],
    );
  },
);


test(
  "classifies a borderline blurry frame as CAUTION",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-caution",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            35,

          noiseScore:
            0,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,
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
  "classifies a severely blurry frame as BAD",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-blurry",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            10,

          noiseScore:
            0,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,
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
        "severe_blur",
      ),
    );
  },
);


test(
  "classifies a moderately noisy frame as CAUTION",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-noise-moderate",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            7,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,
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
        "moderate_noise",
      ),
    );
  },
);


test(
  "classifies a severely noisy frame as BAD",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-noise-severe",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            18,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,
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
        "severe_noise",
      ),
    );
  },
);


test(
  "classifies severe compression as BAD",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-compressed",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            0,

          blockinessScore:
            2,
        },

        thresholds:
          TEST_THRESHOLDS,
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
        "severe_compression",
      ),
    );
  },
);


test(
  "does not treat low resolution as compression evidence",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-small-blocky",

        metrics: {
          width:
            320,

          height:
            180,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            0,

          blockinessScore:
            9,
        },

        thresholds:
          TEST_THRESHOLDS,
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

    assert.equal(
      result.issues.includes(
        "severe_compression",
      ),
      false,
    );
  },
);


test(
  "classifies a dark frame as BAD",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-dark",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            15,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            0,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,
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
        "too_dark",
      ),
    );
  },
);


test(
  "classifies an overexposed frame as BAD",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-overexposed",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            245,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            0,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,
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
        "overexposed",
      ),
    );
  },
);


test(
  "classifies a low-resolution frame as BAD",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-small",

        metrics: {
          width:
            320,

          height:
            180,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            0,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,
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


test(
  "preserves source traceability",
  () => {
    const result =
      evaluateFrameQuality({
        frameId:
          "frame-421",

        metrics: {
          width:
            1920,

          height:
            1080,

          brightness:
            120,

          contrast:
            55,

          sharpness:
            100,

          noiseScore:
            0,

          blockinessScore:
            0,
        },

        thresholds:
          TEST_THRESHOLDS,

        source: {
          videoId:
            "video-001",

          timestampSeconds:
            138.4,

          framePath:
            "frame-421.jpg",
        },
      });


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