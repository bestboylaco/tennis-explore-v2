import {
  bootstrapActions,
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


const benchmarkStatisticsProvider =
  createInMemoryStatisticsProvider({
    datasetId:
      "benchmark_player_testing",

    name:
      "Benchmark Player Testing",

    description:
      "Structured tennis player testing data containing player names, scores, and ages.",

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
  benchmarkStatisticsProvider
);


// --------------------------------------------------
// 2. Register actions
// --------------------------------------------------

bootstrapActions();


// --------------------------------------------------
// 3. Routing benchmark
// --------------------------------------------------

const benchmarkCases = [
  {
    id: 1,

    question:
      "What does research say about managing training load in tennis?",

    expectedType:
      "actions",

    expectedActions: [
      "documents",
    ],
  },

  {
    id: 2,

    question:
      "According to coaching literature, how should players prepare mentally for pressure?",

    expectedType:
      "actions",

    expectedActions: [
      "documents",
    ],
  },

  {
    id: 3,

    question:
      "Who has the highest score?",

    expectedType:
      "actions",

    expectedActions: [
      "statistics",
    ],
  },

  {
    id: 4,

    question:
      "What is the average player score?",

    expectedType:
      "actions",

    expectedActions: [
      "statistics",
    ],
  },

  {
    id: 5,

    question:
      "Show me players older than 18.",

    expectedType:
      "actions",

    expectedActions: [
      "statistics",
    ],
  },

  {
    id: 6,

    question:
      "What did the research paper conclude about serve loading?",

    expectedType:
      "actions",

    expectedActions: [
      "documents",
    ],
  },

  {
    id: 7,

    question:
      "How many players are in the player testing dataset?",

    expectedType:
      "actions",

    expectedActions: [
      "statistics",
    ],
  },

  {
    id: 8,

    question:
      "What recommendations are given in tennis coaching manuals for return of serve?",

    expectedType:
      "actions",

    expectedActions: [
      "documents",
    ],
  },

  {
    id: 9,

    question:
      "Tell me about this player's performance.",

    expectedType:
      "clarification",

    expectedActions: [],
  },

  {
    id: 10,

    question:
      "What information do we have about the player?",

    expectedType:
      "clarification",

    expectedActions: [],
  },
];


// --------------------------------------------------
// 4. Evaluate one routing result
// --------------------------------------------------

function evaluateRouting({
  result,
  testCase,
}) {
  const decision =
    result?.decision;


  if (!decision) {
    return false;
  }


  if (
    decision.type !==
    testCase.expectedType
  ) {
    return false;
  }


  if (
    testCase.expectedType ===
    "clarification"
  ) {
    return true;
  }


  const selectedActions =
    Array.isArray(
      decision.selectedActions
    )
      ? decision.selectedActions
      : [];


  return (
    testCase.expectedActions.length ===
      selectedActions.length &&
    testCase.expectedActions.every(
      (actionId) =>
        selectedActions.includes(
          actionId
        )
    )
  );
}


// --------------------------------------------------
// 5. Run benchmark
// --------------------------------------------------

let passedTests = 0;

const results = [];


console.log(
  "\n========================================"
);

console.log(
  "TENNISEXPLORE ROUTING BENCHMARK"
);

console.log(
  "========================================\n"
);


for (const testCase of benchmarkCases) {
  console.log(
    `Question ${testCase.id}:`
  );

  console.log(
    testCase.question
  );


  try {
    const result =
      await routeQuestion({
        question:
          testCase.question,
      });


    const passed =
      evaluateRouting({
        result,
        testCase,
      });


    if (passed) {
      passedTests += 1;
    }


    const selectedActions =
      result.decision
        ?.selectedActions ??
      [];


    results.push({
      id:
        testCase.id,

      question:
        testCase.question,

      expectedType:
        testCase.expectedType,

      expectedActions:
        testCase.expectedActions,

      actualType:
        result.decision?.type,

      actualActions:
        selectedActions,

      confidence:
        result.decision?.confidence,

      rationale:
        result.decision?.rationale,

      passed,
    });


    console.log(
      "Expected:",
      testCase.expectedType,
      testCase.expectedActions
    );

    console.log(
      "Actual:",
      result.decision?.type,
      selectedActions
    );

    console.log(
      "Confidence:",
      result.decision?.confidence
    );

    console.log(
      passed
        ? "PASS ✅"
        : "FAIL ❌"
    );

    console.log(
      "----------------------------------------"
    );
  } catch (error) {
    results.push({
      id:
        testCase.id,

      question:
        testCase.question,

      expectedType:
        testCase.expectedType,

      expectedActions:
        testCase.expectedActions,

      actualType:
        "error",

      actualActions: [],

      confidence:
        null,

      rationale:
        error instanceof Error
          ? error.message
          : "Unknown error",

      passed:
        false,
    });


    console.error(
      "ERROR ❌",
      error
    );

    console.log(
      "----------------------------------------"
    );
  }
}


// --------------------------------------------------
// 6. Summary
// --------------------------------------------------

const totalTests =
  benchmarkCases.length;


const accuracy =
  (
    passedTests /
    totalTests
  ) * 100;


console.log(
  "\n========================================"
);

console.log(
  "BENCHMARK SUMMARY"
);

console.log(
  "========================================"
);

console.log(
  `Correct: ${passedTests} / ${totalTests}`
);

console.log(
  `Accuracy: ${accuracy.toFixed(1)}%`
);

console.log(
  "Required: 80%"
);

console.log(
  accuracy >= 80
    ? "RESULT: PASS ✅"
    : "RESULT: FAIL ❌"
);


console.log(
  "\n=== DETAILED RESULTS ==="
);

console.table(
  results.map(
    (result) => ({
      id:
        result.id,

      expected:
        result.expectedType ===
        "actions"
          ? result.expectedActions.join(
              ", "
            )
          : result.expectedType,

      actual:
        result.actualType ===
        "actions"
          ? result.actualActions.join(
              ", "
            )
          : result.actualType,

      confidence:
        result.confidence,

      passed:
        result.passed,
    })
  )
);