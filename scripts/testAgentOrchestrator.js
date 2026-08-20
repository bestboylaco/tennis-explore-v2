import {
  bootstrapActions,
} from "../src/modules/actions/index.js";

import {
  clearStatisticsProviderRegistry,
  createInMemoryStatisticsProvider,
  registerStatisticsProvider,
} from "../src/modules/statistics/index.js";

import {
  runAgent,
} from "../src/modules/agent/index.js";


// --------------------------------------------------
// 1. Prepare generic structured test data
// --------------------------------------------------

clearStatisticsProviderRegistry();


const statisticsProvider =
  createInMemoryStatisticsProvider({
    datasetId:
      "test_player_data",

    name:
      "Test Player Data",

    description:
      "Structured player testing data containing player names, scores, and ages.",

    fields: [
      "player",
      "score",
      "age",
    ],

    records: [
      {
        player: "Player A",
        score: 13.8,
        age: 18,
      },

      {
        player: "Player B",
        score: 15.2,
        age: 19,
      },

      {
        player: "Player C",
        score: 14.7,
        age: 18,
      },

      {
        player: "Player D",
        score: 12.9,
        age: 20,
      },
    ],
  });


registerStatisticsProvider(
  statisticsProvider
);


// --------------------------------------------------
// 2. Register available actions
// --------------------------------------------------

bootstrapActions();


// --------------------------------------------------
// 3. Test questions
// --------------------------------------------------

const questions = [
  "Who has the highest score?",

  "What does research say about training load?",
];


// --------------------------------------------------
// 4. Run through the complete agent
// --------------------------------------------------

for (const question of questions) {
  console.log(
    "\n========================================"
  );

  console.log(
    "QUESTION:"
  );

  console.log(
    question
  );


  try {
    const result =
      await runAgent({
        question,
      });


    console.log(
      "\n=== AGENT RESULT ==="
    );

    console.dir(
      result,
      {
        depth: null,
      }
    );
  } catch (error) {
    console.error(
      "\n=== AGENT ERROR ==="
    );

    console.error(
      error
    );
  }
}