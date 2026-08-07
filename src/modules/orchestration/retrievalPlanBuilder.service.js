import {
  DEFAULT_ORCHESTRATION_OPTIONS,
} from "./orchestration.types.js";

/**
 * Build an executable retrieval plan from selected modules.
 *
 * @param {Object} options
 * @param {string} options.question
 * @param {Object[]} options.selectedModules
 * @param {number} [options.candidateLimitPerModule]
 *
 * @returns {{
 *   question: string,
 *   totalModules: number,
 *   tasks: Object[]
 * }}
 */
export function buildRetrievalPlan({
  question,
  selectedModules = [],
  candidateLimitPerModule =
    DEFAULT_ORCHESTRATION_OPTIONS
      .candidateLimitPerModule,
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Question must be a non-empty string."
    );
  }

  if (!Array.isArray(selectedModules)) {
    throw new TypeError(
      "Selected modules must be an array."
    );
  }

  if (
    !Number.isInteger(
      candidateLimitPerModule
    ) ||
    candidateLimitPerModule <= 0
  ) {
    throw new TypeError(
      "Candidate limit per module must be a positive integer."
    );
  }

  const tasks =
    selectedModules.map(
      (selectedModule) => ({
        moduleId:
          selectedModule.moduleId,

        label:
          selectedModule.label,

        sourceTypes:
          selectedModule.sourceTypes,

        selectorScore:
          selectedModule.score,

        candidateLimit:
          candidateLimitPerModule,
      })
    );

  return {
    question:
      question.trim(),

    totalModules:
      tasks.length,

    tasks,
  };
}