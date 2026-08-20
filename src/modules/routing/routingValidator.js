import {
  ROUTING_DECISION_TYPE,
} from "./routing.types.js";

import {
  getAvailableActions,
} from "../actions/index.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function getAvailableActionIds() {
  return new Set(
    getAvailableActions()
      .map(
        (action) =>
          action.id
            .trim()
            .toLowerCase()
      )
  );
}


function validateActionIds(
  actionIds,
  fieldName
) {
  const errors = [];


  if (!Array.isArray(actionIds)) {
    return [
      `${fieldName} must be an array.`,
    ];
  }


  const availableActionIds =
    getAvailableActionIds();


  for (const actionId of actionIds) {
    if (!isNonEmptyString(actionId)) {
      errors.push(
        `${fieldName} must contain only non-empty action ids.`
      );

      continue;
    }


    const normalisedActionId =
      actionId
        .trim()
        .toLowerCase();


    if (
      !availableActionIds.has(
        normalisedActionId
      )
    ) {
      errors.push(
        `Action "${actionId}" in ${fieldName} is not currently available.`
      );
    }
  }


  return errors;
}


export function validateRoutingDecision(
  decision
) {
  const errors = [];


  if (
    !decision ||
    typeof decision !== "object" ||
    Array.isArray(decision)
  ) {
    return {
      valid: false,

      errors: [
        "Routing decision must be an object.",
      ],
    };
  }


  const validTypes =
    Object.values(
      ROUTING_DECISION_TYPE
    );


  if (
    !validTypes.includes(
      decision.type
    )
  ) {
    errors.push(
      `Routing decision type must be one of: ${validTypes.join(
        ", "
      )}.`
    );
  }


  errors.push(
    ...validateActionIds(
      decision.selectedActions,
      "selectedActions"
    )
  );


  errors.push(
    ...validateActionIds(
      decision.alternativeActions,
      "alternativeActions"
    )
  );


  if (
    typeof decision.confidence !==
      "number" ||
    !Number.isFinite(
      decision.confidence
    ) ||
    decision.confidence < 0 ||
    decision.confidence > 1
  ) {
    errors.push(
      "Routing confidence must be a number between 0 and 1."
    );
  }


  if (
    !isNonEmptyString(
      decision.rationale
    )
  ) {
    errors.push(
      "Routing rationale must be a non-empty string."
    );
  }


  if (
    decision.type ===
      ROUTING_DECISION_TYPE.ACTIONS &&
    (
      !Array.isArray(
        decision.selectedActions
      ) ||
      decision.selectedActions
        .length === 0
    )
  ) {
    errors.push(
      "An actions routing decision must select at least one action."
    );
  }


  if (
    decision.type ===
    ROUTING_DECISION_TYPE.CLARIFICATION
  ) {
    if (
      !isNonEmptyString(
        decision.clarificationQuestion
      )
    ) {
      errors.push(
        "A clarification routing decision requires a clarificationQuestion."
      );
    }
  }


  if (
    decision.type ===
      ROUTING_DECISION_TYPE.NO_ACTION &&
    Array.isArray(
      decision.selectedActions
    ) &&
    decision.selectedActions.length > 0
  ) {
    errors.push(
      "A no_action routing decision cannot contain selected actions."
    );
  }


  return {
    valid:
      errors.length === 0,

    errors,
  };
}


export function assertValidRoutingDecision(
  decision
) {
  const validation =
    validateRoutingDecision(
      decision
    );


  if (!validation.valid) {
    throw new TypeError(
      `Invalid routing decision: ${validation.errors.join(
        " "
      )}`
    );
  }


  return decision;
}