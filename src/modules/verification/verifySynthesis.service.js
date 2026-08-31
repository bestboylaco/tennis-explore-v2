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
    typeof statisticsResult !==
      "object"
  ) {
    throw new TypeError(
      "Statistics verification requires an existing statistics result",
    );
  }


  return statisticsResult;
}


/*
 * Documents verification must use the exact evidence
 * that synthesis sent to the model.
 *
 * Do NOT use synthesisInput.documentEvidence here,
 * because that is the raw evidence before:
 *
 * - deduplication
 * - compression
 * - attention ordering
 * - context-length trimming
 * - citation numbering
 */
function requirePreparedDocumentEvidence(
  synthesisResult,
) {
  const evidence =
    synthesisResult
      ?.data
      ?.documents
      ?.evidence;


  if (
    !Array.isArray(evidence) ||
    evidence.length === 0
  ) {
    throw new TypeError(
      "Documents verification requires prepared synthesis evidence",
    );
  }


  return evidence;
}


export async function verifySynthesis({
  synthesisResult,
  synthesisInput,
  signal = null,
} = {}) {
  if (
    !synthesisResult ||
    typeof synthesisResult !==
      "object"
  ) {
    throw new TypeError(
      "verifySynthesis requires a synthesis result",
    );
  }


  if (
    !synthesisInput ||
    typeof synthesisInput !==
      "object"
  ) {
    throw new TypeError(
      "verifySynthesis requires a synthesis input",
    );
  }


  switch (
    synthesisResult.mode
  ) {
    /*
     * Statistics
     *
     * Verify the generated explanation against the
     * existing deterministic Statistics result.
     */
    case SYNTHESIS_MODES.STATISTICS: {
      const statisticsResult =
        requireStatisticsResult(
          synthesisInput,
        );


      return verify({
        checkIds: [
          VERIFICATION_STRATEGY_IDS
            .NUMERIC,
        ],

        input: {
          answer:
            synthesisResult.answer,

          statisticsResult,
        },

        signal,
      });
    }


    /*
     * Documents
     *
     * Verify the generated answer against the exact
     * prepared evidence that the generation model saw.
     */
    case SYNTHESIS_MODES.DOCUMENTS: {
      const evidence =
        requirePreparedDocumentEvidence(
          synthesisResult,
        );


      return verify({
        checkIds: [
          VERIFICATION_STRATEGY_IDS
            .DOCUMENT_GROUNDING,
        ],

        input: {
          answer:
            synthesisResult.answer,

          evidence,
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