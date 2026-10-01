import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripSelfCommentary } from "../../src/modules/chat/services/answer.service.js";

describe("stripping a repair pass's own commentary about its edit", () => {
  it("removes a trailing 'Citations added' section", () => {
    // the exact live case: a repair call correctly added real citations,
    // then appended a whole extra section explaining where each one went,
    // despite being told to reply with the corrected answer only.
    const repaired =
      "Winners hit faster serves [6][9].\n\n" +
      "---\n\n" +
      "**Citations added to factual statements:**\n" +
      "- [6][9] for first serve metrics.\n" +
      "- [4] for movement patterns.";

    assert.equal(stripSelfCommentary(repaired), "Winners hit faster serves [6][9].");
  });

  it("removes a trailing 'References added' section without a heading marker", () => {
    const repaired = "The ratio matters most [4][6].\n\nReferences added: [4] for the ratio, [6] for chronic load.";

    assert.equal(stripSelfCommentary(repaired), "The ratio matters most [4][6].");
  });

  it("leaves a normal answer with no self-commentary unchanged", () => {
    const answer = "Winners hit faster serves [6][9]. This is a critical determinant of match outcome [2].";

    assert.equal(stripSelfCommentary(answer), answer);
  });

  it("does not strip a legitimate sentence that happens to contain 'citations'", () => {
    // the trigger is specifically a heading-shaped "citations/references/
    // sources/changes ADDED/MADE/INSERTED/UPDATED", not the bare word.
    const answer = "The paper's citations are listed in its bibliography [3].";

    assert.equal(stripSelfCommentary(answer), answer);
  });
});
