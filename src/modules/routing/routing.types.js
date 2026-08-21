export const ROUTING_DECISION_TYPE =
  Object.freeze({
    ACTIONS: "actions",
    CLARIFICATION: "clarification",
    NO_ACTION: "no_action",
  });


export function createRoutingDecision({
  type =
    ROUTING_DECISION_TYPE.ACTIONS,

  selectedActions = [],

  alternativeActions = [],

  confidence = 0,

  rationale = "",

  clarificationQuestion = null,
} = {}) {
  return Object.freeze({
    type,

    selectedActions:
      Object.freeze(
        Array.isArray(selectedActions)
          ? [...selectedActions]
          : []
      ),

    alternativeActions:
      Object.freeze(
        Array.isArray(alternativeActions)
          ? [...alternativeActions]
          : []
      ),

    confidence,

    rationale,

    clarificationQuestion,
  });
}