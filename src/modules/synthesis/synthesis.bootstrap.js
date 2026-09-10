import {
  hasSynthesisStrategy,
  registerSynthesisStrategy,
} from "./synthesis.registry.js";

import {
  statisticsSynthesisStrategy,
} from "./strategies/statisticsSynthesis.strategy.js";

import {
  documentsSynthesisStrategy,
} from "./strategies/documentsSynthesis.strategy.js";


/*
 * Registers all synthesis strategies available
 * to the TennisExplore Agent.
 *
 * This function is idempotent:
 * calling it multiple times will not register
 * duplicate strategies.
 */
export function bootstrapSynthesis() {
  /*
   * Statistics
   */
  if (
    !hasSynthesisStrategy(
      statisticsSynthesisStrategy.id
    )
  ) {
    registerSynthesisStrategy({
      mode:
        statisticsSynthesisStrategy.id,

      strategy:
        statisticsSynthesisStrategy,
    });
  }


  /*
   * Documents
   */
  if (
    !hasSynthesisStrategy(
      documentsSynthesisStrategy.id
    )
  ) {
    registerSynthesisStrategy({
      mode:
        documentsSynthesisStrategy.id,

      strategy:
        documentsSynthesisStrategy,
    });
  }
}