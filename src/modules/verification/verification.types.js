export const VERIFICATION_CONTRACT_VERSION = 1;

export const VERIFICATION_CHECK_STATUS = Object.freeze({
  NOT_RUN: "not_run",
  PASSED: "passed",
  FAILED: "failed",
});

export function createVerificationCheck({
  status = VERIFICATION_CHECK_STATUS.NOT_RUN,
  issues = [],
  metadata = {},
} = {}) {
  if (
    !Object.values(VERIFICATION_CHECK_STATUS).includes(status)
  ) {
    throw new Error(
      `Unsupported verification check status: ${status}`,
    );
  }

  if (!Array.isArray(issues)) {
    throw new TypeError("issues must be an array");
  }

  return Object.freeze({
    status,

    issues: Object.freeze([...issues]),

    metadata: Object.freeze({
      ...metadata,
    }),
  });
}

export function createVerificationResult({
  verified = false,
  checks = {},
  issues = [],
  metadata = {},
} = {}) {
  if (!checks || typeof checks !== "object") {
    throw new TypeError("checks must be an object");
  }

  if (!Array.isArray(issues)) {
    throw new TypeError("issues must be an array");
  }

  return Object.freeze({
    contractVersion: VERIFICATION_CONTRACT_VERSION,

    verified: Boolean(verified),

    checks: Object.freeze({
      ...checks,
    }),

    issues: Object.freeze([...issues]),

    metadata: Object.freeze({
      ...metadata,
    }),
  });
}