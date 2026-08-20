import {
  createActionDefinition,
  createActionResult,
  ACTION_RESULT_STATUS,
} from "../action.types.js";

import {
  retrieve,
} from "../../retrieval/retrieval.service.js";

import {
  GRADES,
  gradeEvidence,
} from "../../generation/evidenceGrader.service.js";


async function executeDocumentsAction({
  question,
  context = {},
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Documents action requires a non-empty question."
    );
  }

  const roleId =
    context?.roleId;

  if (
    typeof roleId !== "string" ||
    roleId.trim().length === 0
  ) {
    throw new TypeError(
      "Documents action requires an authenticated roleId."
    );
  }

  try {
    const retrieval =
      await retrieve(
        question.trim(),
        {
          roleId:
            roleId.trim(),

          signal:
            context?.signal ?? null,

          subQueries:
            context?.subQueries ?? null,
        }
      );


    const retrievedEvidence =
      Array.isArray(
        retrieval?.evidence
      )
        ? retrieval.evidence
        : [];


    if (
      retrievedEvidence.length === 0
    ) {
      return createActionResult({
        actionId:
          "documents",

        status:
          ACTION_RESULT_STATUS.NO_RESULT,

        evidence: [],

        metadata: {
          evidenceCount: 0,
          sourceCount: 0,

          retrieval:
            retrieval?.telemetry ??
            null,

          grading: null,
        },
      });
    }


    /*
     * Retrieval will usually return the best available chunks,
     * even when the knowledge base does not genuinely answer
     * the question.
     *
     * Reuse main's evidence grader so the Documents Action
     * does not treat irrelevant retrieval results as valid
     * evidence.
     */
    const grading =
      await gradeEvidence(
        question.trim(),
        retrievedEvidence,
        {
          signal:
            context?.signal ??
            null,
        }
      );


    if (
      grading.grade ===
      GRADES.INSUFFICIENT
    ) {
      return createActionResult({
        actionId:
          "documents",

        status:
          ACTION_RESULT_STATUS.NO_RESULT,

        evidence: [],

        metadata: {
          evidenceCount: 0,
          sourceCount: 0,

          retrieval:
            retrieval?.telemetry ??
            null,

          grading: {
            grade:
              grading.grade,

            reason:
              grading.reason,
          },
        },
      });
    }


    const evidence =
      Array.isArray(
        grading.kept
      )
        ? grading.kept
        : [];


    const sourceIds =
      new Set(
        evidence
          .map(
            (chunk) =>
              chunk?.doc_id
          )
          .filter(Boolean)
      );


    return createActionResult({
      actionId:
        "documents",

      status:
        ACTION_RESULT_STATUS.SUCCESS,

      evidence,

      metadata: {
        evidenceCount:
          evidence.length,

        sourceCount:
          sourceIds.size,

        retrieval:
          retrieval?.telemetry ??
          null,

        grading: {
          grade:
            grading.grade,

          reason:
            grading.reason,

          dropped:
            grading.dropped ?? 0,
        },
      },
    });
  } catch (error) {
    return createActionResult({
      actionId:
        "documents",

      status:
        ACTION_RESULT_STATUS.FAILED,

      evidence: [],

      metadata: {
        evidenceCount: 0,
        sourceCount: 0,
        retrieval: null,
        grading: null,
      },

      error:
        error instanceof Error
          ? error.message
          : "Unknown documents action error.",
    });
  }
}


export const documentsAction =
  createActionDefinition({
    id:
      "documents",

    name:
      "Documents",

    description:
      "Search unstructured tennis knowledge such as research papers, coaching material, presentations, conference content, manuals, reports, interviews, and internal written documents.",

    capabilities: [
      "Search research papers",
      "Search coaching knowledge",
      "Search presentations and conference material",
      "Search manuals and reports",
      "Retrieve statements made by coaches or presenters",
      "Retrieve publication details from documents",
      "Retrieve factual information contained inside documents",
      "Retrieve evidence and citations from unstructured sources",
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
      executeDocumentsAction,

    isEnabled:
      true,
  });