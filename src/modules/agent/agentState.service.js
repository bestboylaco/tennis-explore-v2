const DEFAULT_MAX_STEPS = 5;


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function isPositiveInteger(value) {
  return (
    Number.isInteger(value) &&
    value > 0
  );
}


export function createAgentState({
  question,
  maxSteps = DEFAULT_MAX_STEPS,
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Agent state requires a non-empty question."
    );
  }


  if (!isPositiveInteger(maxSteps)) {
    throw new TypeError(
      "Agent maxSteps must be a positive integer."
    );
  }


  return Object.freeze({
    question:
      question.trim(),

    stepCount: 0,

    maxSteps,

    steps:
      Object.freeze([]),
  });
}


export function appendAgentStep(
  state,
  {
    decision,
    execution,
  } = {}
) {
  if (
    !state ||
    typeof state !== "object"
  ) {
    throw new TypeError(
      "A valid agent state is required."
    );
  }


  if (
    !decision ||
    typeof decision !== "object"
  ) {
    throw new TypeError(
      "Agent step requires a routing decision."
    );
  }


  const nextStepNumber =
    state.stepCount + 1;


  if (
    nextStepNumber >
    state.maxSteps
  ) {
    throw new Error(
      "Agent maximum step limit has been reached."
    );
  }


  const observations =
    Array.isArray(
      execution?.results
    )
      ? execution.results.map(
          ({
            actionId,
            result,
          }) =>
            Object.freeze({
              actionId,
              status:
                result?.status ??
                "unknown",

              data:
                result?.data ??
                null,

              evidence:
                Array.isArray(
                  result?.evidence
                )
                  ? Object.freeze([
                      ...result.evidence,
                    ])
                  : Object.freeze([]),

              metadata:
                result?.metadata ??
                {},

              error:
                result?.error ??
                null,
            })
        )
      : [];


  const step =
    Object.freeze({
      stepNumber:
        nextStepNumber,

      decision,

      observations:
        Object.freeze(
          observations
        ),
    });


  return Object.freeze({
    ...state,

    stepCount:
      nextStepNumber,

    steps:
      Object.freeze([
        ...state.steps,
        step,
      ]),
  });
}


export function canAgentContinue(
  state
) {
  return (
    state &&
    Number.isInteger(
      state.stepCount
    ) &&
    Number.isInteger(
      state.maxSteps
    ) &&
    state.stepCount <
      state.maxSteps
  );
}


export function getExecutedActionIds(
  state
) {
  if (
    !state ||
    !Array.isArray(state.steps)
  ) {
    return [];
  }


  return [
    ...new Set(
      state.steps.flatMap(
        (step) =>
          Array.isArray(
            step.observations
          )
            ? step.observations
                .map(
                  (observation) =>
                    observation.actionId
                )
                .filter(
                  isNonEmptyString
                )
            : []
      )
    ),
  ];
}