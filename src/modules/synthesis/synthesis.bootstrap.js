import {
  SYNTHESIS_MODES,
} from "./synthesis.types.js";

import {
  registerSynthesisStrategy,
  hasSynthesisStrategy,
} from "./synthesis.registry.js";

import {
  statisticsSynthesisStrategy,
} from "./strategies/statisticsSynthesis.strategy.js";

export function bootstrapSynthesis() {
  if (
    !hasSynthesisStrategy(
      SYNTHESIS_MODES.STATISTICS,
    )
  ) {
    registerSynthesisStrategy({
      mode:
        SYNTHESIS_MODES.STATISTICS,

      strategy:
        statisticsSynthesisStrategy,
    });
  }

  return true;
}