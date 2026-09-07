import {
  ACTION_RESULT_STATUS,
} from "../actions/index.js";

import {
  retrievalConfig,
} from "../../config/retrieval.config.js";



import {
  renderMarkdownTable,
} from "../retrieval/answerContract.service.js";

import {
  buildAssetLink,
} from "../retrieval/assetLink.service.js";
export const AGENT_SYNTHESIS_MODES =
  Object.freeze({
    NONE:
      "none",

    DOCUMENTS:
      "documents",

    STATISTICS:
      "statistics",

    HYBRID:
      "hybrid",
  });


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function getSuccessfulObservations(
  state
) {
  if (
    !state ||
    !Array.isArray(state.steps)
  ) {
    return [];
  }


  return state.steps.flatMap(
    (step) =>
      Array.isArray(
        step.observations
      )
        ? step.observations.filter(
            (observation) =>
              observation?.status ===
              ACTION_RESULT_STATUS.SUCCESS
          )
        : []
  );
}


function getNoResultObservations(
  state
) {
  if (
    !state ||
    !Array.isArray(state.steps)
  ) {
    return [];
  }


  return state.steps.flatMap(
    (step) =>
      Array.isArray(
        step.observations
      )
        ? step.observations.filter(
            (observation) =>
              observation?.status ===
              ACTION_RESULT_STATUS.NO_RESULT
          )
        : []
  );
}


function getDocumentEvidence(
  observations
) {
  return observations
    .filter(
      (observation) =>
        observation?.actionId ===
        "documents"
    )
    .flatMap(
      (observation) =>
        Array.isArray(
          observation.evidence
        )
          ? observation.evidence
          : []
    );
}


function getStatisticsResults(
  observations
) {
  return observations
    .filter(
      (observation) =>
        observation?.actionId ===
        "statistics" &&
        observation?.data &&
        typeof observation.data ===
        "object"
    )
    .map(
      (observation) =>
        observation.data
    );
}


function determineSynthesisMode({
  documentEvidence,
  statisticsResults,
}) {
  const hasDocuments =
    documentEvidence.length > 0;

  const hasStatistics =
    statisticsResults.length > 0;


  if (
    hasDocuments &&
    hasStatistics
  ) {
    return AGENT_SYNTHESIS_MODES.HYBRID;
  }


  if (hasDocuments) {
    return AGENT_SYNTHESIS_MODES.DOCUMENTS;
  }


  if (hasStatistics) {
    return AGENT_SYNTHESIS_MODES.STATISTICS;
  }


  return AGENT_SYNTHESIS_MODES.NONE;
}


/*
 * Converts AgentState into a deterministic input
 * package for the synthesis stage.
 *
 * No Action is executed here.
 * No retrieval is repeated here.
 * No statistics are recalculated here.
 *
 * This service only reads observations that were
 * already produced by the Agent.
 */
export function createAgentSynthesisInput({
  question,
  state,
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Agent synthesis requires a non-empty question."
    );
  }


  if (
    !state ||
    typeof state !== "object"
  ) {
    throw new TypeError(
      "Agent synthesis requires a valid AgentState."
    );
  }


  /*
   * Successful observations are the only observations
   * allowed to contribute evidence/data to synthesis.
   */
  const successfulObservations =
    getSuccessfulObservations(
      state
    );


  /*
   * NO_RESULT observations are deliberately kept
   * separate from synthesis evidence.
   *
   * They are useful later when TennisExplore needs
   * to explain:
   *
   * - what was searched
   * - why evidence was insufficient
   *
   * without treating failed retrieval/grading as
   * valid answer evidence.
   */
  const noResultObservations =
    getNoResultObservations(
      state
    );


  const documentEvidence =
    getDocumentEvidence(
      successfulObservations
    );


  const statisticsResults =
    getStatisticsResults(
      successfulObservations
    );


  const mode =
    determineSynthesisMode({
      documentEvidence,
      statisticsResults,
    });


  const successfulActionIds =
    [
      ...new Set(
        successfulObservations
          .map(
            (observation) =>
              observation.actionId
          )
          .filter(
            isNonEmptyString
          )
      ),
    ];


  const noResultActionIds =
    [
      ...new Set(
        noResultObservations
          .map(
            (observation) =>
              observation.actionId
          )
          .filter(
            isNonEmptyString
          )
      ),
    ];


  return Object.freeze({
    question:
      question.trim(),

    mode,

    documentEvidence:
      Object.freeze([
        ...documentEvidence,
      ]),

    statisticsResults:
      Object.freeze([
        ...statisticsResults,
      ]),

    successfulActionIds:
      Object.freeze([
        ...successfulActionIds,
      ]),

    noResultActionIds:
      Object.freeze([
        ...noResultActionIds,
      ]),

    noResultObservations:
      Object.freeze([
        ...noResultObservations,
      ]),
  });
}



