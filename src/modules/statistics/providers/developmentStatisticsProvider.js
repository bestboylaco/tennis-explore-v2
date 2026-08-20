import {
  createInMemoryStatisticsProvider,
} from "./inMemoryStatisticsProvider.js";


export const developmentStatisticsProvider =
  createInMemoryStatisticsProvider({
    datasetId:
      "development_player_testing",

    name:
      "Development Player Testing",

    description:
      "Development-only structured player testing dataset containing player names, scores, and ages.",

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