import {
  FILTER_OPERATOR,
  SORT_DIRECTION,
  STATISTICS_OPERATION,
} from "../statistics.types.js";


function getFieldValue(
  record,
  field
) {
  return record?.[field];
}


function applyFilter(
  record,
  filter
) {
  const actualValue =
    getFieldValue(
      record,
      filter.field
    );

  const expectedValue =
    filter.value;


  switch (filter.operator) {
    case FILTER_OPERATOR.EQ:
      return (
        actualValue ===
        expectedValue
      );


    case FILTER_OPERATOR.NEQ:
      return (
        actualValue !==
        expectedValue
      );


    case FILTER_OPERATOR.GT:
      return (
        actualValue >
        expectedValue
      );


    case FILTER_OPERATOR.GTE:
      return (
        actualValue >=
        expectedValue
      );


    case FILTER_OPERATOR.LT:
      return (
        actualValue <
        expectedValue
      );


    case FILTER_OPERATOR.LTE:
      return (
        actualValue <=
        expectedValue
      );


    case FILTER_OPERATOR.IN:
      return (
        Array.isArray(
          expectedValue
        ) &&
        expectedValue.includes(
          actualValue
        )
      );


    case FILTER_OPERATOR.CONTAINS:
      if (
        typeof actualValue ===
        "string"
      ) {
        return actualValue
          .toLowerCase()
          .includes(
            String(
              expectedValue
            ).toLowerCase()
          );
      }

      if (
        Array.isArray(
          actualValue
        )
      ) {
        return actualValue.includes(
          expectedValue
        );
      }

      return false;


    case FILTER_OPERATOR.BETWEEN:
      if (
        !Array.isArray(
          expectedValue
        ) ||
        expectedValue.length !== 2
      ) {
        return false;
      }

      return (
        actualValue >=
          expectedValue[0] &&
        actualValue <=
          expectedValue[1]
      );


    default:
      return false;
  }
}


function applyFilters(
  records,
  filters
) {
  if (
    !Array.isArray(filters) ||
    filters.length === 0
  ) {
    return [...records];
  }

  return records.filter(
    (record) =>
      filters.every(
        (filter) =>
          applyFilter(
            record,
            filter
          )
      )
  );
}


function applySorting(
  records,
  sortBy,
  sortDirection
) {
  if (!sortBy) {
    return [...records];
  }

  const direction =
    sortDirection ===
    SORT_DIRECTION.DESC
      ? -1
      : 1;


  return [...records].sort(
    (left, right) => {
      const leftValue =
        getFieldValue(
          left,
          sortBy
        );

      const rightValue =
        getFieldValue(
          right,
          sortBy
        );


      if (
        leftValue ===
        rightValue
      ) {
        return 0;
      }


      if (
        leftValue === null ||
        leftValue === undefined
      ) {
        return 1;
      }


      if (
        rightValue === null ||
        rightValue === undefined
      ) {
        return -1;
      }


      return (
        leftValue >
        rightValue
          ? direction
          : -direction
      );
    }
  );
}


function applyLimit(
  records,
  limit
) {
  if (
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    return [...records];
  }

  return records.slice(
    0,
    limit
  );
}


function projectRecord(
  record,
  fields
) {
  if (
    !Array.isArray(fields) ||
    fields.length === 0
  ) {
    return {
      ...record,
    };
  }


  return fields.reduce(
    (
      projected,
      field
    ) => {
      projected[field] =
        getFieldValue(
          record,
          field
        );

      return projected;
    },
    {}
  );
}


function projectRecords(
  records,
  fields
) {
  return records.map(
    (record) =>
      projectRecord(
        record,
        fields
      )
  );
}


function getNumericValues(
  records,
  metric
) {
  return records
    .map(
      (record) =>
        Number(
          getFieldValue(
            record,
            metric
          )
        )
    )
    .filter(
      (value) =>
        Number.isFinite(
          value
        )
    );
}


function executeMaximum({
  records,
  metric,
  fields,
}) {
  const candidates =
    records.filter(
      (record) =>
        Number.isFinite(
          Number(
            getFieldValue(
              record,
              metric
            )
          )
        )
    );


  if (
    candidates.length === 0
  ) {
    return {
      records: [],
      value: null,
    };
  }


  const winningRecord =
    candidates.reduce(
      (
        currentMaximum,
        record
      ) => {
        const currentValue =
          Number(
            getFieldValue(
              currentMaximum,
              metric
            )
          );

        const candidateValue =
          Number(
            getFieldValue(
              record,
              metric
            )
          );

        return (
          candidateValue >
          currentValue
            ? record
            : currentMaximum
        );
      }
    );


  return {
    records: [
      projectRecord(
        winningRecord,
        fields
      ),
    ],

    value:
      Number(
        getFieldValue(
          winningRecord,
          metric
        )
      ),
  };
}


