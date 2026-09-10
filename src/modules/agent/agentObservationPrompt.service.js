function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}
function serialiseEvidence(
  evidence = []
) {
  if (!Array.isArray(evidence)) {
    return [];
  }

  return evidence
    .slice(0, 3)
    .map((item) => ({
      title:
        item?.title ??
        item?.file_name ??
        null,

      section:
        item?.section ??
        null,

      text:
        typeof item?.text === "string"
          ? item.text
              .slice(0, 500)
          : null,
    }));
}

function serialiseObservation(
  observation
) {
  return {
    actionId:
      observation?.actionId ??
      null,

    status:
      observation?.status ??
      "unknown",

    data:
      observation?.data ??
      null,

    evidenceCount:
      Array.isArray(
        observation?.evidence
      )
        ? observation.evidence.length
        : 0,
    
     evidencePreview:
        serialiseEvidence(
            observation?.evidence
        ),

    metadata:
      observation?.metadata ??
      {},

    error:
      observation?.error ??
      null,
  };
}


export function buildAgentContinuationPrompt({
  question,
  state,
  availableActions = [],
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Agent continuation prompt requires a non-empty question."
    );
  }


  if (
    !state ||
    typeof state !== "object"
  ) {
    throw new TypeError(
      "Agent continuation prompt requires agent state."
    );
  }


  const previousSteps =
    Array.isArray(state.steps)
      ? state.steps.map(
          (step) => ({
            stepNumber:
              step.stepNumber,

            selectedActions:
              step.decision
                ?.selectedActions ??
              [],

            observations:
              Array.isArray(
                step.observations
              )
                ? step.observations.map(
                    serialiseObservation
                  )
                : [],
          })
        )
      : [];


  const actions =
    Array.isArray(
      availableActions
    )
      ? availableActions.map(
          (action) => ({
            id:
              action.id,

            description:
              action.description,

            capabilities:
              action.capabilities ??
              [],
          })
        )
      : [];


  return `
You are the TennisExplore agent.

Your job is to decide what should happen NEXT after reviewing the results of actions already executed.

ORIGINAL COACH QUESTION

${question.trim()}

AVAILABLE ACTIONS

${JSON.stringify(
  actions,
  null,
  2
)}


VALID ACTION IDS

${actions
  .map((action) => action.id)
  .join(", ")}

IMPORTANT:
When selecting an action, selectedActions MUST contain the exact ID shown above.
For example, if research papers are needed and the Documents action supports research papers,
select "documents". Do not invent an id such as "research".

CURRENT AGENT STATE

${JSON.stringify(
  previousSteps,
  null,
  2
)}

RULES

1. Review the original question and all previous observations.

2. If the available observations are sufficient to answer the coach's question, choose "finish".

3. If more information is genuinely required, choose "actions" and select only the additional action or actions needed.

4. Do not repeat an action unless the previous attempt failed, returned no useful result, or a materially different action execution is required.

5. Never invent an action that is not listed in AVAILABLE ACTIONS.

6. Do not answer the coach's tennis question yourself.

7. Return only valid JSON.

8. Do not include Markdown or text outside the JSON object.

RETURN ONE OF THESE STRUCTURES

If more actions are required:

{
  "type": "actions",
  "selectedActions": ["action_id"],
  "confidence": 0.0,
  "rationale": "Short explanation."
}

If enough information has been collected:

{
  "type": "finish",
  "selectedActions": [],
  "confidence": 0.0,
  "rationale": "Short explanation."
}
`.trim();
}   