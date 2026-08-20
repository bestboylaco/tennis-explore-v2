export const ACTION_RESULT_STATUS =
  Object.freeze({
    SUCCESS: "success",
    NO_RESULT: "no_result",
    FAILED: "failed",
  });


export function createActionDefinition({
  id,
  name,
  description,
  capabilities = [],
  inputSchema = null,
  execute,
  isEnabled = true,
  isAvailable = null,
} = {}) {
  return Object.freeze({
    id,
    name,
    description,

    capabilities:
      Object.freeze([
        ...capabilities,
      ]),

    inputSchema,

    execute,

    isEnabled,

    isAvailable,
  });
}


export function createActionResult({
  actionId,
  status =
    ACTION_RESULT_STATUS.SUCCESS,
  data = null,
  evidence = [],
  metadata = {},
  error = null,
} = {}) {
  return Object.freeze({
    actionId,
    status,

    data,

    evidence:
      Object.freeze([
        ...evidence,
      ]),

    metadata:
      Object.freeze({
        ...metadata,
      }),

    error,
  });
}