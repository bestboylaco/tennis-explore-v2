#!/usr/bin/env node
// tells you whether your machine is ready, before you spend an hour finding out
// it is not.
//
//   npm run check:models

import { retrievalConfig } from "../src/config/retrieval.config.js";

const { baseUrl } = retrievalConfig.embedding;

console.log(`\nchecking ollama at ${baseUrl}\n`);

let installed = [];

try {
  const response = await fetch(`${baseUrl}/api/tags`);

  if (!response.ok) throw new Error(`status ${response.status}`);

  const payload = await response.json();

  installed = (payload.models ?? []).map((model) => model.name);

  console.log(`ollama is running, ${installed.length} model(s) installed\n`);
} catch (error) {
  console.error(`ollama is not reachable: ${error.message}`);
  console.error("\nstart it with:  ollama serve\n");
  process.exit(1);
}

// a model is "present" if any installed tag starts with the configured name --
// ollama appends :latest and other tags, so an exact match would report bge-m3
// as missing when bge-m3:latest is sitting right there.
const has = (name) => installed.some((tag) => tag === name || tag.startsWith(`${name}:`));

// NOTE the reranker is deliberately absent from this list. ollama has no
// /api/rerank and no bge-reranker in its library, so telling anyone to pull one
// sends them to an error -- which is exactly what happened. reranking is
// reported separately below.
const needed = [
  { name: retrievalConfig.embedding.model, why: "embeddings. required.", required: true },
  { name: retrievalConfig.generation.model, why: "writing answers. required for `npm run ask`.", required: true },
];

let missingRequired = false;

for (const model of needed) {
  const present = has(model.name);

  console.log(`${present ? "  ok  " : " MISS "} ${model.name.padEnd(24)} ${model.why}`);

  if (!present) {
    console.log(`        pull it:  ollama pull ${model.name}`);

    if (model.required) missingRequired = true;
  }
}

// ---------------------------------------------------------------------------
// reranking
// ---------------------------------------------------------------------------
console.log(`\nreranking: strategy "${retrievalConfig.rerank.strategy}"`);

if (retrievalConfig.rerank.strategy === "service") {
  const url = retrievalConfig.rerank.apiUrl || "(not set)";

  try {
    const health = await fetch(url.replace(/\/rerank$/, "/health"));

    console.log(health.ok ? `  ok   cross-encoder service reachable at ${url}` : ` MISS  ${url} responded ${health.status}`);
  } catch {
    console.log(` MISS  no rerank service at ${url}`);
    console.log("        start one:  python tools/rerank/rerank_server.py");
  }
} else {
  console.log(`  ok   scoring passages with ${retrievalConfig.rerank.llmModel}, in batches of ${retrievalConfig.rerank.batchSize}`);
  console.log("       needs nothing extra. for a real cross-encoder instead:");
  console.log("         pip install fastapi uvicorn sentence-transformers");
  console.log("         python tools/rerank/rerank_server.py");
  console.log("         then set RERANK_STRATEGY=service and RERANK_API_URL in .env");
}

console.log(
  `\nvram note: bge-m3 is ~2.3 gb and llama3.1:8b ~4.7 gb, so ~7 gb together -- tight on an\n` +
    `8 gb card. ollama swaps the generation model in and out, so the first answer after an\n` +
    `index build is slow and later ones are quick. that is normal, not a bug.\n` +
    `adding a cross-encoder service costs another ~1.1 gb on top.\n`,
);

process.exit(missingRequired ? 1 : 0);
