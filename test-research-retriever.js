import {
  retrieveResearchKnowledge,
} from "./src/modules/orchestration/retrievers/researchRetriever.js";

const result =
  await retrieveResearchKnowledge({
    question:
      "What does research say about tennis training load?",

    sourceTypes: [
      "research_paper",
    ],

    candidateLimit: 5,
  });

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);