export const AGENT_OBSERVATION_CONTRACT_VERSION = 1;

export function createAgentObservation({
  actionId,
  status,
  data = null,
  evidence = [],
  metadata = {},
  error = null,
} = {}) {
  if (
    typeof actionId !== "string" ||
    !actionId.trim()
  ) {
    throw new TypeError(
      "actionId must be a non-empty string",
    );
  }

  if (
    typeof status !== "string" ||
    !status.trim()
  ) {
    throw new TypeError(
      "status must be a non-empty string",
    );
  }

  if (!Array.isArray(evidence)) {
    throw new TypeError(
      "evidence must be an array",
    );
  }

  return Object.freeze({
    contractVersion:
      AGENT_OBSERVATION_CONTRACT_VERSION,

    actionId: actionId.trim(),

    status: status.trim(),

    data,

    evidence: Object.freeze([
      ...evidence,
    ]),

    metadata: Object.freeze({
      ...metadata,
    }),

    error,
  });
}