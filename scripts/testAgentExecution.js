import {
  bootstrapActions,
  getActionDescriptions,
  executeSelectedActions,
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
// 1. Register a generic structured dataset
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
  "\n=== AVAILABLE ACTIONS ==="
);

console.dir(
  getActionDescriptions(),
  {
    depth: null,
  }
);


// --------------------------------------------------
// 3. Coach question
// --------------------------------------------------

const question =
  "What does research say about training load?";


console.log(
  "\n=== QUESTION ==="
);

console.log(
  question
);


// --------------------------------------------------
// 4. Ollama chooses the action
// --------------------------------------------------

try {
  const routingResult =
    await routeQuestion({
      question,
    });


  console.log(
    "\n=== ROUTING DECISION ==="
  );

  console.dir(
    routingResult,
    {
      depth: null,
    }
  );


  const selectedActions =
    routingResult
      .decision
      .selectedActions;


  // ------------------------------------------------
  // 5. Generic executor runs selected actions
  // ------------------------------------------------

  const executionResult =
    await executeSelectedActions({
      question,
      actionIds:
        selectedActions,
    });


  console.log(
    "\n=== ACTION EXECUTION ==="
  );

  console.dir(
    executionResult,
    {
      depth: null,
    }
  );


  console.log(
    "\nAgent execution test complete."
  );
} catch (error) {
  console.error(
    "\n=== AGENT EXECUTION ERROR ==="
  );

  console.error(
    error
  );
}