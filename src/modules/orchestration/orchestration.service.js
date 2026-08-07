import {
  selectKnowledgeModules,
} from "./moduleSelector.service.js";

import {
  buildRetrievalPlan,
} from "./retrievalPlanBuilder.service.js";

import {
  executeRetrievalPlan,
} from "./retrievalExecutor.service.js";

import {
  mergeRetrievedEvidence,
} from "./evidenceMerger.service.js";

import {
  buildOrchestrationContext,
} from "./contextBuilder.service.js";

import {
  DEFAULT_ORCHESTRATION_OPTIONS,
} from "./orchestration.types.js";

/**
 * Orchestrate metadata-aware knowledge retrieval.
 *
 * @param {Object} options
 * @param {string} options.question
 * @param {number} [options.maximumModules]
 * @param {number} [options.candidateLimitPerModule]
 * @param {number} [options.finalLimit]
 * @param {number} [options.minimumScore]
 * @param {number} [options.maxPerSource]
 *
 * @returns {Promise<{
 *   question: string,
 *   selection: Object,
 *   plan: Object,
 *   execution: Object,
 *   mergedEvidence: Object,
 *   context: Object
 * }>}
 */
export async function orchestrateKnowledgeRetrieval({
  question,
  maximumModules =
    DEFAULT_ORCHESTRATION_OPTIONS.maximumModules,
  candidateLimitPerModule =
    DEFAULT_ORCHESTRATION_OPTIONS.candidateLimitPerModule,
  finalLimit =
    DEFAULT_ORCHESTRATION_OPTIONS.finalLimit,
  minimumScore =
    DEFAULT_ORCHESTRATION_OPTIONS.minimumScore,
  maxPerSource =
    DEFAULT_ORCHESTRATION_OPTIONS.maxPerSource,
} = {}) {
  const selectedModules =
    selectKnowledgeModules({
      question,
      maximumModules,
    });

  const plan =
    buildRetrievalPlan({
      question,
      selectedModules,
      candidateLimitPerModule,
    });

  const execution =
    await executeRetrievalPlan({
      plan,
    });

  const mergedEvidence =
    mergeRetrievedEvidence({
      executions:
        execution.executions,
      finalLimit,
      minimumScore,
      maxPerSource,
    });

  const context =
    buildOrchestrationContext({
      evidence:
        mergedEvidence.evidence,
    });

  return {
    question:
      question.trim(),

    selection: {
      totalSelected:
        selectedModules.length,
      modules:
        selectedModules,
    },

    plan,

    execution,

    mergedEvidence,

    context,
  };
}