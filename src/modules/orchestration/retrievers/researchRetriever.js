import {
  createKnowledgeRetriever,
} from "./baseRetriever.js";

export const retrieveResearchKnowledge =
  createKnowledgeRetriever({
    moduleId: "research",
  });