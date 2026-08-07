import {
  createKnowledgeRetriever,
} from "./baseRetriever.js";

export const retrieveMatchKnowledge =
  createKnowledgeRetriever({
    moduleId: "matches",
  });