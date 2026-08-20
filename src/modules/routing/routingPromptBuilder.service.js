function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function formatActions(
  actions
) {
  return actions
    .map((action, index) => {
      const capabilities =
        Array.isArray(
          action.capabilities
        )
          ? action.capabilities
          : [];

      const capabilityText =
        capabilities.length > 0
          ? capabilities
              .map(
                (capability) =>
                  `- ${capability}`
              )
              .join("\n")
          : "- No capabilities provided.";

      return [
        `ACTION ${index + 1}`,
        `ID: ${action.id}`,
        `Name: ${action.name}`,
        `Description: ${action.description}`,
        "Capabilities:",
        capabilityText,
      ].join("\n");
    })
    .join("\n\n");
}


export function buildRoutingPrompt({
  question,
  actions = [],
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Routing question must be a non-empty string."
    );
  }

  if (
    !Array.isArray(actions) ||
    actions.length === 0
  ) {
    throw new TypeError(
      "At least one available action is required for routing."
    );
  }


  const actionDescriptions =
    formatActions(actions);


  return `
You are the routing agent for TennisExplore.

Your job is to decide which available action or actions are required to answer the coach's question.

You do not answer the tennis question yourself.
You only choose the appropriate action or actions.

AVAILABLE ACTIONS

${actionDescriptions}

COACH QUESTION

${question.trim()}

ROUTING RULES

1. Select actions only from the AVAILABLE ACTIONS list.

2. Choose the action whose description and capabilities best match the information needed to answer the question.

3. You may select more than one action when the question genuinely requires information from multiple capabilities.

4. Do not select additional actions unless they are necessary.

5. If the question is too ambiguous to choose an action reliably, use type "clarification" and provide a short clarificationQuestion.

6. If none of the available actions can answer the question, use type "no_action".

7. confidence must be a number between 0 and 1.

8. rationale must be a short explanation of why the action was selected. Do not provide detailed internal reasoning.

9. Return only valid JSON.

10. Do not include Markdown, code fences, commentary, or text outside the JSON object.

11. If the question depends on an unspecified or unresolved entity, such as an unnamed player, match, tournament, dataset, or time period, choose clarification rather than guessing.

12. Pronouns or vague references such as "this player", "the player", "that match", or "their performance" require clarification when the referenced entity is not available in the question.

13. Do not choose an action merely because that action could contain some information. First determine whether enough information has been provided to perform a meaningful search.

14. Use clarification when different interpretations could lead to materially different searches or results.

15. Confidence should reflect uncertainty. Do not assign confidence 1 when important information is missing or the routing choice is ambiguous.

RETURN EXACTLY THIS STRUCTURE

{
  "type": "actions",
  "selectedActions": ["action_id"],
  "alternativeActions": [],
  "confidence": 0.0,
  "rationale": "Short explanation of the routing decision.",
  "clarificationQuestion": null
}

For a clarification decision:

{
  "type": "clarification",
  "selectedActions": [],
  "alternativeActions": ["possible_action_id"],
  "confidence": 0.0,
  "rationale": "Short explanation of why clarification is required.",
  "clarificationQuestion": "Short question for the coach."
}

For a question that no available action supports:

{
  "type": "no_action",
  "selectedActions": [],
  "alternativeActions": [],
  "confidence": 0.0,
  "rationale": "Short explanation of why no action can answer the question.",
  "clarificationQuestion": null
}
`.trim();
}