function executeMinimum({
  records,
  metric,
  fields,
}) {
  const candidates =
    records.filter(
      (record) =>
        Number.isFinite(
          Number(
            getFieldValue(
              record,
              metric
            )
          )
        )
    );


  if (
    candidates.length === 0
  ) {
    return {
      records: [],
      value: null,
    };
  }


  const winningRecord =
    candidates.reduce(
      (
        currentMinimum,
        record
      ) => {
        const currentValue =
          Number(
            getFieldValue(
              currentMinimum,
              metric
            )
          );

        const candidateValue =
          Number(
            getFieldValue(
              record,
              metric
            )
          );

        return (
          candidateValue <
          currentValue
            ? record
            : currentMinimum
        );
      }
    );


  return {
    records: [
      projectRecord(
        winningRecord,
        fields
      ),
    ],

    value:
      Number(
        getFieldValue(
          winningRecord,
          metric
        )
      ),
  };
}


function executeAverage({
  records,
  metric,
}) {
  const values =
    getNumericValues(
      records,
      metric
    );


  if (
    values.length === 0
  ) {
    return {
      records: [],
      value: null,
    };
  }


  const total =
    values.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    );


  return {
    records: [],
    value:
      total /
      values.length,
  };
}


function executeSum({
  records,
  metric,
}) {
  const values =
    getNumericValues(
      records,
      metric
    );


  if (
    values.length === 0
  ) {
    return {
      records: [],
      value: null,
    };
  }


  return {
    records: [],

    value:
      values.reduce(
        (
          sum,
          value
        ) =>
          sum + value,
        0
      ),
  };
}


function executeCount(
  records
) {
  return {
    records: [],
    value:
      records.length,
  };
}


function executeRecordQuery({
  records,
  fields,
  sortBy,
  sortDirection,
  limit,
}) {
  const sorted =
    applySorting(
      records,
      sortBy,
      sortDirection
    );


  const limited =
    applyLimit(
      sorted,
      limit
    );


  return {
    records:
      projectRecords(
        limited,
        fields
      ),

    value: null,
  };
}


export function createInMemoryStatisticsProvider({
  datasetId,
  name,
  description = "",
  fields = [],
  records = [],
} = {}) {
  if (
    typeof datasetId !==
      "string" ||
    !datasetId.trim()
  ) {
    throw new TypeError(
      "In-memory statistics provider requires a datasetId."
    );
  }


  if (!Array.isArray(records)) {
    throw new TypeError(
      "In-memory statistics provider records must be an array."
    );
  }


  const storedRecords =
    records.map(
      (record) => ({
        ...record,
      })
    );


  return Object.freeze({
    datasetId:
      datasetId.trim(),

    name:
      (
        typeof name === "string" &&
        name.trim()
      )
        ? name.trim()
        : datasetId.trim(),

    description,

    fields:
      Object.freeze([
        ...fields,
      ]),


    async execute(
      query
    ) {
      const filteredRecords =
        applyFilters(
          storedRecords,
          query.filters
        );


      let result;


      switch (
        query.operation
      ) {
        case STATISTICS_OPERATION.MAX:
          result =
            executeMaximum({
              records:
                filteredRecords,

              metric:
                query.metric,

              fields:
                query.fields,
            });
          break;


        case STATISTICS_OPERATION.MIN:
          result =
            executeMinimum({
              records:
                filteredRecords,

              metric:
                query.metric,

              fields:
                query.fields,
            });
          break;


        case STATISTICS_OPERATION.AVERAGE:
          result =
            executeAverage({
              records:
                filteredRecords,

              metric:
                query.metric,
            });
          break;


        case STATISTICS_OPERATION.SUM:
          result =
            executeSum({
              records:
                filteredRecords,

              metric:
                query.metric,
            });
          break;


        case STATISTICS_OPERATION.COUNT:
          result =
            executeCount(
              filteredRecords
            );
          break;


        case STATISTICS_OPERATION.LOOKUP:
        case STATISTICS_OPERATION.FILTER:
        case STATISTICS_OPERATION.SORT:
        case STATISTICS_OPERATION.COMPARE:
          result =
            executeRecordQuery({
              records:
                filteredRecords,

              fields:
                query.fields,

              sortBy:
                query.sortBy,

              sortDirection:
                query.sortDirection,

              limit:
                query.limit,
            });
          break;


        default:
          throw new Error(
            `Unsupported statistics operation "${query.operation}".`
          );
      }


      return {
        records:
          result.records,

        value:
          result.value,

        metadata: {
          datasetId:
            datasetId.trim(),

          totalRecords:
            storedRecords.length,

          matchedRecords:
            filteredRecords.length,

          operation:
            query.operation,
        },
      };
    },
  });
}