import {
  registerVerificationStrategy,
  hasVerificationStrategy,
} from "./verification.registry.js";

import {
  numericVerificationStrategy,
} from "./strategies/numericVerification.strategy.js";

export const VERIFICATION_STRATEGY_IDS =
  Object.freeze({
    NUMERIC: "numeric",
  });

export function bootstrapVerification() {
  if (
    !hasVerificationStrategy(
      VERIFICATION_STRATEGY_IDS.NUMERIC,
    )
  ) {
    registerVerificationStrategy({
      id:
        VERIFICATION_STRATEGY_IDS.NUMERIC,

      strategy:
        numericVerificationStrategy,
    });
  }

  return true;
}