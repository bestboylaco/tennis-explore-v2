import {
  createActionDefinition,
  createActionResult,
  ACTION_RESULT_STATUS,
} from "../action.types.js";

import {
  grantsForRole,
} from "../../../shared/constants/accessControl.js";

import {
  AUDIT_QUERY_KINDS,
} from "../../../shared/constants/audit.js";

import {
  getTables,
  visibleTables,
} from "../../structured/tableStore.service.js";

import {
  buildQuerySpec,
} from "../../structured/specPlanner.service.js";

import {
  runQuery,
} from "../../structured/queryEngine.service.js";

import {
  recordAccess,
  recordAccessDenial,
} from "../../audit/services/accessAuditRecorder.service.js";


/*
 * Runtime capability state.
 *
 * The Action Registry currently expects isAvailable()
 * to be synchronous, while getTables() is asynchronous.
 *
 * We therefore load the structured capability once
 * during application bootstrap and remember whether
 * structured data exists.
 */
let statisticsAvailable = false;


export async function initializeStatisticsAction({
  sourceDirs = null,
} = {}) {
  const tables =
    await getTables({
      sourceDirs:
        Array.isArray(sourceDirs) &&
        sourceDirs.length > 0
          ? sourceDirs
          : undefined,
    });

  statisticsAvailable =
    Array.isArray(tables) &&
    tables.length > 0;

  return statisticsAvailable;
}


async function executeStatisticsAction({
  question,
  context = {},
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Statistics action requires a non-empty question."
    );
  }


  const roleId =
    context?.roleId;

  const correlationId =
    context?.correlationId ?? null;

  const signal =
    context?.signal ?? null;


  if (
    typeof roleId !== "string" ||
    roleId.trim().length === 0
  ) {
    throw new TypeError(
      "Statistics action requires an authenticated roleId."
    );
  }


  try {
    /*
     * Load the structured datasets.
     *
     * getTables() is cached by main, so after startup
     * this does not repeatedly rebuild all tables.
     */
    const allTables =
      await getTables();


    const grants =
      grantsForRole(
        roleId.trim()
      );


    const tables =
      visibleTables(
        allTables,
        grants
      );


    /*
     * Do not allow the action to query tables that
     * are outside this user's role.
     */
    if (tables.length === 0) {
      const reason =
        `No structured tables are visible to role "${roleId}".`;


      await recordAccessDenial({
        correlationId,

        roleId:
          roleId.trim(),

        queryKind:
          AUDIT_QUERY_KINDS.TABLE,

        reason,
      });


      return createActionResult({
        actionId:
          "statistics",

        status:
          ACTION_RESULT_STATUS.NO_RESULT,

        data: null,

        evidence: [],

        metadata: {
          cause:
            "access_denied",

          reason,

          visibleTableCount:
            0,
        },
      });
    }


    /*
     * Main's constrained Ollama planner converts
     * the natural-language question into a validated
     * query specification.
     */
    const built =
      await buildQuerySpec(
        question.trim(),
        tables,
        {
          signal,
        }
      );


    if (built.unanswerable) {
      const hiddenCount =
        allTables.length -
        tables.length;


      const cause =
        hiddenCount > 0
          ? "access_denied"
          : "not_found";


      const reason =
        hiddenCount > 0
          ? `${built.reason}. Some structured tables are not visible to role "${roleId}".`
          : built.reason;


      if (
        cause ===
        "access_denied"
      ) {
        await recordAccessDenial({
          correlationId,

          roleId:
            roleId.trim(),

          queryKind:
            AUDIT_QUERY_KINDS.TABLE,

          reason,
        });
      }


      return createActionResult({
        actionId:
          "statistics",

        status:
          ACTION_RESULT_STATUS.NO_RESULT,

        data: null,

        evidence: [],

        metadata: {
          cause,
          reason,

          visibleTableCount:
            tables.length,
        },
      });
    }


    /*
     * runQuery() performs the actual calculation.
     *
     * The LLM does NOT calculate averages,
     * medians, counts, rankings, etc.
     */
    const result =
      runQuery(
        built.spec,
        built.table
      );


    /*
     * Record exactly which structured source crossed
     * the user's access boundary.
     */
    await recordAccess({
      correlationId,

      roleId:
        roleId.trim(),

      queryKind:
        AUDIT_QUERY_KINDS.TABLE,

      documents: [
        {
          docId:
            result.table,

          title:
            result.tableTitle,

          sourceType:
            "table",
        },
      ],
    });


    return createActionResult({
      actionId:
        "statistics",

      status:
        ACTION_RESULT_STATUS.SUCCESS,

      data: {
        columns:
          result.columns,

        rows:
          result.rows,

        sql:
          result.sql,

        table:
          result.table,

        tableTitle:
          result.tableTitle,

        sourceUri:
          result.sourceUri,

        rowsScanned:
          result.rowsScanned,

        rowsMatched:
          result.rowsMatched,

        rowsReturned:
          result.rowsReturned,

        truncated:
          result.truncated,
      },

      evidence: [],

      metadata: {
        querySpec:
          built.spec,

        table:
          result.table,

        tableTitle:
          result.tableTitle,

        rowsScanned:
          result.rowsScanned,

        rowsMatched:
          result.rowsMatched,

        rowsReturned:
          result.rowsReturned,
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

    isEnabled:
      true,

    /*
     * Synchronous because that is what the existing
     * Action Registry expects.
     *
     * initializeStatisticsAction() sets this state
     * during application startup.
     */
    isAvailable:
      () =>
        statisticsAvailable,
  });