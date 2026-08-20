import {
  createActionDefinition,
  createActionResult,
  ACTION_RESULT_STATUS,
} from "../action.types.js";

import {
  planStatisticsQuery,
  executeStatisticsQuery,
  getAvailableDatasets,
} from "../../statistics/index.js";


async function executeStatisticsAction({
  question,
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Statistics action requires a non-empty question."
    );
  }

  try {
    const plan =
      await planStatisticsQuery({
        question:
          question.trim(),
      });


    const result =
      await executeStatisticsQuery(
        plan.query
      );


    const hasRecords =
      Array.isArray(
        result.records
      ) &&
      result.records.length > 0;

    const hasValue =
      result.value !== null &&
      result.value !== undefined;


    if (
      !hasRecords &&
      !hasValue
    ) {
      return createActionResult({
        actionId:
          "statistics",

        status:
          ACTION_RESULT_STATUS.NO_RESULT,

        data: result,

        evidence: [],

        metadata: {
          query:
            plan.query,

          planning:
            plan.planning,

          dataset:
            result.metadata
              ?.datasetId ??
            null,
        },
      });
    }


    return createActionResult({
      actionId:
        "statistics",

      status:
        ACTION_RESULT_STATUS.SUCCESS,

      data:
        result,

      evidence: [],

      metadata: {
        query:
          plan.query,

        planning:
          plan.planning,

        dataset:
          result.metadata
            ?.datasetId ??
          null,

        providerName:
          result.metadata
            ?.providerName ??
          null,
      },
    });
  } catch (error) {
    return createActionResult({
      actionId:
        "statistics",

      status:
        ACTION_RESULT_STATUS.FAILED,

      data: null,

      evidence: [],

      metadata: {},

      error:
        error instanceof Error
          ? error.message
          : "Unknown statistics action error.",
    });
  }
}


export const statisticsAction =
  createActionDefinition({
    id:
      "statistics",

    name:
      "Statistics",

    description:
      "Query structured tennis data such as rankings, player testing results, match statistics, performance measurements, and other numerical or tabular datasets.",

    capabilities: [
      "Retrieve player rankings",
      "Retrieve ranking history",
      "Query player testing results",
      "Query match statistics",
      "Query performance measurements",
      "Filter structured tennis data",
      "Sort structured tennis data",
      "Find maximum and minimum values",
      "Calculate averages and counts",
      "Compare structured player data",
      "Query structured data across time ranges",
    ],

    inputSchema: {
      question: {
        type:
          "string",

        required:
          true,
      },
    },

    execute:
      executeStatisticsAction,

    // Keep disabled until a real dataset
    // is registered for the running app.
    isEnabled:
        true,

    isAvailable:
      () =>
        getAvailableDatasets()
          .length > 0,
  });