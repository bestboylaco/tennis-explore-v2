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

const argv = process.argv.slice(2);

// adds to the existing index instead of building a new one. the reason it
// exists: a finished build deletes its checkpoint, so re-running to add two
// documents re-embeds all 2,599 files and takes hours. see buildIndex.
const append = argv.includes("--append");
// see the refusal in indexBuilder: synthetic chunks cannot be removed from an
// append-only shard, so letting them in has to be typed out on purpose.
const allowSynthetic = argv.includes("--allow-synthetic");
const sourceDirs = argv.filter((argument) => !argument.startsWith("--"));

if (sourceDirs.length === 0) {
  console.error("usage: node bin/build-index.js [--append] <folder> [more folders...]");
  console.error("  --append  add these files to the existing index rather than rebuilding it");
  console.error("  --allow-synthetic  let textract:seed --synthetic chunks into the index.");
  console.error("                     refused by default: shards are append-only and this");
  console.error("                     cannot be undone without a full rebuild.");
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
let lastFilePercent = -1;

try {
  const result = await buildIndex({
    sourceDirs,
    append,
    allowSynthetic,
    onProgress: (event) => {
      if (event.phase === "append") {
        console.log(
          `appending to an existing index: ${event.chunks.toLocaleString()} chunks from ` +
            `${event.files} files already there\n`,
        );
      } else if (event.phase === "duplicate") {
        // said out loud rather than skipped quietly. someone who expected this
        // file to be re-indexed needs to know it was not, and why.
        console.log(`  already in the index, skipping: ${event.file}`);
      } else if (event.phase === "resume") {
        console.log(
          `resuming an interrupted build: ${event.filesDone} files and ${event.chunks} chunks already done\n`,
        );
      } else if (event.phase === "scan") {
        console.log(
          `${event.files} readable files found` +
            (event.pending < event.files ? `, ${event.pending} still to do` : ""),
        );
      } else if (event.phase === "file") {
        const percent = Math.floor((event.done / event.total) * 100);

        if (percent !== lastFilePercent || event.done === event.total) {
          lastFilePercent = percent;

          const elapsed = (Date.now() - startedAt) / 1000;
          const rate = event.done / Math.max(elapsed, 0.1);
          const remaining = Math.round((event.total - event.done) / Math.max(rate, 0.001));

          process.stdout.write(
            `\r${event.done}/${event.total} files (${percent}%)  ` +
              `${event.chunks.toLocaleString()} chunks  ` +
              `~${formatDuration(remaining)} left`.padEnd(24),
          );
        }
      } else if (event.phase === "bm25") {
        if (event.done === undefined) {
          process.stdout.write(`\r${"".padEnd(78)}\rbuilding keyword index over ${event.chunks.toLocaleString()} chunks...`);
        }
      } else if (event.phase === "done") {
        process.stdout.write(`\r${"".padEnd(78)}\r`);
      }
    },
  });

  const seconds = (Date.now() - startedAt) / 1000;

  console.log(`\nindex built in ${formatDuration(seconds)}`);
  console.log(`  ${result.chunkCount.toLocaleString()} chunks from ${result.fileCount} files`);
  console.log(`  ${result.manifest.shards.length} shard(s), int8 quantised`);
  console.log(`  keyword index: ${result.manifest.bm25.vocabSize.toLocaleString()} terms, ${result.manifest.bm25.postings.toLocaleString()} postings`);

  if (result.skipped.length > 0) {
    console.log(`\n  ${result.skipped.length} file(s) skipped -- see ${retrievalConfig.index.dir}/build-report.json`);

    for (const item of result.skipped.slice(0, 5)) {
      console.log(`    ${item.file}: ${item.reason}`);
    }

    if (result.skipped.length > 5) console.log(`    ...and ${result.skipped.length - 5} more`);
  }

  if (result.problems.length > 0) {
    console.log(`\n  ${result.problems.length} chunk(s) failed schema v2 and were left out.`);
  }

  console.log(`\n  written to ${retrievalConfig.index.dir}/`);
  console.log(`\nnow try:  npm run search -- "serve load during tournaments"`);
} catch (error) {
  console.error(`\n\nbuild failed:\n${error.message}\n`);

  // an append run is not checkpointed -- saying it was would send someone
  // looking for a resume that cannot happen. see buildIndex.
  if (!append) {
    console.error("progress was checkpointed -- re-running this command resumes rather than starting over.\n");
  }
  process.exit(1);
}

function formatDuration(seconds) {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;

  return `${(seconds / 3600).toFixed(1)}h`;
}
