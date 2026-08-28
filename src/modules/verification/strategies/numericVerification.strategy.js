import {
  findUnsupportedNumbers,
} from "../../retrieval/citation.service.js";

import {
  VERIFICATION_CHECK_STATUS,
} from "../verification.types.js";

function buildStatisticsEvidence(
  statisticsResult,
) {
  return [
    {
      text: [
        JSON.stringify(
          statisticsResult.rows ?? [],
        ),

        `rowsScanned=${
          statisticsResult.rowsScanned ?? 0
        }`,

        `rowsMatched=${
          statisticsResult.rowsMatched ?? 0
        }`,

        `rowsReturned=${
          statisticsResult.rowsReturned ?? 0
        }`,
      ].join("\n"),
    },
  ];
}

export const numericVerificationStrategy =
  Object.freeze({
    id: "numeric",

    async verify({
      input,
    } = {}) {
      if (
        !input ||
        typeof input !== "object"
      ) {
        throw new TypeError(
          "Numeric verification requires an input",
        );
      }

      const answer =
        input.answer;

      const statisticsResult =
        input.statisticsResult;

      if (
        typeof answer !== "string" ||
        !answer.trim()
      ) {
        return {
          status:
            VERIFICATION_CHECK_STATUS.FAILED,

          issues: [
            "Numeric verification requires a non-empty answer",
          ],

          metadata: {
            unsupportedNumbers: [],
          },
        };
      }

      if (
        !statisticsResult ||
        typeof statisticsResult !== "object"
      ) {
        return {
          status:
            VERIFICATION_CHECK_STATUS.FAILED,

          issues: [
            "Numeric verification requires a statistics result",
          ],

          metadata: {
            unsupportedNumbers: [],
          },
        };
      }

      const unsupportedNumbers =
        findUnsupportedNumbers(
          answer,
          buildStatisticsEvidence(
            statisticsResult,
          ),
        );

      const passed =
        unsupportedNumbers.length === 0;

      return {
        status:
          passed
            ? VERIFICATION_CHECK_STATUS.PASSED
            : VERIFICATION_CHECK_STATUS.FAILED,

        issues:
          passed
            ? []
            : [
                `Unsupported numbers detected: ${unsupportedNumbers.join(", ")}`,
              ],

        metadata: {
          unsupportedNumbers,
        },
      };
    },
  });