import {
  retrieveRankingKnowledge,
} from "../orchestration/retrievers/rankingRetriever.js";

export const rankingModule =
  Object.freeze({
    moduleId:
      "rankings",

    label:
      "Ranking Data",

    description:
      "Current and historical tennis ranking data.",

    sourceTypes: [
      "ranking_data",
    ],

    keywords: [
        "ranking",
        "rank",
        "points",
        "position",
        "seed",
        "standings",
    ],

    retriever:
      retrieveRankingKnowledge,

    isEnabled:
      true,
  });

export default rankingModule;