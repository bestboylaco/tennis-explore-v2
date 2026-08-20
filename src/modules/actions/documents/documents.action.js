import {
  createActionDefinition,
  createActionResult,
  ACTION_RESULT_STATUS,
} from "../action.types.js";

import {
  orchestrateKnowledgeRetrieval,
} from "../../orchestration/index.js";


async function executeDocumentsAction({
  question,
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Documents action requires a non-empty question."
    );
  }

  try {
    const orchestration =
      await orchestrateKnowledgeRetrieval({
        question: question.trim(),
      });

    const mergedEvidence =
      orchestration?.mergedEvidence;

    const evidence =
      Array.isArray(
        mergedEvidence?.evidence
      )
        ? mergedEvidence.evidence
        : [];

    if (evidence.length === 0) {
      return createActionResult({
        actionId: "documents",

        status:
          ACTION_RESULT_STATUS.NO_RESULT,

        evidence: [],

        metadata: {
          evidenceCount: 0,
          sourceCount: 0,
          confidence: null,
          consensus: null,
        },
      });
    }

    return createActionResult({
      actionId: "documents",

      status:
        ACTION_RESULT_STATUS.SUCCESS,

      evidence,

      metadata: {
        evidenceCount:
          evidence.length,

        sourceCount:
          mergedEvidence?.summary
            ?.sourceCount ?? 0,

        confidence:
          mergedEvidence?.summary ??
          null,

        consensus:
          mergedEvidence?.consensus ??
          null,
      },
    });
  } catch (error) {
    return createActionResult({
      actionId: "documents",

      status:
        ACTION_RESULT_STATUS.FAILED,

      evidence: [],

      metadata: {
        evidenceCount: 0,
        sourceCount: 0,
        confidence: null,
        consensus: null,
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
    id: "documents",

    name: "Documents",

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
        type: "string",
        required: true,
      },
    },

    execute:
      executeDocumentsAction,

    isEnabled: true,
  });