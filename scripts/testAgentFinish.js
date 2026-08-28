import {
  bootstrapActions,
} from "../src/modules/actions/index.js";

import {
  decideNextAgentStep,
} from "../src/modules/agent/agentContinuation.service.js";


const question =
  "What is the average player ranking and what does research say about ranking progression?";


const state = {
  question,

  stepCount: 2,
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

    {
      stepNumber: 2,

      decision: {
        type: "actions",
        selectedActions: [
          "documents",
        ],
      },

      observations: [
        {
          actionId:
            "documents",

          status:
            "success",

          data: null,

         evidence: [
            {
                title:
                "Ranking Progression Research",

                text:
                "Research on player development describes ranking progression as a useful longitudinal indicator of competitive development when interpreted alongside training and match performance.",
            },
         ],

          metadata: {
            evidenceCount: 1,
          },

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
  console.error(error);
  process.exitCode = 1;
}