import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAgentContinuationPrompt,
} from "../../src/modules/agent/agentObservationPrompt.service.js";


describe("agent continuation prompt", () => {
  it("includes previous observations and available actions", () => {
    const prompt =
      buildAgentContinuationPrompt({
        question:
          "What is the average ranking and what does research say about ranking progression?",

        state: {
          steps: [
            {
              stepNumber: 1,

              decision: {
                selectedActions: [
                  "statistics",
                ],
              },

              observations: [
                {
                  actionId:
                    "statistics",

                  status:
                    "success",

                  data: {
                    averageRanking:
                      94.2,
                  },

                  evidence: [],

                  metadata: {},
                  error: null,
                },
              ],
            },
          ],
        },

        availableActions: [
          {
            id:
              "statistics",

            description:
              "Query structured tennis data.",

            capabilities: [
              "Calculate averages",
            ],
          },

          {
            id:
              "documents",

            description:
              "Search tennis documents.",

            capabilities: [
              "Search research papers",
            ],
          },
        ],
      });


    assert.match(
      prompt,
      /94\.2/
    );

    assert.match(
      prompt,
      /statistics/
    );

    assert.match(
      prompt,
      /documents/
    );

    assert.match(
      prompt,
      /finish/
    );

    assert.match(
      prompt,
      /ORIGINAL COACH QUESTION/
    );
  });


  it("rejects an empty question", () => {
    assert.throws(
      () =>
        buildAgentContinuationPrompt({
          question: "",
          state: {
            steps: [],
          },
          availableActions: [],
        }),
      /non-empty question/
    );
  });


  it("rejects missing agent state", () => {
    assert.throws(
      () =>
        buildAgentContinuationPrompt({
          question:
            "What is the average ranking?",
          state: null,
          availableActions: [],
        }),
      /requires agent state/
    );
  });
});
