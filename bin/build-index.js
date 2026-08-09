#!/usr/bin/env node
// builds the search index from folders of source files.
//
//   node bin/build-index.js ./data/raw
//   node bin/build-index.js "C:/Users/You/Desktop/TennisAU/DOCUMENTS" "C:/.../MATCH_DATA"
//
// this is the slow one. it reads every file, cuts it into chunks, sends each
// chunk to the embedding model, and writes data/index/. on an 8 gb card with
// bge-m3 expect roughly 15-25 minutes for the sample corpus.

import process from "node:process";

import { retrievalConfig } from "../src/config/retrieval.config.js";
import { buildIndex } from "../src/modules/ingestion/indexBuilder.service.js";
import { checkEmbeddingProvider } from "../src/modules/ingestion/embedding.service.js";

const sourceDirs = process.argv.slice(2);

if (sourceDirs.length === 0) {
  console.error("usage: node bin/build-index.js <folder> [more folders...]");
  process.exit(1);
}

// fail in two seconds with a useful message rather than forty minutes in.
const check = await checkEmbeddingProvider();

if (!check.ok) {
  console.error(`\ncannot reach the embedding model.\n  ${check.error}\n`);
  console.error("things to try:");
  console.error("  1. is ollama running?           ollama serve");
  console.error(`  2. is the model pulled?         ollama pull ${check.model}`);
  console.error("  3. or build without a model:    EMBEDDING_PROVIDER=hash npm run build:index -- <folder>");
  process.exit(1);
}

if (check.warning) {
  console.warn(`\n!! ${check.warning}`);
  console.warn("!! this index is for testing the pipeline only. do not demo with it.\n");
}

console.log(`embedding with: ${check.provider}/${check.model}`);
console.log(`contextual headers: ${retrievalConfig.contextual.enabled ? retrievalConfig.contextual.mode : "off"}`);
console.log(`chunk size: ${retrievalConfig.chunking.targetChars} chars, overlap ${retrievalConfig.chunking.overlapChars}\n`);

const startedAt = Date.now();
let lastPercent = -1;

try {
  const result = await buildIndex({
    sourceDirs,
    onProgress: (event) => {
      if (event.phase === "scan") {
        console.log(`found ${event.files} readable files`);
      } else if (event.phase === "extract") {
        process.stdout.write(`\rextracting ${event.done}/${event.total}  ${event.file.slice(0, 50)}`.padEnd(90));
      } else if (event.phase === "chunked") {
        process.stdout.write("\r".padEnd(90));
        console.log(`\r${event.chunks} chunks ready, all passed schema v2`);
      } else if (event.phase === "embed") {
        // only redraw on a whole percent, or the progress line itself becomes
        // the slowest part of the loop on a fast machine.
        const percent = Math.floor((event.done / event.total) * 100);

        if (percent !== lastPercent) {
          lastPercent = percent;
          const elapsed = (Date.now() - startedAt) / 1000;
          const rate = event.done / Math.max(elapsed, 0.1);
          const remaining = Math.round((event.total - event.done) / Math.max(rate, 0.01));

          process.stdout.write(
            `\rembedding ${event.done}/${event.total} (${percent}%)  ~${remaining}s left`.padEnd(60),
          );
        }
      }
    },
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n\nindex built in ${seconds}s`);
  console.log(`  ${result.chunkCount} chunks from ${result.fileCount} files`);
  console.log(`  written to ${retrievalConfig.index.dir}/`);
  console.log(`\nnow try:  npm run search -- "serve load during tournaments"`);
} catch (error) {
  console.error(`\n\nbuild failed:\n${error.message}\n`);
  process.exit(1);
}
