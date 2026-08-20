import {
  STATISTICS_OPERATION,
  FILTER_OPERATOR,
  SORT_DIRECTION,
  createInMemoryStatisticsProvider,
  registerStatisticsProvider,
  executeStatisticsQuery,
  getAvailableDatasets,
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
    datasetId: "test_player_data",

    name: "Test Player Data",

    description:
      "Generic test dataset used to verify the statistics engine.",

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


// ------------------------------------------------
// TEST 1 — MAX
// ------------------------------------------------

const maxResult =
  await executeStatisticsQuery({
    dataset:
      "test_player_data",

    operation:
      STATISTICS_OPERATION.MAX,

    metric:
      "score",

    filters: [],

    fields: [
      "player",
      "score",
    ],
  });


console.log(
  "\n=== MAX SCORE ==="
);

console.dir(
  maxResult,
  {
    depth: null,
  }
);


// ------------------------------------------------
// TEST 2 — AVERAGE
// ------------------------------------------------

const averageResult =
  await executeStatisticsQuery({
    dataset:
      "test_player_data",

    operation:
      STATISTICS_OPERATION.AVERAGE,

    metric:
      "score",

    filters: [],

    fields: [],
  });


console.log(
  "\n=== AVERAGE SCORE ==="
);

console.dir(
  averageResult,
  {
    depth: null,
  }
);


// ------------------------------------------------
// TEST 3 — FILTER + SORT
// ------------------------------------------------

const filterResult =
  await executeStatisticsQuery({
    dataset:
      "test_player_data",

    operation:
      STATISTICS_OPERATION.FILTER,

    metric: null,

    filters: [
      {
        field: "score",

        operator:
          FILTER_OPERATOR.GT,

        value: 14,
      },
    ],

    sortBy: "score",

    sortDirection:
      SORT_DIRECTION.DESC,

    fields: [
      "player",
      "score",
    ],
  });


console.log(
  "\n=== SCORE > 14 ==="
);

console.dir(
  filterResult,
  {
    depth: null,
  }
);


console.log(
  "\nStatistics engine test complete."
);