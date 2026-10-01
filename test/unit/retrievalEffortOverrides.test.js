import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planRetrieval } from "../../src/modules/retrieval/queryAnalyzer.service.js";
import { rerankCandidates } from "../../src/modules/retrieval/ranking.service.js";
import { retrievalConfig } from "../../src/config/retrieval.config.js";

// ---------------------------------------------------------------------------
// planRetrieval -- pure, no network. decompose/useHyde are flags the router
// hands back; nothing here actually calls a model, so these run instantly.
// ---------------------------------------------------------------------------

const MULTI_HOP_QUESTION = "how does serve speed on clay compare with grass";

describe("planRetrieval -- decompositionEnabled override (TENISE-68)", () => {
  it("with no override, matches whatever retrievalConfig says (unchanged default behaviour)", () => {
    const plan = planRetrieval(MULTI_HOP_QUESTION);

    assert.equal(plan.kind, "multi_hop");
    assert.equal(plan.decompose, retrievalConfig.query.decompositionEnabled);
  });

  it("an explicit override of false wins over a true config, same call shape as 'fast'", () => {
    const plan = planRetrieval(MULTI_HOP_QUESTION, { decompositionEnabled: false });

    assert.equal(plan.decompose, false);
  });

  it("an explicit override of true wins regardless of config, same call shape as 'thorough'", () => {
    const plan = planRetrieval(MULTI_HOP_QUESTION, { decompositionEnabled: true });

    assert.equal(plan.decompose, true);
  });

  it("an empty overrides object behaves identically to passing none at all", () => {
    assert.deepEqual(planRetrieval(MULTI_HOP_QUESTION, {}), planRetrieval(MULTI_HOP_QUESTION));
  });

  it("the override only matters for multi-hop -- an entity lookup never decomposes either way", () => {
    const plan = planRetrieval("score against Kumasaka M-CH-AUS-2025-005", { decompositionEnabled: true });

    assert.equal(plan.decompose, false);
  });
});

// ---------------------------------------------------------------------------
// rerankCandidates -- the `enabled` override.
//
// `fetchImpl` is injected rather than pointed at a real http server on
// OLLAMA_BASE_URL. retrievalConfig freezes OLLAMA_BASE_URL into
// retrievalConfig.rerank.baseUrl the first time retrieval.config.js is
// imported anywhere in the process, and node's test runner has been observed
// in this repo to share that module registry across test *files* run in the
// same invocation (test/unit/rerank.test.js imports the same module with its
// own stub's URL) -- so a second file racing to set the env var before its
// own import is not reliable. Injecting the fetch implementation sidesteps
// the URL entirely: whatever `retrievalConfig.rerank.baseUrl` ended up
// frozen to, these calls never actually reach it.
// ---------------------------------------------------------------------------

function candidates(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    chunk_id: `c${index}`,
    text: `candidate passage number ${index}`,
  }));
}

function stubFetch({ calls }) {
  return async () => {
    calls.count += 1;

    return {
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ scores: [{ id: 0, score: 9 }] }) } }),
    };
  };
}

describe("rerankCandidates -- enabled override (TENISE-68)", () => {
  it("enabled: false skips the stage entirely -- no call reaches the model", async () => {
    const calls = { count: 0 };

    const result = await rerankCandidates("anything", candidates(5), {
      enabled: false,
      fetchImpl: stubFetch({ calls }),
    });

    assert.equal(result.reranked, false);
    assert.equal(result.reason, "disabled");
    assert.equal(calls.count, 0, "the 'fast' override must not cost a reranking call");
    // fused order preserved untouched.
    assert.deepEqual(result.candidates.map((c) => c.id), candidates(5).map((c) => c.id));
  });

  it("enabled: true runs the stage even when the strategy is 'none'-adjacent by default elsewhere", async () => {
    const calls = { count: 0 };

    const result = await rerankCandidates("anything", candidates(3), {
      enabled: true,
      fetchImpl: stubFetch({ calls }),
    });

    assert.equal(result.reranked, true);
    assert.ok(calls.count > 0, "the 'thorough' override must actually call the reranker");
  });

  it("omitting the override entirely falls back to the configured default (reranking is on)", async () => {
    const calls = { count: 0 };

    const result = await rerankCandidates("anything", candidates(3), { fetchImpl: stubFetch({ calls }) });

    // this assertion documents the environment's actual default rather than
    // assuming it -- RERANK_ENABLED defaults to true (retrieval.config.js /
    // .env.example), so an omitted override should behave exactly as if
    // `enabled: true` had been passed explicitly.
    assert.equal(retrievalConfig.rerank.enabled, true, "this test assumes the documented default");
    assert.equal(result.reranked, true);
    assert.ok(calls.count > 0);
  });

  it("fast (disabled) is strictly cheaper than thorough (enabled) for the identical input", async () => {
    const fastCalls = { count: 0 };
    const thoroughCalls = { count: 0 };

    await rerankCandidates("anything", candidates(4), { enabled: false, fetchImpl: stubFetch({ calls: fastCalls }) });
    await rerankCandidates("anything", candidates(4), { enabled: true, fetchImpl: stubFetch({ calls: thoroughCalls }) });

    assert.ok(fastCalls.count < thoroughCalls.count);
  });
});
