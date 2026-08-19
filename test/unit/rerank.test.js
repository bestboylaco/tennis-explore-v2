import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { rerankCandidates } from "../../src/modules/retrieval/ranking.service.js";

// a stand-in for the chat model that scores anything mentioning "lumbar"
// highly. deterministic, so the test asserts ordering rather than luck.
let server;
let calls = 0;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      calls += 1;

      const payload = JSON.parse(body || "{}");
      const user = (payload.messages ?? []).filter((m) => m.role === "user").pop()?.content ?? "";
      const blocks = user.split(/\n\n/).filter((block) => /^\[\d+\]/.test(block));

      const scores = blocks.map((block) => ({
        id: Number(block.match(/^\[(\d+)\]/)[1]),
        score: /lumbar/i.test(block) ? 9 : 1,
      }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { content: JSON.stringify({ scores }) } }));
    });
  });

  await new Promise((resolve) => server.listen(11434, resolve));
});

// closed inside the last test, so `after` only has to cope with it already
// being shut.
after(() => new Promise((resolve) => server.close(() => resolve())));

function candidates(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    chunk_id: `c${index}`,
    text: [5, 12, 20].includes(index)
      ? "Lumbar bone stress accounts for a large share of junior injuries."
      : `General discussion of tennis training methodology number ${index}`,
  }));
}

describe("reranking", () => {
  it("promotes relevant passages that fusion buried", () => {
    // the point of a reranker in one assertion: three passages sat at ranks 5,
    // 12 and 20 after fusion, and reading the query against the passage moves
    // them to the top.
    return rerankCandidates("lumbar bone stress in juniors", candidates(24)).then((result) => {
      assert.equal(result.reranked, true);
      assert.deepEqual(
        result.candidates.slice(0, 3).map((c) => c.id).sort(),
        ["c12", "c20", "c5"],
      );
    });
  });

  it("batches instead of one call per passage", async () => {
    // an earlier version sent one request per candidate: 50 sequential round
    // trips, about 90 seconds on a local 8b model, which is unusable.
    calls = 0;

    await rerankCandidates("lumbar", candidates(24));

    assert.ok(calls <= 3, `expected at most 3 batched calls, got ${calls}`);
  });

  it("keeps the fused order when the model is unreachable", async () => {
    // a missing reranker must degrade, not fail the request. a slightly worse
    // ordering beats a chat endpoint that 502s over an optional component.
    //
    // the stub is closed here rather than pointing config at a dead port,
    // because retrieval.config freezes its values at import and node caches the
    // module -- so changing the env afterwards does nothing. that is the same
    // trap the eval harness hit, which is why it spawns a process per strategy.
    await new Promise((resolve) => server.close(resolve));

    const input = candidates(4);
    const result = await rerankCandidates("lumbar", input);

    assert.equal(result.reranked, false);
    assert.match(result.reason, /reranker_unavailable/);
    assert.deepEqual(
      result.candidates.map((c) => c.id),
      input.map((c) => c.id),
    );
  });
});
