import test from "node:test";

import assert from "node:assert/strict";

import {
  createPersonVisibilityResult,
} from "../../src/modules/vision/index.js";


test(
  "creates a result for a clearly visible person",
  () => {
    const result =
      createPersonVisibilityResult({
        detected:
          true,

        personCount:
          1,

        maxCoverage:
          0.28,

        sufficientVisibility:
          true,
      });


    assert.deepEqual(
      result,
      {
        detected:
          true,

        personCount:
          1,

        maxCoverage:
          0.28,

        sufficientVisibility:
          true,
      },
    );
  },
);


test(
  "creates a result when no person is detected",
  () => {
    const result =
      createPersonVisibilityResult({
        detected:
          false,

        personCount:
          0,

        maxCoverage:
          0,

        sufficientVisibility:
          false,
      });


    assert.equal(
      result.detected,
      false,
    );

    assert.equal(
      result.sufficientVisibility,
      false,
    );
  },
);


test(
  "allows a detected person with low visibility",
  () => {
    const result =
      createPersonVisibilityResult({
        detected:
          true,

        personCount:
          1,

        maxCoverage:
          0.02,

        sufficientVisibility:
          false,
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
  "supports multiple detected people",
  () => {
    const result =
      createPersonVisibilityResult({
        detected:
          true,

        personCount:
          3,

        maxCoverage:
          0.21,

        sufficientVisibility:
          true,
      });


    assert.equal(
      result.personCount,
      3,
    );
  },
);


test(
  "rejects coverage outside the 0 to 1 range",
  () => {
    assert.throws(
      () =>
        createPersonVisibilityResult({
          detected:
            true,

          personCount:
            1,

          maxCoverage:
            1.5,

          sufficientVisibility:
            true,
        }),

      /maxCoverage/,
    );
  },
);


test(
  "rejects inconsistent no-person results",
  () => {
    assert.throws(
      () =>
        createPersonVisibilityResult({
          detected:
            false,

          personCount:
            1,

          maxCoverage:
            0,

          sufficientVisibility:
            false,
        }),

      /personCount/,
    );
  },
);


test(
  "cannot mark visibility sufficient without a detected person",
  () => {
    assert.throws(
      () =>
        createPersonVisibilityResult({
          detected:
            false,

          personCount:
            0,

          maxCoverage:
            0,

          sufficientVisibility:
            true,
        }),

      /sufficientVisibility/,
    );
  },
);