import test from "node:test";

import assert from "node:assert/strict";

import {
  createFrameInterpretabilityResult,
} from "../../src/modules/vision/types/frameInterpretability.types.js";


test(
  "creates a clear interpretability result",
  () => {
    const result =
      createFrameInterpretabilityResult({
        frameId:
          "frame_001.jpg",

        mode:
          "general_caption",

        status:
          "clear",

        obstructionDetected:
          false,

        reason:
          "Important visible information is not obstructed.",
      });


    assert.equal(
      result.status,
      "clear",
    );

    assert.equal(
      result.obstructionDetected,
      false,
    );

    assert.equal(
      result.interpretable,
      true,
    );

    assert.equal(
      result.evidenceEligible,
      true,
    );
  },
);


test(
  "allows partially obstructed evidence",
  () => {
    const result =
      createFrameInterpretabilityResult({
        frameId:
          "frame_001.jpg",

        mode:
          "general_caption",

        status:
          "partially_obstructed",

        obstructionDetected:
          true,

        reason:
          "Some content is blocked but useful information remains.",
      });


    assert.equal(
      result.obstructionDetected,
      true,
    );

    assert.equal(
      result.interpretable,
      true,
    );

    assert.equal(
      result.evidenceEligible,
      true,
    );
  },
);


test(
  "rejects insufficient interpretability",
  () => {
    const result =
      createFrameInterpretabilityResult({
        frameId:
          "frame_001.jpg",

        mode:
          "general_caption",

        status:
          "insufficient",

        obstructionDetected:
          true,

        reason:
          "Important visual information is blocked.",
      });


    assert.equal(
      result.interpretable,
      false,
    );

    assert.equal(
      result.evidenceEligible,
      false,
    );
  },
);


test(
  "rejects an invalid status",
  () => {
    assert.throws(
      () =>
        createFrameInterpretabilityResult({
          frameId:
            "frame_001.jpg",

          mode:
            "general_caption",

          status:
            "unknown",

          obstructionDetected:
            false,

          reason:
            "Invalid test.",
        }),

      /Invalid frame interpretability status/,
    );
  },
);


test(
  "requires a reason",
  () => {
    assert.throws(
      () =>
        createFrameInterpretabilityResult({
          frameId:
            "frame_001.jpg",

          mode:
            "general_caption",

          status:
            "clear",

          obstructionDetected:
            false,

          reason:
            "",
        }),

      /Interpretability reason must be provided/,
    );
  },
);