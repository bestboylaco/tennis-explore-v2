import test from "node:test";
import assert from "node:assert/strict";

import {
  SYNTHESIS_MODES,
} from "../../src/modules/synthesis/synthesis.types.js";

import {
  clearSynthesisStrategies,
  getSynthesisStrategy,
  hasSynthesisStrategy,
  listSynthesisStrategies,
} from "../../src/modules/synthesis/synthesis.registry.js";

import {
  bootstrapSynthesis,
} from "../../src/modules/synthesis/synthesis.bootstrap.js";

import {
  synthesize,
} from "../../src/modules/synthesis/synthesis.service.js";


test(
  "bootstraps the statistics synthesis strategy",
  () => {
    clearSynthesisStrategies();

    bootstrapSynthesis();

    assert.equal(
      hasSynthesisStrategy(
        SYNTHESIS_MODES.STATISTICS,
      ),
      true,
    );

    const strategy =
      getSynthesisStrategy(
        SYNTHESIS_MODES.STATISTICS,
      );

    assert.equal(
      typeof strategy.synthesize,
      "function",
    );

    assert.deepEqual(
      listSynthesisStrategies(),
      ["statistics"],
    );
  },
);


test(
  "bootstrap is idempotent",
  () => {
    clearSynthesisStrategies();

    bootstrapSynthesis();
    bootstrapSynthesis();

    assert.deepEqual(
      listSynthesisStrategies(),
      ["statistics"],
    );
  },
);


test(
  "generic synthesis service executes statistics strategy",
  async () => {
    clearSynthesisStrategies();

    bootstrapSynthesis();

    const input = {
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

    const result =
      await synthesize({
        mode:
          SYNTHESIS_MODES.STATISTICS,

        input,

        context: {
          generateText: async () =>
            "The average singles ranking is 94.22.",
        },
      });

    assert.equal(
      result.contractVersion,
      1,
    );

    assert.equal(
      result.mode,
      "statistics",
    );

    assert.equal(
      result.answered,
      true,
    );

    assert.equal(
      result.answer,
      "The average singles ranking is 94.22.",
    );

    assert.equal(
        result.metadata.sourceAction,
        "statistics",
        );

    assert.equal(
      result.data
        .statistics
        .data
        .rows[0]
        .avg_singles_ranking,
      94.22222222222223,
    );
  },
);


test(
  "generic synthesis service rejects an unregistered mode",
  async () => {
    clearSynthesisStrategies();

    await assert.rejects(
      () =>
        synthesize({
          mode: "not_registered",
          input: {},
        }),

      /No synthesis strategy registered/,
    );
  },
);