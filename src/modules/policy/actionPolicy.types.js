export const ACTION_POLICY_CONTRACT_VERSION = 1;

function validateActionList(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }

  for (const actionId of value) {
    if (
      typeof actionId !== "string" ||
      !actionId.trim()
    ) {
      throw new TypeError(
        `${name} must contain non-empty action IDs`,
      );
    }
  }
}

function uniqueActionIds(actionIds) {
  return [
    ...new Set(
      actionIds.map((actionId) => actionId.trim()),
    ),
  ];
}

export function createActionPolicy({
  requiredActions = [],
  allowedActions = [],
  optionalActions = [],
  maxSteps = 1,
  fallbackRules = [],
  metadata = {},
} = {}) {
  validateActionList(
    requiredActions,
    "requiredActions",
  );

  validateActionList(
    allowedActions,
    "allowedActions",
  );

  validateActionList(
    optionalActions,
    "optionalActions",
  );

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1
  ) {
    throw new TypeError(
      "maxSteps must be an integer greater than or equal to 1",
    );
  }

  if (!Array.isArray(fallbackRules)) {
    throw new TypeError(
      "fallbackRules must be an array",
    );
  }

  const required =
    uniqueActionIds(requiredActions);

  const allowed =
    uniqueActionIds(allowedActions);

  const optional =
    uniqueActionIds(optionalActions);

  return Object.freeze({
    contractVersion: ACTION_POLICY_CONTRACT_VERSION,

    requiredActions: Object.freeze(required),

    allowedActions: Object.freeze(allowed),

    optionalActions: Object.freeze(optional),

    maxSteps,

    fallbackRules: Object.freeze([
      ...fallbackRules,
    ]),

    metadata: Object.freeze({
      ...metadata,
    }),
  });
}