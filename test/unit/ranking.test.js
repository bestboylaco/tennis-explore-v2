import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hydrateFusedCandidates,
  reciprocalRankFusion,
} from "../../src/modules/retrieval/ranking.service.js";

const chunk = (id) => ({ id, score: 1, chunk: { chunk_id: id, text: id } });

describe("reciprocal rank fusion", () => {
  it("ranks a document both arms found above one only a single arm found", () => {
    // the entire premise of hybrid search in one assertion.
    const bm25 = [chunk("a"), chunk("shared")];
    const dense = [chunk("shared"), chunk("b")];

    const fused = reciprocalRankFusion([bm25, dense]);

    assert.equal(fused[0].id, "shared");
  });

  it("ignores score scale entirely", () => {
    // bm25 scores are unbounded and cosine scores sit in [-1, 1]. if fusion
    // looked at scores at all, the arm with bigger numbers would always win.
    const bigScores = [{ id: "x", score: 9999, chunk: { chunk_id: "x" } }];
    const smallScores = [{ id: "y", score: 0.02, chunk: { chunk_id: "y" } }];

    const fused = reciprocalRankFusion([bigScores, smallScores]);

    assert.equal(fused[0].rrfScore, fused[1].rrfScore);
  });

  it("does not let a duplicate inside one list double its own score", () => {
    const withDuplicate = [chunk("a"), chunk("a"), chunk("b")];
    const fused = reciprocalRankFusion([withDuplicate]);

    assert.equal(fused.length, 2);
    assert.equal(fused[0].id, "a");
  });

  it("is deterministic when scores tie", () => {
    const first = reciprocalRankFusion([[chunk("b"), chunk("a")]]);
    const second = reciprocalRankFusion([[chunk("b"), chunk("a")]]);

    assert.deepEqual(
      first.map((entry) => entry.id),
      second.map((entry) => entry.id),
    );
  });

  it("rejects a negative k rather than producing nonsense", () => {
    assert.throws(() => reciprocalRankFusion([[chunk("a")]], { k: -1 }), RangeError);
  });
});

describe("hydration", () => {
  it("records which arms found each candidate", () => {
    const bm25 = [chunk("shared")];
    const dense = [chunk("shared")];

    const fused = reciprocalRankFusion([bm25, dense]);
    const hydrated = hydrateFusedCandidates(fused, [bm25, dense], ["bm25", "dense"]);

    assert.deepEqual(hydrated[0].foundBy, ["bm25", "dense"]);
  });
});
