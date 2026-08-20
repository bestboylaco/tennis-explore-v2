import {
  generateCompletion,
} from "../ai/services/generationProvider.js";

import {
  getActionDescriptions,
} from "../actions/index.js";

import {
  buildRoutingPrompt,
} from "./routingPromptBuilder.service.js";

import {
  assertValidRoutingDecision,
} from "./routingValidator.js";

import {
  createRoutingDecision,
} from "./routing.types.js";


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
      "Routing agent response did not contain a JSON object."
    );
  }

  return value
    .slice(
      firstBrace,
      lastBrace + 1
    )
    .trim();
}


function parseRoutingCompletion(
  completion
) {
  const cleaned =
    cleanJsonCompletion(
      completion
    );

  if (!cleaned) {
    throw new Error(
      "Routing agent returned an empty completion."
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
      `Routing agent returned invalid JSON: ${jsonText}`
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Routing agent response must be a JSON object."
    );
  }

  return parsed;
}


export async function routeQuestion({
  question,
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Routing requires a non-empty question."
    );
  }


  const availableActions =
    getActionDescriptions();


  if (availableActions.length === 0) {
    throw new Error(
      "No enabled actions are available for routing."
    );
  }


  const prompt =
    buildRoutingPrompt({
      question:
        question.trim(),

      actions:
        availableActions,
    });


  const generation =
    await generateCompletion({
      prompt,

      // Routing should be predictable,
      // not creative.
      temperature: 0,
    });


  const parsedDecision =
    parseRoutingCompletion(
      generation.completion
    );


  assertValidRoutingDecision(
    parsedDecision
  );


  const decision =
    createRoutingDecision({
      type:
        parsedDecision.type,

      selectedActions:
        parsedDecision.selectedActions,

      alternativeActions:
        parsedDecision.alternativeActions,

      confidence:
        parsedDecision.confidence,

      rationale:
        parsedDecision.rationale,

      clarificationQuestion:
        parsedDecision.clarificationQuestion,
    });


  return Object.freeze({
    question:
      question.trim(),

    decision,

    routing: Object.freeze({
      provider:
        generation.provider,

      model:
        generation.model,

      availableActions:
        availableActions.map(
          (action) => action.id
        ),
    }),
  });
}