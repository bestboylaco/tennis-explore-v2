import test from "node:test";
import assert from "node:assert/strict";

import {
  SYNTHESIS_MODES,
} from "../../src/modules/synthesis/synthesis.types.js";

import {
  clearSynthesisStrategies,
} from "../../src/modules/synthesis/synthesis.registry.js";

import {
  bootstrapSynthesis,
} from "../../src/modules/synthesis/synthesis.bootstrap.js";

import {
  synthesize,
} from "../../src/modules/synthesis/synthesis.service.js";

import {
  clearVerificationStrategies,
} from "../../src/modules/verification/verification.registry.js";

import {
  bootstrapVerification,
} from "../../src/modules/verification/verification.bootstrap.js";

import {
  verifySynthesis,
} from "../../src/modules/verification/verifySynthesis.service.js";


function createStatisticsInput() {
  return {
    question:
      "What is the average singles ranking?",

    mode:
      SYNTHESIS_MODES.STATISTICS,

    documentEvidence: [],

    statisticsResults: [
      {
        columns: [
          "avg_singles_ranking",
        ],

        rows: [
          {
            avg_singles_ranking:
              94.22222222222223,
          },
        ],

        sql:
          "SELECT AVG(singles_ranking) AS avg_singles_ranking FROM rankings",

        table:
          "rankings",

        tableTitle:
          "Rankings",

        sourceUri:
          "rankings.csv",

        rowsScanned: 45,
        rowsMatched: 45,
        rowsReturned: 1,
        truncated: false,
      },
    ],

    successfulActionIds: [
      "statistics",
    ],
  };
}


test(
  "statistics synthesis flows through the new verification infrastructure",
  async () => {
    clearSynthesisStrategies();
    clearVerificationStrategies();

    bootstrapSynthesis();
    bootstrapVerification();

    const input =
      createStatisticsInput();

    const synthesisResult =
      await synthesize({
        mode:
          SYNTHESIS_MODES.STATISTICS,

        input,

        context: {
          generateText: async () =>
            "The average singles ranking is 94.22.",
        },
      });

    const verificationResult =
      await verifySynthesis({
        synthesisResult,
        synthesisInput: input,
      });

    assert.equal(
      synthesisResult.answer,
      "The average singles ranking is 94.22.",
    );

    assert.equal(
      verificationResult.verified,
      true,
    );

    assert.equal(
      verificationResult
        .checks
        .numeric
        .status,
      "passed",
    );

    assert.deepEqual(
      verificationResult
        .checks
        .numeric
        .metadata
        .unsupportedNumbers,
      [],
    );
  },
);


test(
  "new verification infrastructure detects invented statistics",
  async () => {
    clearSynthesisStrategies();
    clearVerificationStrategies();

    bootstrapSynthesis();
    bootstrapVerification();

    const input =
      createStatisticsInput();

    const synthesisResult =
      await synthesize({
        mode:
          SYNTHESIS_MODES.STATISTICS,

        input,

        context: {
          generateText: async () =>
            "The average singles ranking is 9999.",
        },
      });

    const verificationResult =
      await verifySynthesis({
        synthesisResult,
        synthesisInput: input,
      });

    assert.equal(
      verificationResult.verified,
      false,
    );

    assert.equal(
      verificationResult
        .checks
        .numeric
        .status,
      "failed",
    );

    assert.ok(
      verificationResult
        .checks
        .numeric
        .metadata
        .unsupportedNumbers
        .length > 0,
    );
  },
);


