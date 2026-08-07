import {
  retrieveMatchKnowledge,
} from "../orchestration/retrievers/matchRetriever.js";

export const matchModule =
  Object.freeze({
    moduleId:
      "matches",

    label:
      "Match Reports",

    description:
      "Match reports, match analysis, and match-specific evidence.",

    sourceTypes: [
      "match_report",
    ],

    sourceTypes: [
        "match_report",
        "player_report",
    ],

    keywords: [
        "match",
        "score",
        "opponent",
        "performance",
        "serve percentage",
        "break point",
        "winner",
        "unforced error",
    ],

    retriever:
      retrieveMatchKnowledge,

    isEnabled:
      true,
  });

export default matchModule;