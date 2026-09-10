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
  hasSynthesisStrategy,
} from "../../src/modules/synthesis/synthesis.registry.js";

import {
  synthesize,
} from "../../src/modules/synthesis/synthesis.service.js";


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

        authors: [
          "Example Author",
        ],

        source_uri:
          "/documents/return-positioning.pdf",
      },

      {
        chunk_id:
          "chunk-2",

        doc_id:
          "doc-2",

        title:
          "Serve Return Coaching Guide",

        file_name:
          "serve-return-guide.pdf",

        text:
          "Return position should be adjusted according to serve speed, court position, and the player's tactical intention.",

        source_type:
          "coach_material",

        page:
          7,

        authors: [],

        source_uri:
          "/documents/serve-return-guide.pdf",
      },
    ],

    statisticsResults: [],

    successfulActionIds: [
      "documents",
    ],
  };
}


test(
  "bootstraps the documents synthesis strategy",
  () => {
    clearSynthesisStrategies();

    bootstrapSynthesis();

    assert.equal(
      hasSynthesisStrategy(
        AGENT_SYNTHESIS_MODES.DOCUMENTS
      ),
      true
    );
  }
);


test(
  "documents synthesis prepares evidence and generates an answer",
  async () => {
    clearSynthesisStrategies();

    bootstrapSynthesis();


    const input =
      createDocumentsInput();


    let evidenceSeenByGenerator =
      null;


    const result =
      await synthesize({
        mode:
          AGENT_SYNTHESIS_MODES.DOCUMENTS,

        input,

        context: {
          generateText:
            async ({
              question,
              evidence,
            }) => {
              assert.equal(
                question,
                input.question
              );


              evidenceSeenByGenerator =
                evidence;


              return (
                "Research suggests that a deeper return position " +
                "can provide more reaction time against faster serves [1]."
              );
            },
        },
      });


    assert.equal(
      result.answered,
      true
    );


    assert.equal(
      result.mode,
      AGENT_SYNTHESIS_MODES.DOCUMENTS
    );


    assert.equal(
      result.answer,
      "Research suggests that a deeper return position can provide more reaction time against faster serves [1]."
    );


    /*
     * Citation binding happens later in the
     * Verification layer.
     */
    assert.deepEqual(
      result.citations,
      []
    );


    /*
     * The generator must receive prepared evidence.
     */
    assert.ok(
      Array.isArray(
        evidenceSeenByGenerator
      )
    );


    assert.equal(
      evidenceSeenByGenerator.length,
      2
    );


    /*
     * prepareEvidence() assigns citation numbers.
     */
    assert.equal(
      evidenceSeenByGenerator[0]
        .citationNumber,
      1
    );


    assert.equal(
      evidenceSeenByGenerator[1]
        .citationNumber,
      2
    );


    /*
     * The exact prepared evidence sent to the model
     * must also be retained in SynthesisResult so the
     * Verification layer can inspect the same data.
     */
    assert.equal(
      result.data
        .documents
        .evidence
        .length,
      2
    );


    assert.equal(
      result.data
        .documents
        .evidence[0]
        .citationNumber,
      1
    );


    assert.equal(
      result.metadata
        .sourceAction,
      "documents"
    );
  }
);


test(
  "documents synthesis preserves generation metadata",
  async () => {
    clearSynthesisStrategies();

    bootstrapSynthesis();


    const input =
      createDocumentsInput();


    const result =
      await synthesize({
        mode:
          AGENT_SYNTHESIS_MODES.DOCUMENTS,

        input,

        context: {
          generateText:
            async () => ({
              answer:
                "Return positioning can influence the reaction time available to the receiver [1].",

              model:
                "test-model",

              promptVersion:
                "test-v3",

              tokensIn:
                100,

              tokensOut:
                20,

              durationMs:
                50,
            }),
        },
      });


    const generation =
      result.data
        .documents
        .generation;


    assert.equal(
      generation.model,
      "test-model"
    );


    assert.equal(
      generation.promptVersion,
      "test-v3"
    );


    assert.equal(
      generation.tokensIn,
      100
    );


    assert.equal(
      generation.tokensOut,
      20
    );


    assert.equal(
      generation.durationMs,
      50
    );
  }
);


test(
  "documents synthesis rejects missing document evidence",
  async () => {
    clearSynthesisStrategies();

    bootstrapSynthesis();


    await assert.rejects(
      () =>
        synthesize({
          mode:
            AGENT_SYNTHESIS_MODES.DOCUMENTS,

          input: {
            question:
              "What does the research say?",

            mode:
              AGENT_SYNTHESIS_MODES.DOCUMENTS,

            documentEvidence: [],

            statisticsResults: [],

            successfulActionIds: [
              "documents",
            ],
          },

          context: {
            generateText:
              async () =>
                "Should never run.",
          },
        }),

      /requires existing document evidence/
    );
  }
);


test(
  "documents synthesis rejects an empty generated answer",
  async () => {
    clearSynthesisStrategies();

    bootstrapSynthesis();


    const input =
      createDocumentsInput();


    await assert.rejects(
      () =>
        synthesize({
          mode:
            AGENT_SYNTHESIS_MODES.DOCUMENTS,

          input,

          context: {
            generateText:
              async () =>
                "   ",
          },
        }),

      /returned an empty answer/
    );
  }
);