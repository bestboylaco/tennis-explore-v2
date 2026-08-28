import {
  retrievalConfig,
} from "../../config/retrieval.config.js";

import {
  getActionDescriptions,
  getAvailableActions,
} from "../actions/index.js";

import {
  buildAgentContinuationPrompt,
} from "./agentObservationPrompt.service.js";

import {
  getExecutedActionIds,
} from "./agentState.service.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function cleanJsonCompletion(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}


function extractJsonObject(value) {
  const firstBrace =
    value.indexOf("{");

  const lastBrace =
    value.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace <= firstBrace
  ) {
    throw new Error(
      "Agent continuation response did not contain a JSON object."
    );
  }

  return value
    .slice(
      firstBrace,
      lastBrace + 1
    )
    .trim();
}


function parseContinuationCompletion(
  completion
) {
  const cleaned =
    cleanJsonCompletion(
      completion
    );

  if (!cleaned) {
    throw new Error(
      "Agent continuation returned an empty completion."
    );
  }

  const jsonText =
    extractJsonObject(
      cleaned
    );

  let parsed;

  try {
    parsed =
      JSON.parse(
        jsonText
      );
  } catch {
    throw new Error(
      `Agent continuation returned invalid JSON: ${jsonText}`
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Agent continuation response must be a JSON object."
    );
  }

  return parsed;
}


function validateContinuationDecision({
  decision,
  state,
} = {}) {
  if (
    !decision ||
    typeof decision !== "object"
  ) {
    throw new TypeError(
      "Continuation decision must be an object."
    );
  }


  if (
    decision.type !== "actions" &&
    decision.type !== "finish"
  ) {
    throw new TypeError(
      'Continuation type must be "actions" or "finish".'
    );
  }


  if (
    !Array.isArray(
      decision.selectedActions
    )
  ) {
    throw new TypeError(
      "Continuation selectedActions must be an array."
    );
  }


  if (
    typeof decision.confidence !==
      "number" ||
    !Number.isFinite(
      decision.confidence
    ) ||
    decision.confidence < 0 ||
    decision.confidence > 1
  ) {
    throw new TypeError(
      "Continuation confidence must be between 0 and 1."
    );
  }


  if (
    !isNonEmptyString(
      decision.rationale
    )
  ) {
    throw new TypeError(
      "Continuation rationale must be a non-empty string."
    );
  }


  const availableActionIds =
    new Set(
      getAvailableActions()
        .map(
          (action) =>
            action.id
              .trim()
              .toLowerCase()
        )
    );


  const selectedActions =
    [
      ...new Set(
        decision.selectedActions
          .map(
            (actionId) => {
              if (
                !isNonEmptyString(
                  actionId
                )
              ) {
                throw new TypeError(
                  "Continuation action ids must be non-empty strings."
                );
              }

              return actionId
                .trim()
                .toLowerCase();
            }
          )
      ),
    ];


  for (
    const actionId
    of selectedActions
  ) {
    if (
      !availableActionIds.has(
        actionId
      )
    ) {
      throw new Error(
        `Continuation selected unavailable action "${actionId}".`
      );
    }
  }


  if (
    decision.type === "finish" &&
    selectedActions.length > 0
  ) {
    throw new Error(
      "A finish decision cannot select actions."
    );
  }


  if (
    decision.type === "actions" &&
    selectedActions.length === 0
  ) {
    throw new Error(
      "An actions decision must select at least one action."
    );
  }


  const executedActions =
    new Set(
      getExecutedActionIds(
        state
      )
    );


  /*
   * For the current MVP, actions receive the same
   * original question each time.
   *
   * Re-running the same successful action therefore
   * provides no new information and could create loops.
   */
  const repeatedActions =
    selectedActions.filter(
      (actionId) =>
        executedActions.has(
          actionId
        )
    );


  if (
    repeatedActions.length > 0
  ) {
    throw new Error(
      `Agent attempted to repeat action(s): ${repeatedActions.join(
        ", "
      )}.`
    );
  }


  return Object.freeze({
    type:
      decision.type,

    selectedActions:
      Object.freeze([
        ...selectedActions,
      ]),

    confidence:
      decision.confidence,

    rationale:
      decision.rationale.trim(),
  });
}


async function generateContinuationCompletion({
  prompt,
  signal = null,
} = {}) {
  const model =
    retrievalConfig.query.plannerModel;


  const response =
    await fetch(
      `${retrievalConfig.generation.baseUrl}/api/chat`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            model,

            stream: false,

            options: {
              temperature: 0,
            },

            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
          }),

        signal,
      }
    );


  if (!response.ok) {
    throw new Error(
      `Agent continuation model returned ${response.status}.`
    );
  }


  const payload =
    await response.json();


  return Object.freeze({
    completion:
      String(
        payload.message?.content ??
        ""
      ).trim(),

    provider:
      "ollama",

    model,
  });
}

function buildRepairPrompt({
  originalPrompt,
  error,
  availableActions,
} = {}) {
  const validActionIds =
    availableActions
      .map((action) => action.id)
      .join(", ");

  return `
${originalPrompt}

YOUR PREVIOUS RESPONSE WAS INVALID.

VALIDATION ERROR

${error}

VALID ACTION IDS

${validActionIds}

Correct the decision.

IMPORTANT:
- Use only the exact action IDs listed above.
- Do not invent capability names as action IDs.
- If research papers are required and "documents" provides that capability, use "documents".
- Return only the corrected JSON object.
`.trim();
}

export async function decideNextAgentStep({
  question,
  state,
  signal = null,
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Agent continuation requires a non-empty question."
    );
  }


  if (
    !state ||
    typeof state !== "object"
  ) {
    throw new TypeError(
      "Agent continuation requires agent state."
    );
  }


  const availableActions =
    getActionDescriptions();


  const prompt =
    buildAgentContinuationPrompt({
      question:
        question.trim(),

      state,

      availableActions,
    });


  let generation =
    await generateContinuationCompletion({
        prompt,
        signal,
    });


    let decision;


    try {
    const parsed =
        parseContinuationCompletion(
        generation.completion
        );


    decision =
        validateContinuationDecision({
        decision:
            parsed,

        state,
        });
    } catch (error) {
    const repairPrompt =
        buildRepairPrompt({
        originalPrompt:
            prompt,

        error:
            error instanceof Error
            ? error.message
            : "Invalid continuation decision.",

        availableActions,
        });


    generation =
        await generateContinuationCompletion({
        prompt:
            repairPrompt,

        signal,
        });


    const repaired =
        parseContinuationCompletion(
        generation.completion
        );


    decision =
        validateContinuationDecision({
        decision:
            repaired,

        state,
        });
    }


  return Object.freeze({
    decision,

    provider:
      generation.provider,

    model:
      generation.model,
  });
}