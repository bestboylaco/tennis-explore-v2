export const RESPONSE_CONTRACT_VERSION = 1;

export function createIntelligenceResponse({
  answered = false,
  answer = null,
  intent = null,
  actions = [],
  citations = [],
  data = null,
  verification = null,
  telemetry = {},
  metadata = {},
} = {}) {
  if (
    answer !== null &&
    (typeof answer !== "string" || !answer.trim())
  ) {
    throw new TypeError(
      "answer must be null or a non-empty string",
    );
  }

  if (
    intent !== null &&
    (typeof intent !== "string" || !intent.trim())
  ) {
    throw new TypeError(
      "intent must be null or a non-empty string",
    );
  }

  if (!Array.isArray(actions)) {
    throw new TypeError(
      "actions must be an array",
    );
  }

  if (!Array.isArray(citations)) {
    throw new TypeError(
      "citations must be an array",
    );
  }

  return Object.freeze({
    contractVersion:
      RESPONSE_CONTRACT_VERSION,

    answered: Boolean(answered),

    answer:
      typeof answer === "string"
        ? answer.trim()
        : null,

    intent:
      typeof intent === "string"
        ? intent.trim()
        : null,

    actions: Object.freeze([
      ...actions,
    ]),

    citations: Object.freeze([
      ...citations,
    ]),

    data,

    verification,

    telemetry: Object.freeze({
      ...telemetry,
    }),

    metadata: Object.freeze({
      ...metadata,
    }),
  });
}