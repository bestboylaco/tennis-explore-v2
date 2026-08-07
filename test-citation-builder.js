import {
  orchestrateKnowledgeRetrieval,
} from "./src/modules/orchestration/index.js";

import {
  buildCitations,
} from "./src/modules/ai/services/citationBuilder.service.js";

const question =
  "What does research say about tennis training load?";

const orchestration =
  await orchestrateKnowledgeRetrieval({
    question,
  });

const citationResult =
  buildCitations({
    evidence:
      orchestration
        .mergedEvidence
        .evidence,
  });

console.log(
  JSON.stringify(
    citationResult,
    null,
    2
  )
);