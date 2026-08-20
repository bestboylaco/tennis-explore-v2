import {
  createStatisticsQuery,
  createStatisticsResult,
} from "./statistics.types.js";

import {
  assertValidStatisticsQuery,
} from "./statisticsValidator.js";

import {
  getStatisticsProvider,
} from "./statisticsProviderRegistry.js";


function normaliseProviderResult(
  result
) {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result)
  ) {
    throw new TypeError(
      "Statistics provider must return an object."
    );
  }

  return {
    records:
      Array.isArray(result.records)
        ? result.records
        : [],

    value:
      result.value ?? null,

    metadata:
      (
        result.metadata &&
        typeof result.metadata === "object" &&
        !Array.isArray(result.metadata)
      )
        ? result.metadata
        : {},
  };
}


export async function executeStatisticsQuery(
  queryInput = {}
) {
  const query =
    createStatisticsQuery(
      queryInput
    );


  assertValidStatisticsQuery(
    query
  );


  const provider =
    getStatisticsProvider(
      query.dataset
    );


  if (!provider) {
    throw new Error(
      `No statistics provider is registered for dataset "${query.dataset}".`
    );
  }


  const rawResult =
    await provider.execute(
      query
    );


  const providerResult =
    normaliseProviderResult(
      rawResult
    );


  return createStatisticsResult({
    query,

    records:
      providerResult.records,

    value:
      providerResult.value,

    metadata: {
      ...providerResult.metadata,

      datasetId:
        provider.datasetId,

      providerName:
        provider.name ||
        provider.datasetId,
    },
  });
}