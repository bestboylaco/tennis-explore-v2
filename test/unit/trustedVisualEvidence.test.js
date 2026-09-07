import test from "node:test";

import assert from "node:assert/strict";

import {
  TRUSTED_VISUAL_EVIDENCE_STATUS,
} from "../../src/modules/vision/constants/trustedVisualEvidence.constants.js";

import {
  createTrustedVisualEvidence,
} from "../../src/modules/vision/types/trustedVisualEvidence.types.js";


function createBaseInput() {
  return {
    frameId:
      "frame_001.jpg",

    status:
      TRUSTED_VISUAL_EVIDENCE_STATUS.TRUSTED,

    evidenceEligible:
      true,

    quality: {
      status:
        "good",

      usable:
        true,

      qualityScore:
        1,

      issues:
        [],

      metrics: {
        width:
          1920,

        height:
          1080,

        noiseScore:
          0,

        blockinessScore:
          0.2,
      },
    },

    caption: {
      text:
        "A conference slide is visible.",

      status:
        "generated",

      reason:
        null,

      generation: {
        provider:
          "ollama",

        model:
          "qwen3-vl:8b",

        promptVersion:
          "frame-caption-v1",
      },
    },

    verification: {
      status:
        "verified",

      evidenceEligible:
        true,

      issues:
        [],
    },

    grounding:
      null,

    source: {
      videoId:
        "video-001",

      timestampSeconds:
        45,

      framePath:
        "frame_001.jpg",
    },
  };
}


test(
  "creates trusted visual evidence",
  () => {
    const result =
      createTrustedVisualEvidence(
        createBaseInput(),
      );


    assert.equal(
      result.status,
      TRUSTED_VISUAL_EVIDENCE_STATUS.TRUSTED,
    );

    assert.equal(
      result.evidenceEligible,
      true,
    );

    assert.equal(
      result.caption.text,
      "A conference slide is visible.",
    );
  },
);


test(
  "preserves quality metadata",
  () => {
    const result =
      createTrustedVisualEvidence(
        createBaseInput(),
      );


    assert.equal(
      result.quality.status,
      "good",
    );

    assert.equal(
      result.quality.qualityScore,
      1,
    );

    assert.equal(
      result.quality.metrics.noiseScore,
      0,
    );
  },
);


test(
  "preserves source traceability",
  () => {
    const result =
      createTrustedVisualEvidence(
        createBaseInput(),
      );


    assert.equal(
      result.source.videoId,
      "video-001",
    );

    assert.equal(
      result.source.timestampSeconds,
      45,
    );

    assert.equal(
      result.source.framePath,
      "frame_001.jpg",
    );
  },
);


test(
  "allows rejected visual evidence",
  () => {
    const input =
      createBaseInput();


    input.status =
      TRUSTED_VISUAL_EVIDENCE_STATUS.REJECTED;

    input.evidenceEligible =
      false;

    input.caption = {
      text:
        null,

      status:
        "abstained",

      reason:
        "quality_unusable",

      generation:
        null,
    };

    input.verification = {
      status:
        "abstained",

      evidenceEligible:
        false,

      issues:
        [],
    };


    const result =
      createTrustedVisualEvidence(
        input,
      );


    assert.equal(
      result.status,
      TRUSTED_VISUAL_EVIDENCE_STATUS.REJECTED,
    );

    assert.equal(
      result.evidenceEligible,
      false,
    );

    assert.equal(
      result.caption.text,
      null,
    );
  },
);


test(
  "rejects trusted status when evidence is not eligible",
  () => {
    const input =
      createBaseInput();


    input.evidenceEligible =
      false;


    assert.throws(
      () =>
        createTrustedVisualEvidence(
          input,
        ),
      /cannot have evidenceEligible=false/,
    );
  },
);


test(
  "rejects rejected status when evidence is eligible",
  () => {
    const input =
      createBaseInput();


    input.status =
      TRUSTED_VISUAL_EVIDENCE_STATUS.REJECTED;


    assert.throws(
      () =>
        createTrustedVisualEvidence(
          input,
        ),
      /cannot have evidenceEligible=true/,
    );
  },
);


test(
  "requires source traceability",
  () => {
    const input =
      createBaseInput();


    input.source = {};


    assert.throws(
      () =>
        createTrustedVisualEvidence(
          input,
        ),
      /requires framePath or videoId/,
    );
  },
);