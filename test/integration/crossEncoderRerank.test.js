import assert from "node:assert/strict";
import { describe, it } from "node:test";

// exercises the real "cross-encoder" rerank strategy end to end: downloads
// (and caches) Xenova/bge-reranker-base via transformers.js and runs an
// actual forward pass. lives in test:integration rather than test:unit
// because it needs network on first run and takes real wall-clock time to
// load the model -- the unit suite (rerank.test.js) covers the "llm" strategy
// against a stub instead, and stays fast and offline.

process.env.RERANK_STRATEGY = "cross-encoder";
process.env.RERANK_INPUT = "24";

const { rerankCandidates } = await import("../../src/modules/retrieval/ranking.service.js");

function candidates(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    chunk_id: `c${index}`,
    text: [5, 12, 20].includes(index)
      ? "Lumbar bone stress accounts for a large share of junior injuries."
      : `General discussion of tennis training methodology number ${index}`,
  }));
}

describe("cross-encoder reranking", () => {
  it("promotes passages that are actually relevant, independently of their batch", async () => {
    const result = await rerankCandidates("lumbar bone stress in juniors", candidates(24));

    assert.equal(result.reranked, true);
    assert.deepEqual(
      result.candidates.slice(0, 3).map((c) => c.id).sort(),
      ["c12", "c20", "c5"],
    );

    // unlike the batched llm strategy, every relevant passage should score
    // clearly above every irrelevant one -- there is no shared batch curve to
    // distort the comparison, since each passage is scored against the query
    // alone.
    const relevantScores = result.candidates.filter((c) => ["c5", "c12", "c20"].includes(c.id)).map((c) => c.rerankScore);
    const irrelevantScores = result.candidates.filter((c) => !["c5", "c12", "c20"].includes(c.id)).map((c) => c.rerankScore);

    assert.ok(Math.min(...relevantScores) > Math.max(...irrelevantScores));
  });
});
