export const STATISTICS_OPERATION =
  Object.freeze({
    LOOKUP: "lookup",
    FILTER: "filter",
    MAX: "max",
    MIN: "min",
    AVERAGE: "average",
    COUNT: "count",
    SUM: "sum",
    SORT: "sort",
    COMPARE: "compare",
  });


export const SORT_DIRECTION =
  Object.freeze({
    ASC: "asc",
    DESC: "desc",
  });


export const FILTER_OPERATOR =
  Object.freeze({
    EQ: "eq",
    NEQ: "neq",
    GT: "gt",
    GTE: "gte",
    LT: "lt",
    LTE: "lte",
    IN: "in",
    CONTAINS: "contains",
    BETWEEN: "between",
  });

export function createStatisticsQuery({
  dataset = null,
  operation = STATISTICS_OPERATION.LOOKUP,
  metric = null,
  filters = [],
  groupBy = null,
  sortBy = null,
  sortDirection = null,
  limit = null,
  fields = [],
} = {}) {
  return Object.freeze({
    dataset,

    operation,

    metric,

    filters:
      Object.freeze(
        Array.isArray(filters)
          ? [...filters]
          : []
      ),

    groupBy,

    sortBy,

    sortDirection,

    limit,

    fields:
      Object.freeze(
        Array.isArray(fields)
          ? [...fields]
          : []
      ),
  });
}


export function createStatisticsResult({
  query,
  records = [],
  value = null,
  metadata = {},
} = {}) {
  return Object.freeze({
    query,

    records:
      Object.freeze(
        Array.isArray(records)
          ? [...records]
          : []
      ),

    value,

    metadata:
      Object.freeze({
        ...metadata,
      }),
  });
}