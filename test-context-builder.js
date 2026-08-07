import {
  selectKnowledgeModules,
} from "./src/modules/orchestration/moduleSelector.service.js";

import {
  buildRetrievalPlan,
} from "./src/modules/orchestration/retrievalPlanBuilder.service.js";

import {
  executeRetrievalPlan,
} from "./src/modules/orchestration/retrievalExecutor.service.js";

import {
  mergeRetrievedEvidence,
} from "./src/modules/orchestration/evidenceMerger.service.js";

import {
  buildOrchestrationContext,
} from "./src/modules/orchestration/contextBuilder.service.js";

const question =
  "What does research say about tennis training load?";

const selectedModules =
  selectKnowledgeModules({
    question,
  });

const plan =
  buildRetrievalPlan({
    question,
    selectedModules,
    candidateLimitPerModule: 5,
  });

const execution =
  await executeRetrievalPlan({
    plan,
  });

const mergedEvidence =
  mergeRetrievedEvidence({
    executions:
      execution.executions,
  });

const contextResult =
  buildOrchestrationContext({
    evidence:
      mergedEvidence.evidence,
  });

console.log(
  JSON.stringify(
    contextResult,
    null,
    2
  )
);