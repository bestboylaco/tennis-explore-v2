import {
  bootstrapActions,
  getActionDescriptions,
} from "../src/modules/actions/index.js";

import {
  clearStatisticsProviderRegistry,
  createInMemoryStatisticsProvider,
  registerStatisticsProvider,
} from "../src/modules/statistics/index.js";

import {
  routeQuestion,
} from "../src/modules/routing/index.js";


// --------------------------------------------------
// 1. Prepare a structured statistics dataset
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
// 2. Register actions
// --------------------------------------------------

bootstrapActions();


console.log(
  "\n=== ACTIONS AVAILABLE TO OLLAMA ==="
);

console.dir(
  getActionDescriptions(),
  {
    depth: null,
  }
);


// --------------------------------------------------
// 3. Questions
// --------------------------------------------------

const questions = [
  {
    label:
      "DOCUMENT QUESTION",

    question:
      "What does research say about training load?",

    expectedAction:
      "documents",
  },

  {
    label:
      "STATISTICS QUESTION",

    question:
      "Who has the highest score?",

    expectedAction:
      "statistics",
  },
];


// --------------------------------------------------
// 4. Ask Ollama to route each question
// --------------------------------------------------

for (const testCase of questions) {
  console.log(
    `\n=== ${testCase.label} ===`
  );

  console.log(
    "Question:",
    testCase.question
  );

  console.log(
    "Expected:",
    testCase.expectedAction
  );


  try {
    const result =
      await routeQuestion({
        question:
          testCase.question,
      });


    console.log(
      "\nRouting result:"
    );

    console.dir(
      result,
      {
        depth: null,
      }
    );


    const selectedActions =
      result.decision
        ?.selectedActions ??
      [];


    const passed =
      selectedActions.includes(
        testCase.expectedAction
      );


    console.log(
      "\nTEST:",
      passed
        ? "PASS ✅"
        : "FAIL ❌"
    );
  } catch (error) {
    console.error(
      "\nROUTING ERROR:"
    );

    console.error(
      error
    );
  }
}