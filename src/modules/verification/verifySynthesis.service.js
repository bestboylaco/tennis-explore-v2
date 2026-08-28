import {
  SYNTHESIS_MODES,
} from "../synthesis/synthesis.types.js";

import {
  VERIFICATION_STRATEGY_IDS,
} from "./verification.bootstrap.js";

import {
  verify,
} from "./verification.service.js";


function requireStatisticsResult(
  synthesisInput,
) {
  const statisticsResult =
    synthesisInput
      ?.statisticsResults
      ?.[0];

  if (
    !statisticsResult ||
    typeof statisticsResult !== "object"
  ) {
    throw new TypeError(
      "Statistics verification requires an existing statistics result",
    );
  }

  return statisticsResult;
}


export async function verifySynthesis({
  synthesisResult,
  synthesisInput,
  signal = null,
} = {}) {
  if (
    !synthesisResult ||
    typeof synthesisResult !== "object"
  ) {
    throw new TypeError(
      "verifySynthesis requires a synthesis result",
    );
  }

  if (
    !synthesisInput ||
    typeof synthesisInput !== "object"
  ) {
    throw new TypeError(
      "verifySynthesis requires a synthesis input",
    );
  }

  switch (synthesisResult.mode) {
    case SYNTHESIS_MODES.STATISTICS: {
      const statisticsResult =
        requireStatisticsResult(
          synthesisInput,
        );

      return verify({
        checkIds: [
          VERIFICATION_STRATEGY_IDS.NUMERIC,
        ],

        input: {
          answer:
            synthesisResult.answer,

          statisticsResult,
        },

        signal,
      });
    }

    default:
      throw new Error(
        `No verification profile configured for synthesis mode: ${synthesisResult.mode}`,
      );
  }
}