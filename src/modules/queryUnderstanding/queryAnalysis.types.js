export const QUERY_ANALYSIS_CONTRACT_VERSION = 1;

export function createQueryAnalysis({
  intent = null,
  entities = [],
  requiredCapabilities = [],
  confidence = null,
  metadata = {},
} = {}) {
  if (
    intent !== null &&
    (typeof intent !== "string" || !intent.trim())
  ) {
    throw new TypeError(
      "intent must be null or a non-empty string",
    );
  }

  if (!Array.isArray(entities)) {
    throw new TypeError("entities must be an array");
  }

  if (!Array.isArray(requiredCapabilities)) {
    throw new TypeError(
      "requiredCapabilities must be an array",
    );
  }

  if (
    confidence !== null &&
    (
      typeof confidence !== "number" ||
      confidence < 0 ||
      confidence > 1
    )
  ) {
    throw new TypeError(
      "confidence must be null or a number between 0 and 1",
    );
  }

  return Object.freeze({
    contractVersion: QUERY_ANALYSIS_CONTRACT_VERSION,

    intent:
      typeof intent === "string"
        ? intent.trim()
        : null,

    entities: Object.freeze([...entities]),

    requiredCapabilities: Object.freeze([
      ...requiredCapabilities,
    ]),

    confidence,

    metadata: Object.freeze({
      ...metadata,
    }),
  });
}