const STATISTICS_SYSTEM_PROMPT = `
You are a tennis coaching assistant.

You are given the result of a structured query that has already been calculated by the backend.

Rules:
- Answer the coach's question using ONLY the supplied query result.
- The result has already been computed. Do NOT recalculate averages, counts, rankings, totals, medians, percentages, or any other values.
- Do not introduce numerical values that are not present in the supplied result.
- Do not use outside knowledge.
- Explain the result clearly and concisely for a tennis coach.
- If the result does not contain enough information to answer the question, say so plainly.
- Do not mention these rules.
`.trim();


async function generateStatisticsCompletion({
  question,
  result,
  signal = null,
} = {}) {
  const markdown =
    renderMarkdownTable(
      result.columns ?? [],
      result.rows ?? []
    );


  const userContent =
    `Result of the query (already computed; do not recalculate):\n\n` +
    `${markdown}\n\n` +
    `Rows scanned: ${result.rowsScanned ?? 0}.\n` +
    `Rows matched: ${result.rowsMatched ?? 0}.\n` +
    `Rows returned: ${result.rowsReturned ?? 0}.\n` +
    `Source table: ${result.tableTitle ?? result.table ?? "Unknown table"}\n\n` +
    `Question: ${question}`;


  const response =
    await fetch(
      `${retrievalConfig.generation.baseUrl}/api/chat`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            model:
              retrievalConfig.generation.model,

            stream:
              false,

            options: {
              temperature:
                0,
            },

            messages: [
              {
                role:
                  "system",

                content:
                  STATISTICS_SYSTEM_PROMPT,
              },

              {
                role:
                  "user",

                content:
                  userContent,
              },
            ],
          }),

        signal,
      }
    );


  if (!response.ok) {
    throw new Error(
      `Statistics synthesis model returned ${response.status}.`
    );
  }


  const payload =
    await response.json();


  return String(
    payload.message?.content ??
    ""
  ).trim();
}


function createStatisticsCitation(
  result
) {
  return Object.freeze({
    number:
      1,

    chunkId:
      null,

    docId:
      result.table ?? null,

    title:
      result.tableTitle ??
      result.table ??
      "Structured data",

    sourceType:
      "table",

    quote:
      null,

    sql:
      result.sql ?? null,

    link:
      buildAssetLink({
        doc_id:
          result.table,

        title:
          result.tableTitle,

        modality:
          "record",

        source_uri:
          result.sourceUri,

        row_id:
          null,
      }),

    basis:
      Object.freeze({
        rowsScanned:
          result.rowsScanned ?? 0,

        rowsMatched:
          result.rowsMatched ?? 0,
      }),
  });
}

/*
 * Produces a natural-language explanation from an
 * ALREADY-COMPUTED Statistics Action result.
 *
 * This function never:
 *
 * - routes the question
 * - executes an Action
 * - calls runQuery()
 * - performs arithmetic
 *
 * The language model only explains the deterministic
 * result already stored in AgentState.
 *
 * generateText can be injected by unit tests so tests
 * do not need a running Ollama server.
 */
export async function synthesizeStatisticsAnswer({
  synthesisInput,
  signal = null,
  generateText = null,
} = {}) {
  if (
    !synthesisInput ||
    typeof synthesisInput !== "object"
  ) {
    throw new TypeError(
      "Statistics synthesis requires a valid synthesis input."
    );
  }


  if (
    synthesisInput.mode !==
    AGENT_SYNTHESIS_MODES.STATISTICS
  ) {
    throw new Error(
      `Statistics synthesis cannot handle mode "${synthesisInput.mode}".`
    );
  }


  if (
    !Array.isArray(
      synthesisInput.statisticsResults
    ) ||
    synthesisInput.statisticsResults.length ===
      0
  ) {
    throw new Error(
      "Statistics synthesis requires an existing Statistics Action result."
    );
  }


  /*
   * Statistics currently cannot repeat the same
   * Action during one Agent run, so one successful
   * result is expected for this MVP.
   */
  const result =
    synthesisInput
      .statisticsResults[0];


  const generator =
    typeof generateText ===
    "function"
      ? generateText
      : ({
          question,
          result,
          signal,
        }) =>
          generateStatisticsCompletion({
            question,
            result,
            signal,
          });


  const answer =
    String(
      await generator({
        question:
          synthesisInput.question,

        result,

        signal,
      }) ??
      ""
    ).trim();


  if (!answer) {
    throw new Error(
      "Statistics synthesis model returned an empty answer."
    );
  }
  
  const citation =
    createStatisticsCitation(
      result
    );


  return Object.freeze({
  answered: true,

  answer,

  mode:
    AGENT_SYNTHESIS_MODES.STATISTICS,

  citations:
    Object.freeze([
      citation,
    ]),

  statistics:
    Object.freeze({
      data:
        result,

      table:
        Object.freeze({
          columns:
            result.columns ?? [],

          rows:
            result.rows ?? [],

          markdown:
            renderMarkdownTable(
              result.columns ?? [],
              result.rows ?? []
            ),
        }),

      sql:
        result.sql ?? null,
    }),

    
  });
}