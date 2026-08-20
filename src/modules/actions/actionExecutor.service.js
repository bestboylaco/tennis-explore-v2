import {
  getActionById,
  getAvailableActions,
} from "./actionRegistry.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function getAvailableActionIds() {
  return new Set(
    getAvailableActions().map(
      (action) =>
        action.id
          .trim()
          .toLowerCase()
    )
  );
}


export async function executeSelectedActions({
  question,
  actionIds = [],
  context = {},
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Action execution requires a non-empty question."
    );
  }


  if (
    !Array.isArray(actionIds) ||
    actionIds.length === 0
  ) {
    throw new TypeError(
      "At least one action id is required."
    );
  }


  const availableActionIds =
    getAvailableActionIds();


  const normalisedActionIds =
    [
      ...new Set(
        actionIds.map(
          (actionId) => {
            if (
              !isNonEmptyString(
                actionId
              )
            ) {
              throw new TypeError(
                "Action ids must be non-empty strings."
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
    of normalisedActionIds
  ) {
    if (
      !availableActionIds.has(
        actionId
      )
    ) {
      throw new Error(
        `Action "${actionId}" is not currently available.`
      );
    }
  }


  const executions =
    normalisedActionIds.map(
      async (actionId) => {
        const action =
          getActionById(
            actionId
          );


        if (!action) {
          throw new Error(
            `Action "${actionId}" is not registered.`
          );
        }


        const result =
          await action.execute({
            question:
              question.trim(),

            context,
          });


        return Object.freeze({
          actionId,
          result,
        });
      }
    );


  const results =
    await Promise.all(
      executions
    );


  return Object.freeze({
    question:
      question.trim(),

    requestedActions:
      Object.freeze([
        ...normalisedActionIds,
      ]),

    results:
      Object.freeze(
        results
      ),
  });
}