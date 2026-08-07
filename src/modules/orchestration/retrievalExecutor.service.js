import {
  getRetrieverByModuleId,
} from "./retrievers/retrieverRegistry.js";

/**
 * Execute every task in a retrieval plan.
 *
 * @param {Object} options
 * @param {Object} options.plan
 *
 * @returns {Promise<{
 *   question: string,
 *   totalTasks: number,
 *   totalCompleted: number,
 *   totalFailed: number,
 *   executions: Object[],
 *   failures: Object[]
 * }>}
 */
export async function executeRetrievalPlan({
  plan,
} = {}) {
  if (
    !plan ||
    typeof plan !== "object"
  ) {
    throw new TypeError(
      "A valid retrieval plan is required."
    );
  }

  if (
    typeof plan.question !== "string" ||
    plan.question.trim().length === 0
  ) {
    throw new TypeError(
      "Retrieval plan question must be a non-empty string."
    );
  }

  if (!Array.isArray(plan.tasks)) {
    throw new TypeError(
      "Retrieval plan tasks must be an array."
    );
  }

  const executions = [];
  const failures = [];

  for (const task of plan.tasks) {
    const retriever =
      getRetrieverByModuleId(
        task.moduleId
      );

    if (!retriever) {
      failures.push({
        moduleId:
          task.moduleId || null,

        reason:
          "No retriever is registered for this module.",
      });

      continue;
    }

    try {
      const result =
        await retriever({
          question:
            plan.question,

          sourceTypes:
            task.sourceTypes,

          candidateLimit:
            task.candidateLimit,
        });

      executions.push({
        moduleId:
          task.moduleId,

        label:
          task.label,

        selectorScore:
          task.selectorScore,

        result,
      });
    } catch (error) {
      failures.push({
        moduleId:
          task.moduleId || null,

        reason:
          error instanceof Error
            ? error.message
            : "Unknown retriever error.",
      });
    }
  }

  return {
    question:
      plan.question.trim(),

    totalTasks:
      plan.tasks.length,

    totalCompleted:
      executions.length,

    totalFailed:
      failures.length,

    executions,

    failures,
  };
}