import {
  assertValidActionDefinition,
} from "./actionValidator.js";


const actionRegistry =
  new Map();


function normaliseActionId(
  actionId
) {
  if (
    typeof actionId !== "string"
  ) {
    return "";
  }

  return actionId
    .trim()
    .toLowerCase();
}


function isActionCurrentlyAvailable(
  action
) {
  if (!action) {
    return false;
  }


  // Static switch controlled by us.
  if (!action.isEnabled) {
    return false;
  }


  // No runtime check means the action
  // is available whenever enabled.
  if (
    typeof action.isAvailable !==
    "function"
  ) {
    return true;
  }


  try {
    return (
      action.isAvailable() === true
    );
  } catch {
    // If an availability check fails,
    // do not expose the action to Ollama.
    return false;
  }
}


export function registerAction(
  action,
  {
    replace = false,
  } = {}
) {
  assertValidActionDefinition(
    action
  );


  const actionId =
    normaliseActionId(
      action.id
    );


  if (
    actionRegistry.has(actionId) &&
    !replace
  ) {
    throw new Error(
      `Action "${actionId}" is already registered.`
    );
  }


  actionRegistry.set(
    actionId,
    action
  );


  return action;
}


export function getActionById(
  actionId
) {
  const normalisedId =
    normaliseActionId(
      actionId
    );


  if (!normalisedId) {
    return null;
  }


  return (
    actionRegistry.get(
      normalisedId
    ) ?? null
  );
}


export function hasAction(
  actionId
) {
  const normalisedId =
    normaliseActionId(
      actionId
    );


  if (!normalisedId) {
    return false;
  }


  return actionRegistry.has(
    normalisedId
  );
}


export function getAvailableActions({
  includeDisabled = false,
} = {}) {
  const actions =
    Array.from(
      actionRegistry.values()
    );


  // Useful for diagnostics/tests where we
  // want every registered action.
  if (includeDisabled) {
    return actions;
  }


  return actions.filter(
    (action) =>
      isActionCurrentlyAvailable(
        action
      )
  );
}


export function getActionDescriptions() {
  return getAvailableActions()
    .map((action) => ({
      id:
        action.id,

      name:
        action.name,

      description:
        action.description,

      capabilities:
        action.capabilities,
    }));
}


export function unregisterAction(
  actionId
) {
  const normalisedId =
    normaliseActionId(
      actionId
    );


  if (!normalisedId) {
    return false;
  }


  return actionRegistry.delete(
    normalisedId
  );
}


export function clearActionRegistry() {
  actionRegistry.clear();
}