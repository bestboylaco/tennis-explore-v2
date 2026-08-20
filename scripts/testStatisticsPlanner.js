import {
  createInMemoryStatisticsProvider,
  registerStatisticsProvider,
  getAvailableDatasets,
  planStatisticsQuery,
  executeStatisticsQuery,
} from "../src/modules/statistics/index.js";


const testRecords = [
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
];


const provider =
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

    records:
      testRecords,
  });


registerStatisticsProvider(
  provider
);


console.log(
  "\n=== AVAILABLE DATASETS ==="
);

console.dir(
  getAvailableDatasets(),
  {
    depth: null,
  }
);


const question =
  "Who has the highest score?";


console.log(
  "\n=== QUESTION ==="
);

console.log(
  question
);


try {
  const plan =
    await planStatisticsQuery({
      question,
    });


  console.log(
    "\n=== OLLAMA STATISTICS PLAN ==="
  );

  console.dir(
    plan,
    {
      depth: null,
    }
  );


  const result =
    await executeStatisticsQuery(
      plan.query
    );


  console.log(
    "\n=== STATISTICS RESULT ==="
  );

  console.dir(
    result,
    {
      depth: null,
    }
  );


  console.log(
    "\nStatistics planner test complete."
  );
} catch (error) {
  console.error(
    "\n=== STATISTICS PLANNER ERROR ==="
  );

  console.error(
    error
  );
}