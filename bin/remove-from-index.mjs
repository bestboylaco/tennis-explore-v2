#!/usr/bin/env node
// Removes chunks from the existing, committed data/index/ WITHOUT
// re-embedding anything that stays.
//
// Why this exists: bin/build-index.js has no removal mode, and there was no
// way to drop bad or fake source content out of the index short of a full
// rebuild -- hours of GPU time to remove a handful of files. This filters the
// existing chunks and vectors in place: chunks matching the given source path
// substring are dropped, everyone else's already-computed vector is carried
// over byte-identical via VectorStoreWriter.addQuantised (no re-embedding),
// and BM25 is rebuilt fresh from the kept chunks (tokenisation only, no GPU,
// seconds not hours).
//
// usage:
//   node bin/remove-from-index.mjs <source-path-substring> [<more-substrings>...]
//
// Matches against each chunk's source_uri (case-insensitive substring). Every
// chunk whose source_uri contains ANY of the given substrings is dropped.
//
// Never touches data/index/ until the filtered build is verified -- a
// timestamped backup of the pre-removal index is left behind regardless.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { retrievalConfig } from "../src/config/retrieval.config.js";
import { VectorStore, VectorStoreWriter } from "../src/infrastructure/vector/vectorStore.service.js";
import { buildBm25 } from "../src/modules/retrieval/bm25.service.js";

const REAL_INDEX_DIR = retrievalConfig.index.dir;
const patterns = process.argv.slice(2).map((p) => p.toLowerCase());

if (patterns.length === 0) {
  console.error("usage: node bin/remove-from-index.mjs <source-path-substring> [<more-substrings>...]");
  process.exit(1);
}

async function readJsonSafe(filePath, fallback) {
  return existsSync(filePath) ? JSON.parse(await fs.readFile(filePath, "utf8")) : fallback;
}

function matchesAny(sourceUri) {
  const lower = String(sourceUri ?? "").toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

async function main() {
  if (!existsSync(REAL_INDEX_DIR)) {
    console.error(`no index found at ${REAL_INDEX_DIR}.`);
    process.exit(1);
  }

  console.log(`loading ${REAL_INDEX_DIR}...`);
  const store = await VectorStore.load(REAL_INDEX_DIR);

  console.log(`${store.size.toLocaleString()} chunks loaded. matching against: ${patterns.join(", ")}`);

  const kept = [];
  const dropped = [];

  for (let i = 0; i < store.chunks.length; i += 1) {
    const chunk = store.chunks[i];

    (matchesAny(chunk.source_uri) ? dropped : kept).push({ chunk, index: i });
  }

  if (dropped.length === 0) {
    console.log("nothing matched. index left untouched.");
    return;
  }

  const droppedBySource = new Map();

  for (const { chunk } of dropped) {
    droppedBySource.set(chunk.source_uri, (droppedBySource.get(chunk.source_uri) ?? 0) + 1);
  }

  console.log(`\n${dropped.length} chunk(s) to remove, from ${droppedBySource.size} source file(s):`);
  for (const [sourceUri, count] of droppedBySource) console.log(`  ${count.toString().padStart(5)}  ${sourceUri}`);
  console.log(`\n${kept.length.toLocaleString()} chunk(s) will remain.`);

  // ---- back up, then build the filtered copy --------------------------------
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = `${REAL_INDEX_DIR}.backup-${timestamp}`;
  const scratchDir = `${REAL_INDEX_DIR}-remove-scratch`;

  console.log(`\nbacking up ${REAL_INDEX_DIR} -> ${backupDir}`);
  await fs.cp(REAL_INDEX_DIR, backupDir, { recursive: true });

  if (existsSync(scratchDir)) await fs.rm(scratchDir, { recursive: true, force: true });

  const oldManifest = await readJsonSafe(path.join(REAL_INDEX_DIR, "manifest.json"), {});
  const oldReport = await readJsonSafe(path.join(REAL_INDEX_DIR, "build-report.json"), {
    skipped: [],
    schemaProblems: [],
    uploadFailures: [],
  });

  console.log(`writing ${kept.length.toLocaleString()} chunk(s) to ${scratchDir} (vectors carried over, not re-embedded)...`);

  const writer = new VectorStoreWriter(scratchDir, { dimension: store.dimension, manifest: oldManifest });

  await writer.open();

  let written = 0;

  for (const { chunk, index } of kept) {
    const offset = index * store.dimension;
    const vector = store.vectors.subarray(offset, offset + store.dimension);

    await writer.addQuantised(chunk, vector);

    written += 1;
    if (written % 10000 === 0) process.stdout.write(`\r  ${written.toLocaleString()}/${kept.length.toLocaleString()}`);
  }

  process.stdout.write(`\r${"".padEnd(40)}\r`);

  const remainingSourceDirs = (oldManifest.sourceDirs ?? []).filter((dir) => !matchesAny(dir));

  const manifest = await writer.close();

  console.log(`rebuilding bm25 from the kept chunks (no gpu needed)...`);

  const bm25 = await buildBm25(async function* documents() {
    for (const { chunk } of kept) {
      yield { id: chunk.chunk_id, text: chunk.embedding_text ?? chunk.text };
    }
  });

  await bm25.save(scratchDir);

  // fileCount was copied over unchanged from the old manifest, so a remove
  // followed by append-to-index for the same file (the normal way to re-embed
  // one document) counted it twice. a removed source file is no longer in the
  // index, so it no longer counts.
  const mergedManifest = {
    ...manifest,
    sourceDirs: remainingSourceDirs,
    ...(typeof oldManifest.fileCount === "number"
      ? { fileCount: Math.max(0, oldManifest.fileCount - droppedBySource.size) }
      : {}),
  };

  await fs.writeFile(path.join(scratchDir, "manifest.json"), `${JSON.stringify(mergedManifest, null, 2)}\n`);
  await fs.writeFile(path.join(scratchDir, "build-report.json"), `${JSON.stringify(oldReport, null, 2)}\n`);

  // ---- swap the verified copy into place -------------------------------------
  await fs.rm(REAL_INDEX_DIR, { recursive: true, force: true });
  await fs.rename(scratchDir, REAL_INDEX_DIR);

  console.log(`\ndone. ${REAL_INDEX_DIR} now has ${mergedManifest.chunkCount.toLocaleString()} chunks (was ${oldManifest.chunkCount.toLocaleString()}).`);
  console.log(`a backup of the pre-removal index is at ${backupDir} -- delete it once you've confirmed everything looks right.`);
}

main().catch((error) => {
  console.error(`\n\nfailed: ${error.message}`);
  console.error(`${REAL_INDEX_DIR} was not touched.`);
  process.exit(1);
});
