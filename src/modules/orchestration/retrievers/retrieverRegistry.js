const retrieverRegistry =
  new Map();

/**
 * Register a retriever for a module.
 *
 * @param {Object} options
 * @param {string} options.moduleId
 * @param {Function} options.retriever
 */
export function registerRetriever({
  moduleId,
  retriever,
} = {}) {
  if (
    typeof moduleId !== "string" ||
    moduleId.trim().length === 0
  ) {
    throw new TypeError(
      "Retriever module ID must be a non-empty string."
    );
  }

  if (typeof retriever !== "function") {
    throw new TypeError(
      "Retriever must be a function."
    );
  }

  retrieverRegistry.set(
    moduleId.trim().toLowerCase(),
    retriever
  );
}

/**
 * Get a retriever registered for a module.
 *
 * @param {string} moduleId
 *
 * @returns {Function|null}
 */
export function getRetrieverByModuleId(
  moduleId
) {
  if (
    typeof moduleId !== "string" ||
    moduleId.trim().length === 0
  ) {
    return null;
  }

  return (
    retrieverRegistry.get(
      moduleId.trim().toLowerCase()
    ) || null
  );
}