import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateFrameInterpretability,
} from "../../src/modules/vision/services/frameInterpretability.service.js";


function createFakeResponse({
  status,
  obstructionDetected,
  reason,
}) {
  return async () => ({
    ok: true,

    json: async () => ({
      message: {
        content: JSON.stringify({
          status,
          obstructionDetected,
          reason,
        }),
      },
    }),
  });
}


test(
  "classifies a clear frame",
  async () => {
    const result =
      await evaluateFrameInterpretability({
        frameId:
          "frame_001.jpg",

        imageInput:
          Buffer.from("fake-image"),

        mode:
          "general_caption",

        fetchFn:
          createFakeResponse({
            status:
              "clear",

            obstructionDetected:
              false,

            reason:
              "Important information is visible.",
          }),
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
  "flags partial obstruction but keeps evidence eligible",
  async () => {
    const result =
      await evaluateFrameInterpretability({
        frameId:
          "frame_002.jpg",

        imageInput:
          Buffer.from("fake-image"),

        mode:
          "general_caption",

        fetchFn:
          createFakeResponse({
            status:
              "partially_obstructed",

            obstructionDetected:
              true,

            reason:
              "Part of the image is blocked but useful information remains.",
          }),
      });


    assert.equal(
      result.status,
      "partially_obstructed",
    );

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
  "marks insufficient obstruction as ineligible",
  async () => {
    const result =
      await evaluateFrameInterpretability({
        frameId:
          "frame_003.jpg",

        imageInput:
          Buffer.from("fake-image"),

        mode:
          "general_caption",

        fetchFn:
          createFakeResponse({
            status:
              "insufficient",

            obstructionDetected:
              true,

            reason:
              "Important visual information is blocked.",
          }),
      });


    assert.equal(
      result.status,
      "insufficient",
    );

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
  "rejects invalid JSON returned by the model",
  async () => {
    const fetchFn =
      async () => ({
        ok: true,

        json: async () => ({
          message: {
            content:
              "not-json",
          },
        }),
      });


    await assert.rejects(
      () =>
        evaluateFrameInterpretability({
          frameId:
            "frame_004.jpg",

          imageInput:
            Buffer.from("fake-image"),

          mode:
            "general_caption",

          fetchFn,
        }),

      /invalid JSON/,
    );
  },
);


test(
  "throws when the interpretability request fails",
  async () => {
    const fetchFn =
      async () => ({
        ok: false,

        status: 500,

        text: async () =>
          "model unavailable",
      });


    await assert.rejects(
      () =>
        evaluateFrameInterpretability({
          frameId:
            "frame_005.jpg",

          imageInput:
            Buffer.from("fake-image"),

          mode:
            "general_caption",

          fetchFn,
        }),

      /Interpretability request failed with status 500/,
    );
  },
);