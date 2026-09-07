import test from "node:test";

import assert from "node:assert/strict";

import {
  buildTrustedVisualEvidence,
} from "../../src/modules/vision/services/trustedVisualEvidence.service.js";


function createBaseInput() {
  return {
    frameQuality: {
      frameId:
        "frame_001.jpg",

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

        brightness:
          120,

        contrast:
          55,

        sharpness:
          1,

        noiseScore:
          0,

        blockinessScore:
          0.2,
      },

      source: {
        videoId:
          "video-001",

        timestampSeconds:
          45,

        framePath:
          "frame_001.jpg",
      },
    },

    admission: {
      eligible:
        true,
    },

    caption: {
      frameId:
        "frame_001.jpg",

      status:
        "generated",

      caption:
        "A conference slide is visible.",

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

      source: {
        videoId:
          "video-001",

        timestampSeconds:
          45,

        framePath:
          "frame_001.jpg",
      },
    },

    verification: {
      frameId:
        "frame_001.jpg",

      status:
        "verified",

      evidenceEligible:
        true,

      rawCaption:
        "A conference slide is visible.",

      issues:
        [],

      checks: {
        captionGenerated:
          true,

        speculativeLanguage:
          false,

        promptVersionPresent:
          true,

        sourceTraceable:
          true,
      },
    },
  };
}


test(
  "builds trusted evidence when every gate passes",
  () => {
    const result =
      buildTrustedVisualEvidence(
        createBaseInput(),
      );


    assert.equal(
      result.status,
      "trusted",
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
  "rejects evidence when frame quality is unusable",
  () => {
    const input =
      createBaseInput();


    input.frameQuality.status =
      "bad";

    input.frameQuality.usable =
      false;

    input.frameQuality.qualityScore =
      0;

    input.frameQuality.issues = [
      "severe_noise",
    ];

    input.admission.eligible =
      false;

    input.caption.status =
      "abstained";

    input.caption.caption =
      null;

    input.caption.reason =
      "quality_unusable";

    input.verification.status =
      "abstained";

    input.verification.evidenceEligible =
      false;


    const result =
      buildTrustedVisualEvidence(
        input,
      );


    assert.equal(
      result.status,
      "rejected",
    );

    assert.equal(
      result.evidenceEligible,
      false,
    );

    assert.ok(
      result.quality.issues.includes(
        "severe_noise",
      ),
    );
  },
);


test(
  "rejects evidence when admission fails",
  () => {
    const input =
      createBaseInput();


    input.admission.eligible =
      false;

    input.caption.status =
      "abstained";

    input.caption.caption =
      null;

    input.caption.reason =
      "person_visibility_insufficient";

    input.verification.status =
      "abstained";

    input.verification.evidenceEligible =
      false;


    const result =
      buildTrustedVisualEvidence(
        input,
      );


    assert.equal(
      result.status,
      "rejected",
    );

    assert.equal(
      result.evidenceEligible,
      false,
    );
  },
);


test(
  "rejects generated caption when verification is not eligible",
  () => {
    const input =
      createBaseInput();


    input.verification.status =
      "unreliable";

    input.verification.evidenceEligible =
      false;

    input.verification.issues = [
      "missing_source_traceability",
    ];


    const result =
      buildTrustedVisualEvidence(
        input,
      );


    assert.equal(
      result.status,
      "rejected",
    );

    assert.equal(
      result.evidenceEligible,
      false,
    );

    assert.equal(
      result.caption.text,
      "A conference slide is visible.",
    );
  },
);


test(
  "preserves visual evidence source traceability",
  () => {
    const result =
      buildTrustedVisualEvidence(
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