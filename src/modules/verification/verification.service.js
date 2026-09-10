import {
  getVerificationStrategy,
} from "./verification.registry.js";

import {
  VERIFICATION_CHECK_STATUS,
  createVerificationCheck,
  createVerificationResult,
} from "./verification.types.js";

export async function verify({
  checkIds = [],
  input,
  context = {},
  signal = null,
} = {}) {
  if (!Array.isArray(checkIds)) {
    throw new TypeError(
      "checkIds must be an array",
    );
  }

  if (checkIds.length === 0) {
    return createVerificationResult({
      verified: false,

      checks: {},

      issues: [
        "No verification checks were requested",
      ],

      metadata: {
        checkCount: 0,
      },
    });
  }

  const checks = {};
  const issues = [];

  for (const checkId of checkIds) {
    const strategy =
      getVerificationStrategy(checkId);

    if (!strategy) {
      throw new Error(
        `No verification strategy registered: ${checkId}`,
      );
    }

    const result =
      await strategy.verify({
        input,
        context,
        signal,
      });

    const check =
      createVerificationCheck({
        status:
          result?.status ??
          VERIFICATION_CHECK_STATUS.NOT_RUN,

        issues:
          result?.issues ?? [],

        metadata:
          result?.metadata ?? {},
      });

    checks[checkId] = check;

    issues.push(...check.issues);
  }

  const verified =
    Object.values(checks).every(
      (check) =>
        check.status ===
        VERIFICATION_CHECK_STATUS.PASSED,
    );

  return createVerificationResult({
    verified,
    checks,
    issues,

    metadata: {
      checkCount:
        Object.keys(checks).length,
    },
  });
}