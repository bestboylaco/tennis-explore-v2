import {
  registerVerificationStrategy,
  hasVerificationStrategy,
} from "./verification.registry.js";

import {
  numericVerificationStrategy,
} from "./strategies/numericVerification.strategy.js";

import {
  documentGroundingVerificationStrategy,
} from "./strategies/documentGroundingVerification.strategy.js";


export const VERIFICATION_STRATEGY_IDS =
  Object.freeze({
    NUMERIC:
      "numeric",

    DOCUMENT_GROUNDING:
      "document_grounding",
  });


/*
 * Registers all deterministic verification
 * strategies available to the Agent.
 *
 * This bootstrap is idempotent.
 */
export function bootstrapVerification() {
  /*
   * Statistics numeric verification
   */
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


  /*
   * Documents citation + grounding verification
   */
  if (
    !hasVerificationStrategy(
      VERIFICATION_STRATEGY_IDS
        .DOCUMENT_GROUNDING,
    )
  ) {
    registerVerificationStrategy({
      id:
        VERIFICATION_STRATEGY_IDS
          .DOCUMENT_GROUNDING,

      strategy:
        documentGroundingVerificationStrategy,
    });
  }


  return true;
}