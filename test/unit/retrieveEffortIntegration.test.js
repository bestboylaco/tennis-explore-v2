import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// Exercises retrieve() -- the actual orchestrator answer.service.js calls --
// end to end, with a tiny self-contained fixture index standing in for the
// real corpus. The point is not retrieval quality (the hash embedder's
// vectors are meaningless, same as every other test that uses it -- see
// embedding.service.js) but the WIRING: does passing effortOverrides into
// retrieve() actually change how many times decomposition and reranking are
// called, same question, same role, same everything else.
//
// retrievalConfig freezes its values at first import, so the environment
// below has to be set before anything that reads it is imported -- same
// constraint test/unit/rerank.test.js and test/unit/indexAppend.test.js work
// under.

let workDir;
let decomposeCalls = 0;
let rerankCalls = 0;
let server;

let retrieve;
let clearIndexCache;

const QUESTION = "how does serve speed on clay compare with grass";

before(async () => {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "retrieve-effort-test-"));

  const directory = path.join(workDir, "index");

  server = http.createServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      const payload = JSON.parse(body || "{}");

      res.writeHead(200, { "Content-Type": "application/json" });

      if (payload.format) {
        // rerankViaLlm's shape: format is set, scores keyed by position.
        rerankCalls += 1;
        res.end(JSON.stringify({ message: { content: JSON.stringify({ scores: [{ id: 0, score: 9 }] }) } }));
      } else {
        // decomposeQuery's shape: plain prose, one sub-question per line.
        decomposeCalls += 1;
        res.end(
          JSON.stringify({
            message: { content: "serve speed on clay courts\nserve speed on grass courts" },
          }),
        );
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.EMBEDDING_PROVIDER = "hash";
  process.env.EMBEDDING_MODEL = "hash-test";
  process.env.EMBEDDING_DIMENSION = "32";
  process.env.RERANK_STRATEGY = "llm";
  // retrievalConfig reads this ONCE, the first time anything in this process
  // imports retrieval.config.js -- which happens transitively the moment any
  // of the dynamic imports below run. it has to be set before all of them,
  // not merely before importing retrieve() itself.
  process.env.INDEX_DIR = directory;

  // read eagerly by some import chains in this codebase; unused by anything
  // this test actually exercises (same guard as indexAppend.test.js).
  process.env.PORT ||= "3000";
  process.env.MONGODB_URI ||= "mongodb://unused-in-this-test/db";

  const { VectorStoreWriter } = await import("../../src/infrastructure/vector/vectorStore.service.js");
  const { embedTexts } = await import("../../src/modules/ingestion/embedding.service.js");

  const texts = [
    "Serve speed on clay courts tends to be slower due to the higher bounce and surface friction.",
    "Grass courts produce the fastest serve speeds of any surface because the ball skids through low.",
    "Hard courts sit between clay and grass for average recorded serve speed across the season.",
    "Footwork drills for the split step improve first-move reaction time before the return.",
    "Periodisation research recommends tapering training load in the two weeks before a major.",
    "Recovery protocols between tournament matches focus on sleep and hydration more than ice baths.",
  ];

  const vectors = await embedTexts(texts, {});

  const writer = new VectorStoreWriter(directory, { dimension: 32, manifest: { test: true } });

  await writer.open();

  for (let i = 0; i < texts.length; i += 1) {
    await writer.add(
      {
        chunk_id: `c${i}`,
        doc_id: "fixture-doc",
        text: texts[i],
        context_header: "",
        // a real grant string (accessControl.js: `${domain}:${sensitivity}:${program}`),
        // held by every role whose domains include "research" -- "admin" does.
        acl_groups: ["research:public:*"],
      },
      vectors[i],
    );
  }

  await writer.close();

  ({ retrieve, clearIndexCache } = await import("../../src/modules/retrieval/retrieval.service.js"));
});

after(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
  await fsp.rm(workDir, { recursive: true, force: true });
});

async function runRetrieve(effortOverrides) {
  decomposeCalls = 0;
  rerankCalls = 0;

  const { retrievalConfig } = await import("../../src/config/retrieval.config.js");

  clearIndexCache();

  const result = await retrieve(QUESTION, {
    roleId: "admin",
    signal: null,
    effortOverrides,
    topN: 10,
  });

  return { result, decomposeCalls, rerankCalls, retrievalConfig };
}

describe("retrieve() -- effort overrides change which stages actually run (TENISE-68)", () => {
  it("default (no effortOverrides passed) behaves exactly as retrievalConfig says", async () => {
    const { decomposeCalls: decomposed, rerankCalls: reranked, retrievalConfig } = await runRetrieve(undefined);

    // this fixture's question is phrased as a multi-hop comparison
    // ("compare... with") specifically so decomposition has something to do
    // under the current defaults (DECOMPOSITION_ENABLED=true,
    // RERANK_ENABLED=true -- see .env.example / retrieval.config.js).
    assert.equal(decomposed > 0, retrievalConfig.query.decompositionEnabled);
    assert.equal(reranked > 0, retrievalConfig.rerank.enabled);
  });

  it("fast-shaped overrides skip decomposition AND reranking -- zero model calls for either", async () => {
    const { decomposeCalls: decomposed, rerankCalls: reranked, result } = await runRetrieve({
      decompositionEnabled: false,
      rerankEnabled: false,
    });

    assert.equal(decomposed, 0, "fast must not pay for a decomposition call");
    assert.equal(reranked, 0, "fast must not pay for a reranking call");
    assert.equal(result.telemetry.reranked, false);
    // one query only -- bm25 + dense, nothing split.
    assert.equal(result.telemetry.subQueries, 1);
  });

  it("thorough-shaped overrides run both, even question-for-question identical to the default", async () => {
    const { decomposeCalls: decomposed, rerankCalls: reranked, result } = await runRetrieve({
      decompositionEnabled: true,
      rerankEnabled: true,
    });

    assert.ok(decomposed > 0, "thorough must actually decompose a multi-hop question");
    assert.ok(reranked > 0, "thorough must actually call the reranker");
    assert.equal(result.telemetry.reranked, true);
    assert.ok(result.telemetry.subQueries > 1, "a successful decomposition produces more than one sub-query");
  });

  it("fast makes strictly fewer model calls than thorough for the identical question", async () => {
    const fast = await runRetrieve({ decompositionEnabled: false, rerankEnabled: false });
    const thorough = await runRetrieve({ decompositionEnabled: true, rerankEnabled: true });

    const fastCalls = fast.decomposeCalls + fast.rerankCalls;
    const thoroughCalls = thorough.decomposeCalls + thorough.rerankCalls;

    assert.ok(
      fastCalls < thoroughCalls,
      `expected fast (${fastCalls} calls) to be cheaper than thorough (${thoroughCalls} calls)`,
    );
  });
});
