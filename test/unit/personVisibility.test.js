import test from "node:test";

import assert from "node:assert/strict";

import {
  evaluatePersonVisibility,
} from "../../src/modules/vision/index.js";


test(
  "reports no person when detections are empty",
  () => {
    const result =
      evaluatePersonVisibility({
        detections:
          [],

        imageWidth:
          1920,

        imageHeight:
          1080,
      });


    assert.equal(
      result.detected,
      false,
    );

    assert.equal(
      result.personCount,
      0,
    );

    assert.equal(
      result.sufficientVisibility,
      false,
    );
  },
);


test(
  "detects a clearly visible person",
  () => {
    const result =
      evaluatePersonVisibility({
        detections: [
          {
            label:
              "person",

            confidence:
              0.95,

            box: {
              x:
                500,

              y:
                100,

              width:
                500,

              height:
                800,
            },
          },
        ],

        imageWidth:
          1920,

        imageHeight:
          1080,

        minCoverage:
          0.03,
      });


    assert.equal(
      result.detected,
      true,
    );

    assert.equal(
      result.personCount,
      1,
    );

    assert.equal(
      result.sufficientVisibility,
      true,
    );

    assert.ok(
      result.maxCoverage >
      0.03,
    );
  },
);


test(
  "marks a tiny person as insufficient visibility",
  () => {
    const result =
      evaluatePersonVisibility({
        detections: [
          {
            label:
              "person",

            confidence:
              0.9,

            box: {
              x:
                100,

              y:
                100,

              width:
                80,

              height:
                120,
            },
          },
        ],

        imageWidth:
          1920,

        imageHeight:
          1080,

        minCoverage:
          0.03,
      });


    assert.equal(
      result.detected,
      true,
    );

    assert.equal(
      result.sufficientVisibility,
      false,
    );
  },
);


test(
  "ignores low-confidence person detections",
  () => {
    const result =
      evaluatePersonVisibility({
        detections: [
          {
            label:
              "person",

            confidence:
              0.2,

            box: {
              width:
                500,

              height:
                800,
            },
          },
        ],

        imageWidth:
          1920,

        imageHeight:
          1080,

        minConfidence:
          0.5,
      });


    assert.equal(
      result.detected,
      false,
    );
  },
);


test(
  "ignores non-person objects",
  () => {
    const result =
      evaluatePersonVisibility({
        detections: [
          {
            label:
              "sports ball",

            confidence:
              0.95,

            box: {
              width:
                100,

              height:
                100,
            },
          },
        ],

        imageWidth:
          1920,

        imageHeight:
          1080,
      });


    assert.equal(
      result.detected,
      false,
    );
  },
);


test(
  "counts multiple visible people",
  () => {
    const result =
      evaluatePersonVisibility({
        detections: [
          {
            label:
              "person",

            confidence:
              0.9,

            box: {
              width:
                400,

              height:
                700,
            },
          },

          {
            label:
              "person",

            confidence:
              0.88,

            box: {
              width:
                300,

              height:
                600,
            },
          },
        ],

        imageWidth:
          1920,

        imageHeight:
          1080,
      });


    assert.equal(
      result.personCount,
      2,
    );

    assert.equal(
      result.detected,
      true,
    );
  },
);


test(
  "rejects invalid image dimensions",
  () => {
    assert.throws(
      () =>
        evaluatePersonVisibility({
          detections:
            [],

          imageWidth:
            0,

          imageHeight:
            1080,
        }),

      /imageWidth/,
    );
  },
);