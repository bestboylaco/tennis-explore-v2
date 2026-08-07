import {
  createKnowledgeRetriever,
} from "./baseRetriever.js";

export const retrieveConferenceKnowledge =
  createKnowledgeRetriever({
    moduleId: "conference",
  });