import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_SYNTHESIS_MODES,
} from "../../src/modules/agent/agentSynthesis.service.js";

import {
  bootstrapSynthesis,
} from "../../src/modules/synthesis/synthesis.bootstrap.js";

import {
  clearSynthesisStrategies,
} from "../../src/modules/synthesis/synthesis.registry.js";

import {
  synthesize,
} from "../../src/modules/synthesis/synthesis.service.js";

import {
  bootstrapVerification,
} from "../../src/modules/verification/verification.bootstrap.js";

import {
  clearVerificationStrategies,
} from "../../src/modules/verification/verification.registry.js";

import {
  verifySynthesis,
} from "../../src/modules/verification/verifySynthesis.service.js";


function createDocumentsInput() {
  return {
    question:
      "What does the research say about return positioning?",

    mode:
      AGENT_SYNTHESIS_MODES.DOCUMENTS,

    documentEvidence: [
      {
        chunk_id:
          "chunk-1",

        doc_id:
          "doc-1",

        title:
          "Return Positioning Research",

        file_name:
          "return-positioning.pdf",

        text:
          "A deeper return position can provide players with more reaction time against higher serve speeds.",

        source_type:
          "research_paper",

        page:
          4,

        authors: [],

        source_uri:
          "/documents/return-positioning.pdf",
      },
    ],

    statisticsResults:
      [],

    successfulActionIds: [
      "documents",
    ],
  };
}


test(
  "documents synthesis flows through document grounding verification",
  async () => {
    clearSynthesisStrategies();
    clearVerificationStrategies();

    bootstrapSynthesis();
    bootstrapVerification();


    const synthesisInput =
      createDocumentsInput();


    const synthesis =
      await synthesize({
        mode:
          synthesisInput.mode,

        input:
          synthesisInput,

        context: {
          generateText:
            async () =>
              "A deeper return position can provide players with more reaction time against higher serve speeds [1].",
        },
      });


    const verification =
      await verifySynthesis({
        synthesisResult:
          synthesis,

        synthesisInput,
      });


    assert.equal(
      verification.verified,
      true
    );


    assert.equal(
      verification
        .checks
        .document_grounding
        .status,
      "passed"
    );


    assert.deepEqual(
      verification
        .checks
        .document_grounding
        .metadata
        .danglingCitations,
      []
    );


    assert.deepEqual(
      verification
        .checks
        .document_grounding
        .metadata
        .unsupportedNumbers,
      []
    );


    assert.equal(
      verification
        .checks
        .document_grounding
        .metadata
        .citations
        .length,
      1
    );
  }
);


test(
  "document verification detects a dangling citation",
  async () => {
    clearSynthesisStrategies();
    clearVerificationStrategies();

    bootstrapSynthesis();
    bootstrapVerification();


    const synthesisInput =
      createDocumentsInput();


    const synthesis =
      await synthesize({
        mode:
          synthesisInput.mode,

        input:
          synthesisInput,

        context: {
          generateText:
            async () =>
              "A deeper return position can provide players with more reaction time against higher serve speeds [7].",
        },
      });


    const verification =
      await verifySynthesis({
        synthesisResult:
          synthesis,

        synthesisInput,
      });


    assert.equal(
      verification.verified,
      false
    );


    assert.equal(
      verification
        .checks
        .document_grounding
        .status,
      "failed"
    );


    assert.deepEqual(
      verification
        .checks
        .document_grounding
        .metadata
        .danglingCitations,
      [
        7,
      ]
    );
  }
);


test(
  "document verification detects unsupported numbers",
  async () => {
    clearSynthesisStrategies();
    clearVerificationStrategies();

    bootstrapSynthesis();
    bootstrapVerification();


    const synthesisInput =
      createDocumentsInput();


    const synthesis =
      await synthesize({
        mode:
          synthesisInput.mode,

        input:
          synthesisInput,

        context: {
          generateText:
            async () =>
              "A deeper return position improves reaction time by 99 percent [1].",
        },
      });


    const verification =
      await verifySynthesis({
        synthesisResult:
          synthesis,

        synthesisInput,
      });


    assert.equal(
      verification.verified,
      false
    );


    assert.equal(
      verification
        .checks
        .document_grounding
        .status,
      "failed"
    );


    assert.ok(
      verification
        .checks
        .document_grounding
        .metadata
        .unsupportedNumbers
        .includes(
          "99"
        )
    );
  }
);  

