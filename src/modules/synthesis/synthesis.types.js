export const SYNTHESIS_CONTRACT_VERSION = 1;

export const SYNTHESIS_MODES = Object.freeze({
  NONE: "none",
  DOCUMENTS: "documents",
  STATISTICS: "statistics",
  HYBRID: "hybrid",
});

export function createSynthesisResult({
  answered = false,
  mode = SYNTHESIS_MODES.NONE,
  answer = null,
  citations = [],
  data = null,
  metadata = {},
} = {}) {
  if (!Object.values(SYNTHESIS_MODES).includes(mode)) {
    throw new Error(`Unsupported synthesis mode: ${mode}`);
  }

  if (!Array.isArray(citations)) {
    throw new TypeError("citations must be an array");
  }

  if (
    answer !== null &&
    (typeof answer !== "string" || !answer.trim())
  ) {
    throw new TypeError(
      "answer must be null or a non-empty string",
    );
  }

  return Object.freeze({
    contractVersion: SYNTHESIS_CONTRACT_VERSION,

    answered: Boolean(answered),

    mode,

    answer:
      typeof answer === "string"
        ? answer.trim()
        : null,

    citations: Object.freeze([...citations]),

    data,

    metadata: Object.freeze({
      ...metadata,
    }),
  });
}