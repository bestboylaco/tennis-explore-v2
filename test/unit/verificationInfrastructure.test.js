import test from "node:test";
import assert from "node:assert/strict";

import {
  clearVerificationStrategies,
  hasVerificationStrategy,
  listVerificationStrategies,
} from "../../src/modules/verification/verification.registry.js";

import {
  bootstrapVerification,
  VERIFICATION_STRATEGY_IDS,
} from "../../src/modules/verification/verification.bootstrap.js";

import {
  verify,
} from "../../src/modules/verification/verification.service.js";


function statisticsResult() {
  return {
    columns: [
      "avg_singles_ranking",
    ],

    rows: [
      {
        avg_singles_ranking:
          94.22222222222223,
      },
    ],

    rowsScanned: 45,
    rowsMatched: 45,
    rowsReturned: 1,
  };
}


test(
  "bootstraps numeric verification",
  () => {
    clearVerificationStrategies();

    bootstrapVerification();

    assert.equal(
      hasVerificationStrategy(
        VERIFICATION_STRATEGY_IDS.NUMERIC,
      ),
      true,
    );

    assert.deepEqual(
        listVerificationStrategies(),
        [
            "numeric",
            "document_grounding",
        ]
        );
  },
);


test(
  "verification bootstrap is idempotent",
  () => {
    clearVerificationStrategies();

    bootstrapVerification();
    bootstrapVerification();

    assert.deepEqual(
        listVerificationStrategies(),
        [
            "numeric",
            "document_grounding",
        ]
        );
  },
);


test(
  "numeric verification accepts supported statistics",
  async () => {
    clearVerificationStrategies();

    bootstrapVerification();

    const result =
      await verify({
        checkIds: [
          VERIFICATION_STRATEGY_IDS.NUMERIC,
        ],

        input: {
          answer:
            "The average singles ranking is 94.22.",

          statisticsResult:
            statisticsResult(),
        },
      });

    assert.equal(
      result.verified,
      true,
    );

    assert.equal(
      result.checks.numeric.status,
      "passed",
    );

    assert.deepEqual(
      result.checks.numeric
        .metadata
        .unsupportedNumbers,
      [],
    );
  },
);


test(
  "numeric verification rejects unsupported numbers",
  async () => {
    clearVerificationStrategies();

    bootstrapVerification();

    const result =
      await verify({
        checkIds: [
          VERIFICATION_STRATEGY_IDS.NUMERIC,
        ],

        input: {
          answer:
            "The average singles ranking is 9999.",

          statisticsResult:
            statisticsResult(),
        },
      });

    assert.equal(
      result.verified,
      false,
    );

    assert.equal(
      result.checks.numeric.status,
      "failed",
    );

    assert.ok(
      result.checks.numeric
        .metadata
        .unsupportedNumbers
        .length > 0,
    );
  },
);


test(
  "verification rejects an unregistered strategy",
  async () => {
    clearVerificationStrategies();

    await assert.rejects(
      () =>
        verify({
          checkIds: [
            "not_registered",
          ],

          input: {},
        }),

      /No verification strategy registered/,
    );
  },
);


test(
  "verification does not silently pass when no checks run",
  async () => {
    clearVerificationStrategies();

    const result =
      await verify({
        checkIds: [],
        input: {},
      });

    assert.equal(
      result.verified,
      false,
    );

    assert.equal(
      result.metadata.checkCount,
      0,
    );
  },
);