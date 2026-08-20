import {
  bootstrapActions,
  getAvailableActions,
  getActionDescriptions,
} from "../src/modules/actions/index.js";

import {
  clearStatisticsProviderRegistry,
  createInMemoryStatisticsProvider,
  registerStatisticsProvider,
  getAvailableDatasets,
} from "../src/modules/statistics/index.js";


// Start with no statistics datasets.
clearStatisticsProviderRegistry();


// Register Documents + Statistics action definitions.
bootstrapActions();


console.log(
  "\n=== BEFORE REGISTERING DATASET ==="
);

console.log(
  "\nAvailable datasets:"
);

console.dir(
  getAvailableDatasets(),
  {
    depth: null,
  }
);


console.log(
  "\nAvailable actions:"
);

console.dir(
  getAvailableActions().map(
    (action) => ({
      id: action.id,
      enabled: action.isEnabled,
    })
  ),
  {
    depth: null,
  }
);


console.log(
  "\nActions exposed to Ollama:"
);

console.dir(
  getActionDescriptions(),
  {
    depth: null,
  }
);


// ----------------------------------------------------
// Register a generic structured dataset.
// ----------------------------------------------------

const provider =
  createInMemoryStatisticsProvider({
    datasetId:
      "test_player_data",

    name:
      "Test Player Data",

    description:
      "Generic structured player testing data.",

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
    ],
  });


registerStatisticsProvider(
  provider
);


console.log(
  "\n=== AFTER REGISTERING DATASET ==="
);

console.log(
  "\nAvailable datasets:"
);

console.dir(
  getAvailableDatasets(),
  {
    depth: null,
  }
);


console.log(
  "\nAvailable actions:"
);

console.dir(
  getAvailableActions().map(
    (action) => ({
      id: action.id,
      enabled: action.isEnabled,
    })
  ),
  {
    depth: null,
  }
);


console.log(
  "\nActions exposed to Ollama:"
);

console.dir(
  getActionDescriptions(),
  {
    depth: null,
  }
);