test(
  "eligible visual evidence preserves quality metadata through document verification",
  async () => {
    clearSynthesisStrategies();
    clearVerificationStrategies();

    bootstrapSynthesis();
    bootstrapVerification();

    const synthesisInput = {
      question:
        "What is happening in the tennis frame?",

      mode:
        AGENT_SYNTHESIS_MODES.DOCUMENTS,

      documentEvidence: [
        {
          chunk_id:
            "visual-chunk-1",

          doc_id:
            "video-doc-1",

          title:
            "Tennis Coaching Session",

          file_name:
            "session.mp4",

          text:
            "The player is positioned near the baseline while preparing to return serve.",

          source_type:
            "video",

          source_uri:
            "/videos/session.mp4",

          derived_from_image:
            true,

          evidence_eligible:
            true,

          quality_status:
            "caution",

          quality_score:
            0.74,

          quality_issues: [
            "moderate_noise",
          ],

          verification_status:
            "verified",

          frame_id:
            "frame-001",

          video_id:
            "video-001",

          timestamp_seconds:
            45,
        },
      ],

      statisticsResults:
        [],

      successfulActionIds: [
        "documents",
      ],
    };


    const synthesis =
      await synthesize({
        mode:
          synthesisInput.mode,

        input:
          synthesisInput,

        context: {
          generateText:
            async () =>
              "The player is positioned near the baseline while preparing to return serve [1].",
        },
      });


    const verification =
      await verifySynthesis({
        synthesisResult:
          synthesis,

        synthesisInput,
      });


    assert.equal(
      verification.verified,
      true,
    );


    assert.equal(
      verification
        .checks
        .document_grounding
        .status,
      "passed",
    );


    const metadata =
      verification
        .checks
        .document_grounding
        .metadata;


    assert.equal(
      metadata
        .visualEvidenceQuality
        .length,
      1,
    );


    assert.deepEqual(
      metadata
        .visualEvidenceQuality[0],
      {
        chunkId:
          "visual-chunk-1",

        qualityStatus:
          "caution",

        qualityScore:
          0.74,

        qualityIssues: [
          "moderate_noise",
        ],

        verificationStatus:
          "verified",

        evidenceEligible:
          true,
      },
    );


    assert.deepEqual(
      metadata
        .ineligibleVisualEvidence,
      [],
    );
  },
);


test(
  "ineligible visual evidence fails document verification",
  async () => {
    clearSynthesisStrategies();
    clearVerificationStrategies();

    bootstrapSynthesis();
    bootstrapVerification();

    const synthesisInput = {
      question:
        "What is happening in the tennis frame?",

      mode:
        AGENT_SYNTHESIS_MODES.DOCUMENTS,

      documentEvidence: [
        {
          chunk_id:
            "visual-chunk-bad",

          doc_id:
            "video-doc-1",

          title:
            "Tennis Coaching Session",

          file_name:
            "session.mp4",

          text:
            "The frame contains tennis activity.",

          source_type:
            "video",

          source_uri:
            "/videos/session.mp4",

          derived_from_image:
            true,

          evidence_eligible:
            false,

          quality_status:
            "bad",

          quality_score:
            0.18,

          quality_issues: [
            "severe_noise",
            "poor_lighting",
          ],

          verification_status:
            "unreliable",

          frame_id:
            "frame-002",

          video_id:
            "video-001",

          timestamp_seconds:
            50,
        },
      ],

      statisticsResults:
        [],

      successfulActionIds: [
        "documents",
      ],
    };


    const synthesis =
      await synthesize({
        mode:
          synthesisInput.mode,

        input:
          synthesisInput,

        context: {
          generateText:
            async () =>
              "The frame contains tennis activity [1].",
        },
      });


    const verification =
      await verifySynthesis({
        synthesisResult:
          synthesis,

        synthesisInput,
      });


    assert.equal(
      verification.verified,
      false,
    );


    assert.equal(
      verification
        .checks
        .document_grounding
        .status,
      "failed",
    );


    const metadata =
      verification
        .checks
        .document_grounding
        .metadata;


    assert.deepEqual(
      metadata
        .ineligibleVisualEvidence,
      [
        "visual-chunk-bad",
      ],
    );


    assert.equal(
      metadata
        .visualEvidenceQuality
        .length,
      1,
    );


    assert.deepEqual(
      metadata
        .visualEvidenceQuality[0],
      {
        chunkId:
          "visual-chunk-bad",

        qualityStatus:
          "bad",

        qualityScore:
          0.18,

        qualityIssues: [
          "severe_noise",
          "poor_lighting",
        ],

        verificationStatus:
          "unreliable",

        evidenceEligible:
          false,
      },
    );
  },
);