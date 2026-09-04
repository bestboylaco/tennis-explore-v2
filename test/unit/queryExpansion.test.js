import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { expandQuery, keywordFallback } from "../../src/modules/query/queryExpansion.service.js";

let server;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const question = (payload.messages ?? []).filter((m) => m.role === "user").pop()?.content ?? "";

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              queries: [
                "lumbar bone stress injury risk factors in adolescent athletes",
                "prevention of spondylolysis in junior tennis players",
                // deliberately echoes the input, to prove it is filtered out
                question,
              ],
            }),
          },
        }),
      );
    });
  });

  await new Promise((resolve) => server.listen(11434, resolve));
});

after(() => new Promise((resolve) => server.close(() => resolve())));

describe("query expansion", () => {
  it("rewrites a plain question into the archive's vocabulary", async () => {
    // the whole point: "how do we stop kids hurting their backs" and "risk
    // factors for lumbar bone stress injury" share almost no words, so the
    // first retrieval finds nothing and the second finds the paper.
    const rewrites = await expandQuery("how do we stop kids hurting their backs");

    assert.ok(rewrites.length >= 2);
    assert.ok(rewrites.some((r) => r.includes("lumbar")));
  });

  it("drops a rewrite identical to the question", async () => {
    // an echoed query adds a duplicate ranked list, which quietly doubles that
    // phrasing's weight in the fusion.
    const question = "how do we stop kids hurting their backs";
    const rewrites = await expandQuery(question);

    assert.ok(!rewrites.some((r) => r.toLowerCase() === question.toLowerCase()));
  });

    it(
        "returns nothing rather than throwing when the model is unreachable",
        async () => {
            /*
             * Simulate the same failure fetch produces when the model
             * endpoint cannot be reached.
             *
             * Injecting the failure is deterministic and avoids relying
             * on HTTP keep-alive behaviour from the test server.
             */
            const unreachableFetch =
                async () => {
                    throw new TypeError(
                        "fetch failed",
                    );
                };

            const rewrites =
                await expandQuery(
                    "anything",
                    {
                        fetchImpl:
                            unreachableFetch,
                    },
                );

            assert.deepEqual(
                rewrites,
                [],
            );
        },
    );
});

describe("keyword fallback", () => {
  it("strips a question to its content words", () => {
    // reads badly as a sentence, which does not matter -- BM25 sees a bag of
    // terms either way, and the grammar is the part that just failed.
    assert.deepEqual(
      keywordFallback("What does the research say about recovery between matches?"),
      ["research recovery between matches"],
    );
  });

  it("gives up on a question with nothing left after stopwords", () => {
    assert.deepEqual(keywordFallback("what is it"), []);
  });
});
