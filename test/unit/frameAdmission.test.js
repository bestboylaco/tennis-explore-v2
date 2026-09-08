import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateFrameAdmission,
  FRAME_ADMISSION_MODE,
  FRAME_ADMISSION_REASON,
} from "../../src/modules/vision/index.js";


function createUsableFrameQuality() {
  return {
    frameId:
      "frame_001.jpg",

    status:
      "good",

    usable:
      true,

    qualityScore:
      0.9,

    issues:
      [],

    metrics:
      {},

    source:
      {},
  };
}


function createUnusableFrameQuality() {
  return {
    ...createUsableFrameQuality(),

    status:
      "bad",

    usable:
      false,

    qualityScore:
      0.2,
  };
}


function createVisiblePerson() {
  return {
    detected:
      true,

    personCount:
      1,

    maxCoverage:
      0.44,

    sufficientVisibility:
      true,
  };
}

function createInsufficientInterpretability() {
  return {
    frameId:
      "frame_001.jpg",

    mode:
      FRAME_ADMISSION_MODE
        .GENERAL_CAPTION,

    status:
      "insufficient",

    obstructionDetected:
      true,

    interpretable:
      false,

    evidenceEligible:
      false,

    reason:
      "Frame is too obstructed to interpret reliably.",
  };
}

function createSmallPerson() {
  return {
    detected:
      true,

    personCount:
      1,

    maxCoverage:
      0.05,

    sufficientVisibility:
      false,
  };
}


test(
  "general caption accepts a usable frame without a person",
  () => {
    const result =
      evaluateFrameAdmission({
        frameQuality:
          createUsableFrameQuality(),

        mode:
          FRAME_ADMISSION_MODE
            .GENERAL_CAPTION,
      });


    assert.equal(
      result.eligible,
      true,
    );

    assert.deepEqual(
      result.reasons,
      [],
    );
  },
);


test(
  "general caption rejects an unusable frame",
  () => {
    const result =
      evaluateFrameAdmission({
        frameQuality:
          createUnusableFrameQuality(),

        mode:
          FRAME_ADMISSION_MODE
            .GENERAL_CAPTION,
      });


    assert.equal(
      result.eligible,
      false,
    );

    assert.deepEqual(
      result.reasons,
      [
        FRAME_ADMISSION_REASON
          .QUALITY_UNUSABLE,
      ],
    );
  },
);


test(
  "person analysis accepts a usable frame with sufficient visibility",
  () => {
    const result =
      evaluateFrameAdmission({
        frameQuality:
          createUsableFrameQuality(),

        personVisibility:
          createVisiblePerson(),

        mode:
          FRAME_ADMISSION_MODE
            .PERSON_ANALYSIS,
      });


    assert.equal(
      result.eligible,
      true,
    );
  },
);


test(
  "person analysis rejects insufficient person visibility",
  () => {
    const result =
      evaluateFrameAdmission({
        frameQuality:
          createUsableFrameQuality(),

        personVisibility:
          createSmallPerson(),

        mode:
          FRAME_ADMISSION_MODE
            .PERSON_ANALYSIS,
      });


    assert.equal(
      result.eligible,
      false,
    );

    assert.deepEqual(
      result.reasons,
      [
        FRAME_ADMISSION_REASON
          .PERSON_VISIBILITY_INSUFFICIENT,
      ],
    );
  },
);


test(
  "person analysis rejects unusable quality even when person visibility is sufficient",
  () => {
    const result =
      evaluateFrameAdmission({
        frameQuality:
          createUnusableFrameQuality(),

        personVisibility:
          createVisiblePerson(),

        mode:
          FRAME_ADMISSION_MODE
            .PERSON_ANALYSIS,
      });


    assert.equal(
      result.eligible,
      false,
    );

    assert.deepEqual(
      result.reasons,
      [
        FRAME_ADMISSION_REASON
          .QUALITY_UNUSABLE,
      ],
    );
  },
);


test(
  "person analysis requires a person visibility result",
  () => {
    assert.throws(
      () =>
        evaluateFrameAdmission({
          frameQuality:
            createUsableFrameQuality(),

          mode:
            FRAME_ADMISSION_MODE
              .PERSON_ANALYSIS,
        }),

      /personVisibility is required/,
    );
  },
);


test(
  "rejects an unsupported admission mode",
  () => {
    assert.throws(
      () =>
        evaluateFrameAdmission({
          frameQuality:
            createUsableFrameQuality(),

          mode:
            "something_else",
        }),

      /Invalid frame admission mode/,
    );
  },
);

test(
  "general caption rejects insufficient interpretability",
  () => {
    const interpretability =
      createInsufficientInterpretability();

    const result =
      evaluateFrameAdmission({
        frameQuality:
          createUsableFrameQuality(),

        interpretability,

        mode:
          FRAME_ADMISSION_MODE
            .GENERAL_CAPTION,
      });


    assert.equal(
      result.eligible,
      false,
    );

    assert.deepEqual(
      result.reasons,
      [
        FRAME_ADMISSION_REASON
          .INTERPRETABILITY_INSUFFICIENT,
      ],
    );

    assert.equal(
      result.interpretability
        .evidenceEligible,
      false,
    );
  },
);