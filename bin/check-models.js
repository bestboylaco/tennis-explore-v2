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

const needed = [
  { name: retrievalConfig.embedding.model, why: "embeddings. required.", required: true },
  { name: retrievalConfig.rerank.model, why: "reranking. optional, improves ordering.", required: false },
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

console.log(
  `\nvram note: bge-m3 is ~2.3 gb, the reranker ~1.1 gb, llama3.1:8b ~4.7 gb. ` +
    `that is ~8 gb together,\nwhich is tight on an 8 gb card -- ollama will swap the ` +
    `generation model in and out, so the first\nanswer after an index build is slow and ` +
    `later ones are quick. that is normal, not a bug.\n`,
);

process.exit(missingRequired ? 1 : 0);
