import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_RESULT_STATUS,
} from "../../src/modules/actions/index.js";

import {
  AGENT_SYNTHESIS_MODES,
  createAgentSynthesisInput,
  synthesizeStatisticsAnswer,
} from "../../src/modules/agent/agentSynthesis.service.js";


function createStateWithObservations(
  observations
) {
  return {
    question:
      "Test question",

    stepCount:
      1,

    maxSteps:
      5,

    steps: [
      {
        stepNumber:
          1,

        decision: {
          type:
            "actions",
        },

        observations,
      },
    ],
  };
}


test(
  "creates statistics synthesis input",
  () => {
    const state =
      createStateWithObservations([
        {
          actionId:
            "statistics",

          status:
            ACTION_RESULT_STATUS.SUCCESS,

          data: {
            columns: [
              "average_ranking",
            ],

            rows: [
              {
                average_ranking:
                  94.2,
              },
            ],

            table:
              "rankings",

            tableTitle:
              "Player Rankings",

            rowsScanned:
              10,

            rowsMatched:
              10,

            rowsReturned:
              1,
          },

          evidence: [],

          metadata: {},

          error:
            null,
        },
      ]);


    const result =
      createAgentSynthesisInput({
        question:
          "What is the average singles ranking?",

        state,
      });


    assert.equal(
      result.mode,
      AGENT_SYNTHESIS_MODES.STATISTICS
    );

    assert.equal(
      result.statisticsResults.length,
      1
    );

    assert.equal(
      result.documentEvidence.length,
      0
    );

    assert.deepEqual(
      result.successfulActionIds,
      [
        "statistics",
      ]
    );
  }
);


test(
  "creates documents synthesis input",
  () => {
    const state =
      createStateWithObservations([
        {
          actionId:
            "documents",

          status:
            ACTION_RESULT_STATUS.SUCCESS,

          data:
            null,

          evidence: [
            {
              chunk_id:
                "chunk-1",

              doc_id:
                "doc-1",

              title:
                "Training Load Research",

              text:
                "Example evidence.",
            },
          ],

          metadata: {},

          error:
            null,
        },
      ]);


    const result =
      createAgentSynthesisInput({
        question:
          "What does research say about training load?",

        state,
      });


    assert.equal(
      result.mode,
      AGENT_SYNTHESIS_MODES.DOCUMENTS
    );

    assert.equal(
      result.documentEvidence.length,
      1
    );

    assert.equal(
      result.statisticsResults.length,
      0
    );

    assert.deepEqual(
      result.successfulActionIds,
      [
        "documents",
      ]
    );
  }
);


test(
  "creates hybrid synthesis input",
  () => {
    const state =
      createStateWithObservations([
        {
          actionId:
            "statistics",

          status:
            ACTION_RESULT_STATUS.SUCCESS,

          data: {
            columns: [
              "average_ranking",
            ],

            rows: [
              {
                average_ranking:
                  94.2,
              },
            ],

            table:
              "rankings",

            tableTitle:
              "Player Rankings",

            rowsScanned:
              10,

            rowsMatched:
              10,

            rowsReturned:
              1,
          },

          evidence: [],

          metadata: {},

          error:
            null,
        },

        {
          actionId:
            "documents",

          status:
            ACTION_RESULT_STATUS.SUCCESS,

          data:
            null,

          evidence: [
            {
              chunk_id:
                "chunk-1",

              doc_id:
                "doc-1",

              title:
                "Ranking Progression Research",

              text:
                "Example research evidence.",
            },
          ],

          metadata: {},

          error:
            null,
        },
      ]);


    const result =
      createAgentSynthesisInput({
        question:
          "What is the average ranking and what does research say about ranking progression?",

        state,
      });


    assert.equal(
      result.mode,
      AGENT_SYNTHESIS_MODES.HYBRID
    );

    assert.equal(
      result.statisticsResults.length,
      1
    );

    assert.equal(
      result.documentEvidence.length,
      1
    );

    assert.deepEqual(
      result.successfulActionIds,
      [
        "statistics",
        "documents",
      ]
    );
  }
);


test(
  "creates none synthesis mode when no actions succeeded",
  () => {
    const state =
      createStateWithObservations([
        {
          actionId:
            "statistics",

          status:
            ACTION_RESULT_STATUS.NO_RESULT,

          data:
            null,

          evidence: [],

          metadata: {
            cause:
              "not_found",
          },

          error:
            null,
        },

        {
          actionId:
            "documents",

          status:
            ACTION_RESULT_STATUS.FAILED,

          data:
            null,

          evidence: [],

          metadata: {},

          error:
            "Example failure.",
        },
      ]);


    const result =
      createAgentSynthesisInput({
        question:
          "Test question",

        state,
      });


    assert.equal(
      result.mode,
      AGENT_SYNTHESIS_MODES.NONE
    );

    assert.equal(
      result.statisticsResults.length,
      0
    );

    assert.equal(
      result.documentEvidence.length,
      0
    );

    assert.deepEqual(
      result.successfulActionIds,
      []
    );
  }
);


test(
  "rejects an empty question",
  () => {
    const state =
      createStateWithObservations([]);


    assert.throws(
      () =>
        createAgentSynthesisInput({
          question:
            "   ",

          state,
        }),

      TypeError
    );
  }
);


test(
  "rejects missing AgentState",
  () => {
    assert.throws(
      () =>
        createAgentSynthesisInput({
          question:
            "Test question",

          state:
            null,
        }),

      TypeError
    );
  }
);


test(
  "synthesizes an existing statistics result",
  async () => {
    const state =
      createStateWithObservations([
        {
          actionId:
            "statistics",

          status:
            ACTION_RESULT_STATUS.SUCCESS,

          data: {
            columns: [
              "average_ranking",
            ],

            rows: [
              {
                average_ranking:
                  94.2,
              },
            ],

            sql:
              "SELECT AVG(ranking) AS average_ranking FROM rankings",

            table:
              "rankings",

            tableTitle:
              "Player Rankings",

            sourceUri:
              null,

            rowsScanned:
              10,

            rowsMatched:
              10,

            rowsReturned:
              1,
          },

          evidence: [],
          metadata: {},
          error:
            null,
        },
      ]);


    const synthesisInput =
      createAgentSynthesisInput({
        question:
          "What is the average singles ranking?",

        state,
      });


    const result =
      await synthesizeStatisticsAnswer({
        synthesisInput,

        generateText:
          async () =>
            "The average singles ranking is 94.2.",
      });


    assert.equal(
      result.answered,
      true
    );



    assert.equal(
      result.citations.length,
      1
    );

    assert.equal(
      result.statistics.data.rows[0]
        .average_ranking,
      94.2
    );
  }
);


test(
  "rejects documents mode in statistics synthesis",
  async () => {
    await assert.rejects(
      () =>
        synthesizeStatisticsAnswer({
          synthesisInput: {
            question:
              "Test question",

            mode:
              AGENT_SYNTHESIS_MODES.DOCUMENTS,

            documentEvidence: [],
            statisticsResults: [],
            successfulActionIds: [
              "documents",
            ],
          },

          generateText:
            async () =>
              "Should never run.",
        })
    );
  }
);