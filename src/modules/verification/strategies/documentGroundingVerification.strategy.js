import {
  shouldBlockAnswer,
  verifyAnswer,
} from "../../generation/verifier.service.js";

import {
  VERIFICATION_CHECK_STATUS,
} from "../verification.types.js";


export const documentGroundingVerificationStrategy =
  Object.freeze({
    id:
      "document_grounding",


    async verify({
      input,
    } = {}) {
      if (
        !input ||
        typeof input !== "object"
      ) {
        throw new TypeError(
          "Document grounding verification requires an input",
        );
      }


      const answer =
        input.answer;

      const evidence =
        input.evidence;


      /*
       * Verification cannot succeed without an
       * actual generated answer.
       */
      if (
        typeof answer !== "string" ||
        !answer.trim()
      ) {
        return {
          status:
            VERIFICATION_CHECK_STATUS.FAILED,

          issues: [
            "Document grounding verification requires a non-empty answer",
          ],

          metadata: {
            grounded:
              false,

            citedFraction:
              0,

            claimCount:
              0,

            citations:
              [],

            danglingCitations:
              [],

            unusedEvidence:
              [],

            unsupportedNumbers:
              [],

            warnings:
              [],

            legacyShouldBlock:
              false,
          },
        };
      }


      /*
       * The evidence here must be the exact prepared
       * evidence used during synthesis.
       *
       * This is intentionally NOT raw retrieval
       * evidence.
       */
      if (
        !Array.isArray(evidence) ||
        evidence.length === 0
      ) {
        return {
          status:
            VERIFICATION_CHECK_STATUS.FAILED,

          issues: [
            "Document grounding verification requires prepared document evidence",
          ],

          metadata: {
            grounded:
              false,

            citedFraction:
              0,

            claimCount:
              0,

            citations:
              [],

            danglingCitations:
              [],

            unusedEvidence:
              [],

            unsupportedNumbers:
              [],

            warnings:
              [],

            legacyShouldBlock:
              false,
          },
        };
      }


      /*
       * Reuse TennisExplore's existing deterministic
       * document verifier.
       *
       * It checks:
       *
       * - citation markers
       * - dangling citations
       * - unsupported numbers
       * - uncited factual claims
       * - citation/entity mismatches
       * - completely ungrounded answers
       *
       * No second LLM is used.
       */
      const report =
        verifyAnswer(
          answer,
          evidence,
        );


      /*
       * In the new Verification contract,
       * "passed" means that the answer is grounded
       * according to the verifier.
       *
       * This is deliberately stronger than the old
       * shouldBlockAnswer() behaviour.
       */
      const passed =
        report.grounded ===
        true;


      /*
       * Preserve the old release policy as metadata.
       *
       * We do NOT use it to decide this new strategy's
       * passed/failed status.
       *
       * This gives us migration visibility without
       * changing the legacy production route.
       */
      const legacyShouldBlock =
        shouldBlockAnswer(
          report,
        );


      /*
       * Only high-severity warnings make the new
       * grounding verification fail.
       *
       * Medium warnings are still preserved in
       * metadata for telemetry and evaluation.
       */
      const highSeverityWarnings =
        Array.isArray(
          report.warnings
        )
          ? report.warnings.filter(
              (warning) =>
                warning?.severity ===
                "high"
            )
          : [];


      const issues =
        passed
          ? []
          : highSeverityWarnings.length > 0
            ? highSeverityWarnings.map(
                (warning) =>
                  `${warning.kind}: ${warning.detail}`
              )
            : [
                "Document answer failed grounding verification",
              ];


      return {
        status:
          passed
            ? VERIFICATION_CHECK_STATUS.PASSED
            : VERIFICATION_CHECK_STATUS.FAILED,

        issues,

        metadata: {
          grounded:
            report.grounded,

          citedFraction:
            report.citedFraction,

          claimCount:
            report.claimCount,

          uncitedClaims:
            report.uncitedClaims,

          /*
           * These are the real citations produced by
           * bindCitations().
           *
           * Synthesis deliberately did not bind them.
           */
          citations:
            report.citations,

          danglingCitations:
            report.danglingCitations,

          unusedEvidence:
            report.unusedEvidence,

          unsupportedNumbers:
            report.unsupportedNumbers,

          warnings:
            report.warnings,

          legacyShouldBlock,
        },
      };
    },
  });