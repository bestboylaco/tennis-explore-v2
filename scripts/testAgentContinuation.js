import {
  decideNextAgentStep,
} from "../src/modules/agent/agentContinuation.service.js";

import {
  bootstrapActions,
} from "../src/modules/actions/index.js";


const question =
  "What is the average player ranking and what does research say about ranking progression?";


const state = {
  question,

  stepCount: 1,
  maxSteps: 5,

  steps: [
    {
      stepNumber: 1,

      decision: {
        type: "actions",
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
};

await bootstrapActions();
try {
  const result =
    await decideNextAgentStep({
      question,
      state,
    });


  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
} catch (error) {
  console.error(
    error
  );

  process.exitCode = 1;
}