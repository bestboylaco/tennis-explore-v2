import {
  STATISTICS_OPERATION,
  SORT_DIRECTION,
  FILTER_OPERATOR,
} from "./statistics.types.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function validateDataset(
  dataset
) {
  const errors = [];

  if (!isNonEmptyString(dataset)) {
    errors.push(
      "Statistics dataset must be a non-empty string."
    );

    return errors;
  }

  if (
    !/^[a-zA-Z0-9_-]+$/.test(
      dataset
    )
  ) {
    errors.push(
      "Statistics dataset may only contain letters, numbers, underscores, and hyphens."
    );
  }

  return errors;
}


function validateOperation(
  operation
) {
  const errors = [];

  const validOperations =
    Object.values(
      STATISTICS_OPERATION
    );

  if (
    !validOperations.includes(
      operation
    )
  ) {
    errors.push(
      `Statistics operation must be one of: ${validOperations.join(", ")}.`
    );
  }

  return errors;
}


function validateMetric({
  operation,
  metric,
}) {
  const errors = [];

  const operationsRequiringMetric = [
    STATISTICS_OPERATION.MAX,
    STATISTICS_OPERATION.MIN,
    STATISTICS_OPERATION.AVERAGE,
    STATISTICS_OPERATION.SUM,
  ];

  if (
    operationsRequiringMetric.includes(
      operation
    ) &&
    !isNonEmptyString(metric)
  ) {
    errors.push(
      `Statistics operation "${operation}" requires a metric.`
    );
  }

  if (
    metric !== null &&
    metric !== undefined &&
    !isNonEmptyString(metric)
  ) {
    errors.push(
      "Statistics metric must be a non-empty string when provided."
    );
  }

  return errors;
}


function validateFilters(
  filters
) {
  const errors = [];

  if (!Array.isArray(filters)) {
    errors.push(
      "Statistics filters must be an array."
    );

    return errors;
  }

  const validOperators =
    Object.values(
      FILTER_OPERATOR
    );

  filters.forEach(
    (filter, index) => {
      if (
        !filter ||
        typeof filter !== "object" ||
        Array.isArray(filter)
      ) {
        errors.push(
          `Filter at index ${index} must be an object.`
        );

        return;
      }


      if (
        !isNonEmptyString(
          filter.field
        )
      ) {
        errors.push(
          `Filter at index ${index} requires a non-empty field.`
        );
      }


      if (
        !validOperators.includes(
          filter.operator
        )
      ) {
        errors.push(
          `Filter at index ${index} has an invalid operator. Allowed operators: ${validOperators.join(", ")}.`
        );
      }


      if (
        filter.value === undefined
      ) {
        errors.push(
          `Filter at index ${index} requires a value.`
        );
      }


      if (
        filter.operator ===
          FILTER_OPERATOR.IN &&
        !Array.isArray(
          filter.value
        )
      ) {
        errors.push(
          `Filter at index ${index} using "in" requires an array value.`
        );
      }


      if (
        filter.operator ===
          FILTER_OPERATOR.BETWEEN
      ) {
        if (
          !Array.isArray(
            filter.value
          ) ||
          filter.value.length !== 2
        ) {
          errors.push(
            `Filter at index ${index} using "between" requires exactly two values.`
          );
        }
      }
    }
  );

  return errors;
}


function validateFields(
  fields
) {
  const errors = [];

  if (!Array.isArray(fields)) {
    errors.push(
      "Statistics fields must be an array."
    );

    return errors;
  }

  fields.forEach(
    (field, index) => {
      if (!isNonEmptyString(field)) {
        errors.push(
          `Statistics field at index ${index} must be a non-empty string.`
        );
      }
    }
  );

  return errors;
}


function validateOptionalField({
  value,
  fieldName,
}) {
  const errors = [];

  if (
    value !== null &&
    value !== undefined &&
    !isNonEmptyString(value)
  ) {
    errors.push(
      `${fieldName} must be a non-empty string when provided.`
    );
  }

  return errors;
}


function validateSort({
  sortBy,
  sortDirection,
}) {
  const errors = [];

  if (
    sortBy !== null &&
    sortBy !== undefined &&
    !isNonEmptyString(sortBy)
  ) {
    errors.push(
      "sortBy must be a non-empty string when provided."
    );
  }


  if (
    sortDirection !== null &&
    sortDirection !== undefined
  ) {
    const validDirections =
      Object.values(
        SORT_DIRECTION
      );

    if (
      !validDirections.includes(
        sortDirection
      )
    ) {
      errors.push(
        `sortDirection must be one of: ${validDirections.join(", ")}.`
      );
    }

    if (!isNonEmptyString(sortBy)) {
      errors.push(
        "sortDirection cannot be provided without sortBy."
      );
    }
  }

  return errors;
}


function validateLimit(
  limit
) {
  const errors = [];

  if (
    limit !== null &&
    limit !== undefined &&
    (
      !Number.isInteger(limit) ||
      limit <= 0
    )
  ) {
    errors.push(
      "Statistics limit must be a positive integer when provided."
    );
  }

  return errors;
}


export function validateStatisticsQuery(
  query
) {
  const errors = [];

  if (
    !query ||
    typeof query !== "object" ||
    Array.isArray(query)
  ) {
    return {
      isValid: false,

      errors: [
        "Statistics query must be an object.",
      ],
    };
  }


  errors.push(
    ...validateDataset(
      query.dataset
    )
  );


  errors.push(
    ...validateOperation(
      query.operation
    )
  );


  errors.push(
    ...validateMetric({
      operation:
        query.operation,

      metric:
        query.metric,
    })
  );


  errors.push(
    ...validateFilters(
      query.filters
    )
  );


  errors.push(
    ...validateFields(
      query.fields
    )
  );


  errors.push(
    ...validateOptionalField({
      value:
        query.groupBy,

      fieldName:
        "groupBy",
    })
  );


  errors.push(
    ...validateSort({
      sortBy:
        query.sortBy,

      sortDirection:
        query.sortDirection,
    })
  );


  errors.push(
    ...validateLimit(
      query.limit
    )
  );


  return {
    isValid:
      errors.length === 0,

    errors,
  };
}


export function assertValidStatisticsQuery(
  query
) {
  const result =
    validateStatisticsQuery(
      query
    );

  if (!result.isValid) {
    throw new TypeError(
      [
        "Invalid statistics query:",
        ...result.errors,
      ].join("\n")
    );
  }

  return query;
}