import {
  registerStatisticsProvider,
  hasStatisticsProvider,
  getAvailableDatasets,
} from "./statisticsProviderRegistry.js";


export function bootstrapStatisticsProviders({
  providers = [],
} = {}) {
  if (!Array.isArray(providers)) {
    throw new TypeError(
      "Statistics bootstrap providers must be an array."
    );
  }


  for (const provider of providers) {
    if (
      !provider ||
      typeof provider !== "object" ||
      Array.isArray(provider)
    ) {
      throw new TypeError(
        "Every statistics provider must be an object."
      );
    }


    if (
      typeof provider.datasetId !== "string" ||
      provider.datasetId.trim().length === 0
    ) {
      throw new TypeError(
        "Every statistics provider requires a datasetId."
      );
    }


    const datasetId =
      provider.datasetId
        .trim()
        .toLowerCase();


    // Avoid duplicate registration during
    // application startup or development reloads.
    if (
      hasStatisticsProvider(
        datasetId
      )
    ) {
      continue;
    }


    registerStatisticsProvider(
      provider
    );
  }


  return getAvailableDatasets();
}