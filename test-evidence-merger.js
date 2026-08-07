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

console.log(
  JSON.stringify(
    {
      selectedModules,
      plan,
      executionSummary: {
        totalTasks:
          execution.totalTasks,

        totalCompleted:
          execution.totalCompleted,

        totalFailed:
          execution.totalFailed,

        failures:
          execution.failures,
      },

      mergedEvidence,
    },
    null,
    2
  )
);