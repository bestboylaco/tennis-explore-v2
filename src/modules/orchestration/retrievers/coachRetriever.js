import {
  createKnowledgeRetriever,
} from "./baseRetriever.js";

export const retrieveCoachKnowledge =
  createKnowledgeRetriever({
    moduleId: "coaching",
  });