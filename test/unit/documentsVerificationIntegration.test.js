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