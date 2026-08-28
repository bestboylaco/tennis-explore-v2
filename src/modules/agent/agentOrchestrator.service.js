import {
  routeQuestion,
} from "../routing/index.js";

import {
  ACTION_RESULT_STATUS,
  executeSelectedActions,
} from "../actions/index.js";

import {
  appendAgentStep,
  canAgentContinue,
  createAgentState,
} from "./agentState.service.js";

import {
  decideNextAgentStep,
} from "./agentContinuation.service.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function isRepeatedActionError(error) {
  return (
    error instanceof Error &&
    error.message.includes(
      "Agent attempted to repeat action"
    )
  );
}


/*
 * A planned execution is complete when every
 * selected Action returned SUCCESS.
 *
 * This prevents the Agent from asking the model
 * to invent unnecessary additional work after
 * the original plan has already been satisfied.
 */
function executionCompletedSuccessfully(
  execution
) {
  const results =
    execution?.results;

  return (
    Array.isArray(results) &&
    results.length > 0 &&
    results.every(
      ({ result }) =>
        result?.status ===
        ACTION_RESULT_STATUS.SUCCESS
    )
  );
}


/*
 * Access denial is different from a normal
 * no-result outcome.
 *
 * The Agent must not try another Action as a way
 * of working around an existing access boundary.
 */
function executionHasAccessDenied(
  execution
) {
  const results =
    execution?.results;

  return (
    Array.isArray(results) &&
    results.some(
      ({ result }) =>
        result?.metadata?.cause ===
        "access_denied"
    )
  );
}


export async function runAgent({
  question,
  context = {},
  maxSteps = 5,
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Agent requires a non-empty question."
    );
  }


  const normalisedQuestion =
    question.trim();


  /*
   * Agent State remembers everything that happens
   * during this request.
   */
  let state =
    createAgentState({
      question:
        normalisedQuestion,

      maxSteps,
    });


  /*
   * STEP 1:
   *
   * Use the existing routing agent for the
   * initial decision.
   */
  const routing =
    await routeQuestion({
      question:
        normalisedQuestion,
    });


  const initialDecision =
    routing.decision;


  /*
   * Clarification and no_action decisions
   * execute no tools.
   */
  if (
    initialDecision.type !==
    "actions"
  ) {
    return Object.freeze({
      question:
        normalisedQuestion,

      routing,

      execution:
        null,

      agent:
        Object.freeze({
          state,

          continuations:
            Object.freeze([]),

          finalDecision:
            initialDecision,

          stopReason:
            initialDecision.type,
        }),
    });
  }


  /*
   * Execute the first selected Action(s).
   */
  const initialExecution =
    await executeSelectedActions({
      question:
        normalisedQuestion,

      actionIds:
        initialDecision
          .selectedActions,

      context,
    });


  /*
   * Convert execution results into observations
   * and store them in Agent State.
   */
  state =
    appendAgentStep(
      state,
      {
        decision:
          initialDecision,

        execution:
          initialExecution,
      }
    );


  /*
   * Access denial is a deterministic stop.
   *
   * Do not ask the continuation model to try
   * another capability, because doing so could
   * allow the Agent to route around the original
   * security boundary.
   */
  if (
    executionHasAccessDenied(
      initialExecution
    )
  ) {
    return Object.freeze({
      question:
        normalisedQuestion,

      routing,

      execution:
        initialExecution,

      agent:
        Object.freeze({
          state,

          continuations:
            Object.freeze([]),

          finalDecision:
            null,

          stopReason:
            "access_denied",
        }),
    });
  }


  /*
   * If every Action selected by the initial plan
   * completed successfully, the plan is complete.
   *
   * Do not ask the model to invent unnecessary
   * additional work.
   */
  if (
    executionCompletedSuccessfully(
      initialExecution
    )
  ) {
    return Object.freeze({
      question:
        normalisedQuestion,

      routing,

      execution:
        initialExecution,

      agent:
        Object.freeze({
          state,

          continuations:
            Object.freeze([]),

          finalDecision:
            null,

          stopReason:
            "plan_complete",
        }),
    });
  }


  const continuations = [];

  let finalDecision =
    null;

  let stopReason =
    null;


  /*
   * GENERAL AGENT LOOP
   *
   * Decide
   *   ↓
   * Execute
   *   ↓
   * Observe
   *   ↓
   * Decide again
   */
  while (
    canAgentContinue(
      state
    )
  ) {
    let continuation;


    try {
      continuation =
        await decideNextAgentStep({
          question:
            normalisedQuestion,

          state,

          signal:
            context?.signal ??
            null,
        });
    } catch (error) {
      /*
       * The model may request an Action that has
       * already run.
       *
       * For the MVP, repeating the same Action with
       * the same original question cannot provide
       * new information.
       *
       * Stop the loop deterministically instead of
       * allowing an infinite cycle.
       */
      if (
        isRepeatedActionError(
          error
        )
      ) {
        stopReason =
          "repeat_guard";

        break;
      }


      throw error;
    }


    continuations.push(
      continuation
    );


    /*
     * The model believes enough information
     * has been collected.
     *
     * We record this decision, but later
     * synthesis and verification still decide
     * whether the final answer is safe to return.
     */
    if (
      continuation.decision
        .type === "finish"
    ) {
      finalDecision =
        continuation.decision;

      stopReason =
        "model_finish";

      break;
    }


    /*
     * Otherwise execute the newly requested
     * Action(s).
     */
    const nextExecution =
      await executeSelectedActions({
        question:
          normalisedQuestion,

        actionIds:
          continuation.decision
            .selectedActions,

        context,
      });


    /*
     * Store the new observations before deciding
     * whether this execution completes the Agent.
     *
     * This ensures synthesis later has access to
     * the full Action results.
     */
    state =
      appendAgentStep(
        state,
        {
          decision:
            continuation.decision,

          execution:
            nextExecution,
        }
      );


    /*
     * As with the initial execution, access denial
     * must stop recovery deterministically.
     */
    if (
      executionHasAccessDenied(
        nextExecution
      )
    ) {
      stopReason =
        "access_denied";

      break;
    }


    /*
     * If the recovery Action(s) succeeded, the
     * newly selected plan has been satisfied.
     *
     * Do not call the continuation model again.
     */
    if (
      executionCompletedSuccessfully(
        nextExecution
      )
    ) {
      stopReason =
        "plan_complete";

      break;
    }
  }


  /*
   * Hard deterministic safety ceiling.
   */
  if (
    !stopReason &&
    !canAgentContinue(
      state
    )
  ) {
    stopReason =
      "max_steps";
  }


  return Object.freeze({
    question:
      normalisedQuestion,

    /*
     * Keep these original fields so we do not
     * unnecessarily break existing callers.
     */
    routing,

    execution:
      initialExecution,

    /*
     * General-Agent information.
     */
    agent:
      Object.freeze({
        state,

        continuations:
          Object.freeze([
            ...continuations,
          ]),

        finalDecision,

        stopReason,
      }),
  });
}