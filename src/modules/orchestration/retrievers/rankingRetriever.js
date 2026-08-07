import {
  createKnowledgeRetriever,
} from "./baseRetriever.js";

export const retrieveRankingKnowledge =
  createKnowledgeRetriever({
    moduleId: "rankings",
  });