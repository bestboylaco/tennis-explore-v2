import {
  routeQuestion,
} from "../routing/index.js";

import {
  executeSelectedActions,
} from "../actions/index.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


export async function runAgent({
  question,
  context = {},
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Agent requires a non-empty question."
    );
  }


  const normalisedQuestion =
    question.trim();


  const routing =
    await routeQuestion({
      question:
        normalisedQuestion,
    });


  const decision =
    routing.decision;


  // A clarification or no-action decision
  // should not execute any tools.
  if (
    decision.type !== "actions"
  ) {
    return Object.freeze({
      question:
        normalisedQuestion,

      routing,

      execution: null,
    });
  }


  const execution =
    await executeSelectedActions({
      question:
        normalisedQuestion,

      actionIds:
        decision.selectedActions,

      context,
    });


  return Object.freeze({
    question:
      normalisedQuestion,

    routing,

    execution,
  });
}