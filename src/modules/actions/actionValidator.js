function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


export function validateActionDefinition(
  action
) {
  const errors = [];


  if (
    !action ||
    typeof action !== "object" ||
    Array.isArray(action)
  ) {
    return {
      valid: false,
      errors: [
        "Action definition must be an object.",
      ],
    };
  }


  if (!isNonEmptyString(action.id)) {
    errors.push(
      "Action id must be a non-empty string."
    );
  }


  if (!isNonEmptyString(action.name)) {
    errors.push(
      "Action name must be a non-empty string."
    );
  }


  if (
    !isNonEmptyString(
      action.description
    )
  ) {
    errors.push(
      "Action description must be a non-empty string."
    );
  }


  if (
    !Array.isArray(
      action.capabilities
    )
  ) {
    errors.push(
      "Action capabilities must be an array."
    );
  } else {
    const invalidCapability =
      action.capabilities.some(
        (capability) =>
          !isNonEmptyString(
            capability
          )
      );

    if (invalidCapability) {
      errors.push(
        "Every action capability must be a non-empty string."
      );
    }
  }


  if (
    typeof action.execute !==
    "function"
  ) {
    errors.push(
      "Action execute must be a function."
    );
  }


  if (
    typeof action.isEnabled !==
    "boolean"
  ) {
    errors.push(
      "Action isEnabled must be a boolean."
    );
  }


  if (
    action.isAvailable !== null &&
    action.isAvailable !== undefined &&
    typeof action.isAvailable !==
      "function"
  ) {
    errors.push(
      "Action isAvailable must be a function, null, or undefined."
    );
  }


  return {
    valid:
      errors.length === 0,

    errors,
  };
}


export function assertValidActionDefinition(
  action
) {
  const validation =
    validateActionDefinition(
      action
    );


  if (!validation.valid) {
    throw new TypeError(
      `Invalid action definition: ${validation.errors.join(
        " "
      )}`
    );
  }


  return action;
}