import test from "node:test";
import assert from "node:assert/strict";

import {
  verifyFrameCaption,
  CAPTION_VERIFICATION_STATUS,
  CAPTION_VERIFICATION_ISSUE,
} from "../../src/modules/vision/index.js";


function createCaption(
  overrides = {},
) {
  return {
    frameId:
      "frame_001.jpg",

    status:
      "generated",

    caption:
      "A person stands in front of a blue conference background.",

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
        "video-123",

      timestampSeconds:
        0,

      framePath:
        "frames/frame_001.jpg",
    },

    ...overrides,
  };
}


test(
  "verifies a clean generated caption",
  () => {
    const result =
      verifyFrameCaption({
        captionResult:
          createCaption(),
      });


    assert.equal(
      result.status,
      CAPTION_VERIFICATION_STATUS
        .VERIFIED,
    );

    assert.equal(
      result.evidenceEligible,
      true,
    );

    assert.deepEqual(
      result.issues,
      [],
    );
  },
);


test(
  "preserves the raw caption",
  () => {
    const caption =
      "A person stands beside a presentation slide.";


    const result =
      verifyFrameCaption({
        captionResult:
          createCaption({
            caption,
          }),
      });


    assert.equal(
      result.rawCaption,
      caption,
    );
  },
);


test(
  "flags speculative language without deleting the caption",
  () => {
    const caption =
      "The person is probably a tennis coach.";


    const result =
      verifyFrameCaption({
        captionResult:
          createCaption({
            caption,
          }),
      });


    assert.equal(
      result.status,
      CAPTION_VERIFICATION_STATUS
        .VERIFIED_WITH_WARNINGS,
    );

    assert.equal(
      result.evidenceEligible,
      true,
    );

    assert.equal(
      result.rawCaption,
      caption,
    );

    assert.ok(
      result.issues.includes(
        CAPTION_VERIFICATION_ISSUE
          .SPECULATIVE_LANGUAGE,
      ),
    );
  },
);


test(
  "flags a missing prompt version",
  () => {
    const result =
      verifyFrameCaption({
        captionResult:
          createCaption({
            generation: {
              provider:
                "ollama",

              model:
                "qwen3-vl:8b",
            },
          }),
      });


    assert.ok(
      result.issues.includes(
        CAPTION_VERIFICATION_ISSUE
          .MISSING_PROMPT_VERSION,
      ),
    );
  },
);


test(
  "flags missing source traceability",
  () => {
    const result =
      verifyFrameCaption({
        captionResult:
          createCaption({
            source: {},
          }),
      });


    assert.ok(
      result.issues.includes(
        CAPTION_VERIFICATION_ISSUE
          .MISSING_SOURCE_TRACEABILITY,
      ),
    );
  },
);


test(
  "returns abstained when no caption was generated",
  () => {
    const result =
      verifyFrameCaption({
        captionResult: {
          frameId:
            "frame_002.jpg",

          status:
            "abstained",

          caption:
            null,
        },
      });


    assert.equal(
      result.status,
      CAPTION_VERIFICATION_STATUS
        .ABSTAINED,
    );

    assert.equal(
      result.evidenceEligible,
      false,
    );

    assert.equal(
      result.rawCaption,
      null,
    );
  },
);


test(
  "rejects unsupported caption status",
  () => {
    assert.throws(
      () =>
        verifyFrameCaption({
          captionResult:
            createCaption({
              status:
                "unknown",
            }),
        }),

      /Unsupported caption status/,
    );
  },
);