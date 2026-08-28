import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendAgentStep,
  canAgentContinue,
  createAgentState,
  getExecutedActionIds,
} from "../../src/modules/agent/agentState.service.js";


describe("agent state", () => {
  it("creates a new agent state", () => {
    const state =
      createAgentState({
        question:
          "What is the average ranking?",
      });

    assert.equal(
      state.question,
      "What is the average ranking?"
    );

    assert.equal(
      state.stepCount,
      0
    );

    assert.equal(
      state.maxSteps,
      5
    );

    assert.deepEqual(
      state.steps,
      []
    );
  });


  it("stores action results as observations", () => {
    const state =
      createAgentState({
        question:
          "What is the average ranking?",
      });


    const nextState =
      appendAgentStep(
        state,
        {
          decision: {
            type: "actions",
            selectedActions: [
              "statistics",
            ],
          },

          execution: {
            results: [
              {
                actionId:
                  "statistics",

                result: {
                  status:
                    "success",

                  data: {
                    average:
                      94.2,
                  },

                  evidence: [],

                  metadata: {},
                  error: null,
                },
              },
            ],
          },
        }
      );


    assert.equal(
      nextState.stepCount,
      1
    );

    assert.equal(
      nextState.steps[0]
        .observations[0]
        .actionId,
      "statistics"
    );

    assert.equal(
      nextState.steps[0]
        .observations[0]
        .status,
      "success"
    );
  });


  it("tracks executed actions without duplicates", () => {
    let state =
      createAgentState({
        question:
          "Compare statistics with research.",
      });


    state =
      appendAgentStep(
        state,
        {
          decision: {
            type: "actions",
            selectedActions: [
              "statistics",
              "documents",
            ],
          },

          execution: {
            results: [
              {
                actionId:
                  "statistics",

                result: {
                  status:
                    "success",
                },
              },

              {
                actionId:
                  "documents",

                result: {
                  status:
                    "success",
                },
              },
            ],
          },
        }
      );


    assert.deepEqual(
      getExecutedActionIds(
        state
      ).sort(),
      [
        "documents",
        "statistics",
      ]
    );

    assert.equal(
      canAgentContinue(
        state
      ),
      true
    );
  });
});