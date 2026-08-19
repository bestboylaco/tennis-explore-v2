#!/usr/bin/env node
// the ablation harness.
//
//   npm run eval
//
// runs the same question set through several retrieval configurations and
// prints what each one actually bought. this exists because "we implemented
// hybrid search and reranking" is a claim, and a table of hit@k per strategy is
// evidence -- and because two of the techniques in this codebase (hyde,
// decomposition) are ones the literature says may not help, so we should be
// able to show what they do on OUR corpus rather than repeating someone else's
// benchmark.
//
// the question set lives in queries/query_set.json. each entry names the
// document that should come back, so scoring is just "did we find it".
//
// each strategy runs in its own child process -- see bin/eval-run.js for why
// that is not optional.

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, "eval-run.js");

// each strategy is a set of environment overrides. they are applied to a fresh
// process, so they genuinely take effect.
const STRATEGIES = [
  { name: "bm25 only", env: { DENSE_K: "0", RERANK_ENABLED: "false", ROUTING_ENABLED: "false", CONTEXTUAL_ENABLED: "true" } },
  { name: "dense only", env: { BM25_K: "0", RERANK_ENABLED: "false", ROUTING_ENABLED: "false" } },
  { name: "hybrid (rrf)", env: { RERANK_ENABLED: "false", ROUTING_ENABLED: "false" } },
  { name: "hybrid + routing", env: { RERANK_ENABLED: "false", ROUTING_ENABLED: "true" } },
  { name: "hybrid + rerank", env: { RERANK_ENABLED: "true", ROUTING_ENABLED: "false" } },
  { name: "full stack", env: { RERANK_ENABLED: "true", ROUTING_ENABLED: "true", DECOMPOSITION_ENABLED: "true" } },
  { name: "full + hyde", env: { RERANK_ENABLED: "true", ROUTING_ENABLED: "true", HYDE_ENABLED: "true" } },
];

function runStrategy(strategy) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], {
      env: { ...process.env, ...strategy.env, STRATEGY_NAME: strategy.name },
      stdio: ["ignore", "pipe", "inherit"],
    });

    let out = "";

    child.stdout.on("data", (buffer) => {
      out += buffer.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`strategy "${strategy.name}" exited with code ${code}`));
        return;
      }

      try {
        // the runner prints exactly one json line; anything else on stdout is
        // noise from a dependency and is ignored.
        const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();

        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`could not read result for "${strategy.name}": ${error.message}`));
      }
    });
  });
}

console.log("\nrunning ablation, one process per strategy\n");
console.log("strategy            hit@1  hit@5  hit@10   mrr    mean ms");
console.log("-".repeat(60));

const rows = [];

for (const strategy of STRATEGIES) {
  try {
    const row = await runStrategy(strategy);

    rows.push(row);

    console.log(
      `${row.name.padEnd(20)}${row.hit1.toFixed(3)}  ${row.hit5.toFixed(3)}  ` +
        `${row.hit10.toFixed(3)}  ${row.mrr.toFixed(3)}  ${String(row.meanMs).padStart(7)}` +
        `${row.failures > 0 ? `  (${row.failures} failed)` : ""}`,
    );
  } catch (error) {
    console.log(`${strategy.name.padEnd(20)}-- ${error.message}`);
  }
}

// per-tag mrr, which is where the actual argument lives. an average that says
// "hybrid is 4% better" is much less useful than "hybrid is 25% better on
// paraphrased questions and identical on exact lookups", because the second one
// tells you when to spend the latency.
if (rows.length > 0) {
  const tags = [...new Set(rows.flatMap((row) => Object.keys(row.byTag)))].sort();

  if (tags.length > 0) {
    console.log(`\nmrr by question type\n${"-".repeat(60)}`);
    console.log(`${"strategy".padEnd(20)}${tags.map((tag) => tag.slice(0, 11).padStart(12)).join("")}`);

    for (const row of rows) {
      console.log(
        `${row.name.padEnd(20)}${tags
          .map((tag) => (row.byTag[tag] === undefined ? "-" : row.byTag[tag].toFixed(3)).padStart(12))
          .join("")}`,
      );
    }
  }
}

await fsp.mkdir("evidence", { recursive: true });
await fsp.writeFile(
  "evidence/strategy_comparison.json",
  `${JSON.stringify({ generatedAt: new Date().toISOString(), results: rows }, null, 2)}\n`,
);

console.log("\nwritten to evidence/strategy_comparison.json\n");
