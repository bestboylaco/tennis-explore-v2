const providerRegistry =
  new Map();


function normaliseDatasetId(
  datasetId
) {
  if (
    typeof datasetId !== "string"
  ) {
    return "";
  }

  return datasetId
    .trim()
    .toLowerCase();
}


function validateProvider(
  provider
) {
  if (
    !provider ||
    typeof provider !== "object"
  ) {
    throw new TypeError(
      "Statistics provider must be an object."
    );
  }

  if (
    typeof provider.datasetId !==
      "string" ||
    !provider.datasetId.trim()
  ) {
    throw new TypeError(
      "Statistics provider requires a datasetId."
    );
  }

  if (
    typeof provider.execute !==
    "function"
  ) {
    throw new TypeError(
      "Statistics provider requires an execute function."
    );
  }

  return provider;
}


export function registerStatisticsProvider(
  provider,
  {
    replace = false,
  } = {}
) {
  validateProvider(
    provider
  );

  const datasetId =
    normaliseDatasetId(
      provider.datasetId
    );

  if (
    providerRegistry.has(
      datasetId
    ) &&
    !replace
  ) {
    throw new Error(
      `Statistics provider for dataset "${datasetId}" is already registered.`
    );
  }

  providerRegistry.set(
    datasetId,
    provider
  );

  return provider;
}


export function getStatisticsProvider(
  datasetId
) {
  const normalisedId =
    normaliseDatasetId(
      datasetId
    );

  if (!normalisedId) {
    return null;
  }

  return (
    providerRegistry.get(
      normalisedId
    ) || null
  );
}


export function hasStatisticsProvider(
  datasetId
) {
  const normalisedId =
    normaliseDatasetId(
      datasetId
    );

  if (!normalisedId) {
    return false;
  }

  return providerRegistry.has(
    normalisedId
  );
}


export function getAvailableDatasets() {
  return Array.from(
    providerRegistry.values()
  ).map(
    (provider) => ({
      datasetId:
        provider.datasetId,

      name:
        provider.name ||
        provider.datasetId,

      description:
        provider.description || "",

      fields:
        Array.isArray(
          provider.fields
        )
          ? [...provider.fields]
          : [],
    })
  );
}


export function unregisterStatisticsProvider(
  datasetId
) {
  const normalisedId =
    normaliseDatasetId(
      datasetId
    );

  if (!normalisedId) {
    return false;
  }

  return providerRegistry.delete(
    normalisedId
  );
}


export function clearStatisticsProviderRegistry() {
  providerRegistry.clear();
}