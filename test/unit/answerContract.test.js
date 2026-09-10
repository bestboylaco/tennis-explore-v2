import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSystemPrompt } from "../../src/modules/retrieval/answerContract.service.js";
import { INTENTS } from "../../src/shared/constants/queryTaxonomy.js";

// A small model asked to describe an already-computed table (answerFromTables
// in chat/services/answer.service.js) was told, via GROUNDING_RULES, to cite
// numbered [n] evidence blocks -- a shape that prompt never actually shows it,
// since the table itself is the only evidence there is. Followed literally,
// "no numbered block to cite" read as "no evidence", and it produced the
// abstention sentence over a table that answered the question correctly
// (observed live, 2026-08-27). isTableAnswer swaps in a rule set that fits
// what the model is actually shown.

describe("buildSystemPrompt", () => {
  it("does not ask a table answer to cite numbered evidence blocks", () => {
    const prompt = buildSystemPrompt({
      intent: INTENTS.ANALYTICAL,
      contracts: [],
      isTableAnswer: true,
    });

    assert.doesNotMatch(prompt, /evidence block/i);
    assert.match(prompt, /already-computed answer/i);
  });

  it("tells a table answer not to claim the knowledge base lacks an answer", () => {
    const prompt = buildSystemPrompt({
      intent: INTENTS.AGGREGATION,
      contracts: [],
      isTableAnswer: true,
    });

    assert.match(prompt, /do not claim the knowledge base lacks an answer/i);
  });

  it("keeps the original evidence-block rules for document answers", () => {
    const prompt = buildSystemPrompt({
      intent: INTENTS.SINGLE_HOP,
      contracts: [],
    });

    assert.match(prompt, /evidence block/i);
    assert.match(prompt, /knowledge base does not contain an answer/i);
  });
});
