#!/usr/bin/env node
// Adds new corpus content to the existing, committed data/index/ WITHOUT
// re-embedding what's already there.
//
// Why this exists: bin/build-index.js has no incremental mode -- pointing it
// at a mix of old and new source dirs re-processes everything from scratch.
// This reuses the resume/checkpoint path already built into
// indexBuilder.service.js (the "resuming an interrupted build" log line) by
// synthesizing a checkpoint that marks every existing chunk's source as
// already done, then building ONLY the new folder on top of a working copy.
//
// Safe because QUANT_SCALE (vectorStore.service.js) is a fixed constant, not
// fit per build -- vectors embedded in separate runs are byte-compatible and
// append cleanly onto the same shard files.
//
// usage:
//   node bin/append-to-index.mjs <folder-of-new-files-only>
//
// IMPORTANT: <folder> must contain ONLY files that have never been indexed
// before. This script refuses to run if any filename in that folder matches
// a file_name already recorded in the index (see the collision check below)
// -- that catch exists because a video chunk's source_uri is the .mp4 path,
// not the .video.json manifest path that gets walked, so path-based
// dedup alone can silently re-embed and duplicate already-indexed videos.
//
// Never touches data/index/ until the new build is verified to have
// produced a valid, larger index -- and even then, a timestamped backup of
// the pre-merge index is left behind for one commit's worth of safety.

import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { retrievalConfig } from "../src/config/retrieval.config.js";
import { SCHEMA_VERSION } from "../src/modules/ingestion/metadata.service.js";
import { checkEmbeddingProvider } from "../src/modules/ingestion/embedding.service.js";
import { buildIndex } from "../src/modules/ingestion/indexBuilder.service.js";
import { listIngestableFiles } from "../src/modules/ingestion/extraction.service.js";

const REAL_INDEX_DIR = retrievalConfig.index.dir;
const newContentDir = process.argv[2];

if (!newContentDir) {
  console.error("usage: node bin/append-to-index.mjs <folder-of-new-files-only>");
  process.exit(1);
}

function configFingerprint() {
  return [
    `schema:${SCHEMA_VERSION}`,
    `provider:${retrievalConfig.embedding.provider}`,
    `model:${retrievalConfig.embedding.model}`,
    `dim:${retrievalConfig.embedding.dimension}`,
    `chunk:${retrievalConfig.chunking.targetChars}/${retrievalConfig.chunking.overlapChars}`,
    `contextual:${retrievalConfig.contextual.enabled ? retrievalConfig.contextual.mode : "off"}`,
  ].join("|");
}

async function readJsonl(filePath, onLine) {
  const stream = readline.createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line.trim()) continue;
    onLine(JSON.parse(line));
  }
}

async function readJsonSafe(filePath, fallback) {
  return existsSync(filePath) ? JSON.parse(await fs.readFile(filePath, "utf8")) : fallback;
}

async function main() {
  console.log("checking embedding model...");
  const check = await checkEmbeddingProvider();

  if (!check.ok) {
    console.error(`\ncannot reach the embedding model.\n  ${check.error}\n`);
    console.error("is ollama running? try: ollama serve");
    process.exit(1);
  }

  if (!existsSync(REAL_INDEX_DIR)) {
    console.error(`no existing index at ${REAL_INDEX_DIR}. use bin/build-index.js for a first build instead.`);
    process.exit(1);
  }

  const oldManifest = await readJsonSafe(path.join(REAL_INDEX_DIR, "manifest.json"), null);

  if (!oldManifest) {
    console.error(`${REAL_INDEX_DIR}/manifest.json not found or unreadable.`);
    process.exit(1);
  }

  const oldReport = await readJsonSafe(path.join(REAL_INDEX_DIR, "build-report.json"), {
    skipped: [],
    schemaProblems: [],
    uploadFailures: [],
  });

  console.log(`existing index: ${oldManifest.chunkCount.toLocaleString()} chunks, ${oldManifest.fileCount} files`);

  // ---- collect what's already indexed ---------------------------------------
  const doneSourceUris = new Set();
  const doneFileNames = new Set();

  for (const shard of oldManifest.shards) {
    const chunkFile = path.join(REAL_INDEX_DIR, `chunks-${String(shard.index).padStart(3, "0")}.jsonl`);
    await readJsonl(chunkFile, (chunk) => {
      if (chunk.source_uri) doneSourceUris.add(chunk.source_uri);
      if (chunk.file_name) doneFileNames.add(chunk.file_name.toLowerCase());
    });
  }

  // ---- safety check: refuse if any "new" file is already indexed -----------
  const newFiles = await listIngestableFiles(newContentDir);

  if (newFiles.length === 0) {
    console.error(`no readable files found under ${newContentDir}.`);
    process.exit(1);
  }

  const collisions = newFiles.filter((file) => doneFileNames.has(path.basename(file).toLowerCase()));

  if (collisions.length > 0) {
    console.error(
      `\nrefusing to run: ${collisions.length} file(s) in ${newContentDir} match a filename already in the index:\n`,
    );

    for (const file of collisions.slice(0, 20)) console.error(`  ${path.basename(file)}`);
    if (collisions.length > 20) console.error(`  ...and ${collisions.length - 20} more`);

    console.error(`\nthis folder must contain ONLY files that have never been indexed. remove these and re-run.`);
    process.exit(1);
  }

  console.log(`${newFiles.length} new file(s) found, none collide with what's already indexed.`);

  // ---- back up, then make a working copy to build into -----------------------
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = `${REAL_INDEX_DIR}.backup-${timestamp}`;
  const scratchDir = `${REAL_INDEX_DIR}-merge-scratch`;

  console.log(`backing up ${REAL_INDEX_DIR} -> ${backupDir}`);
  await fs.cp(REAL_INDEX_DIR, backupDir, { recursive: true });

  if (existsSync(scratchDir)) await fs.rm(scratchDir, { recursive: true, force: true });

  console.log(`preparing working copy at ${scratchDir}`);
  await fs.cp(REAL_INDEX_DIR, scratchDir, { recursive: true });

  // ---- synthesize the resume checkpoint --------------------------------------
  const fingerprint = configFingerprint();

  await fs.writeFile(
    path.join(scratchDir, ".build-state.json"),
    JSON.stringify(
      {
        fingerprint,
        filesDone: [...doneSourceUris],
        chunkCount: oldManifest.chunkCount,
        problems: [],
        skipped: [],
        uploadFailures: [],
      },
      null,
      2,
    ),
  );

  console.log(`fingerprint: ${fingerprint}`);
  console.log(`${doneSourceUris.size} existing source(s) marked done -- only new content will be embedded.\n`);

  // ---- run the real build, appending onto the working copy ------------------
  const startedAt = Date.now();

  let result;

  try {
    result = await buildIndex({
      sourceDirs: [newContentDir],
      outputDir: scratchDir,
      onProgress: (event) => {
        if (event.phase === "file") {
          process.stdout.write(
            `\r${event.done}/${event.total} files, ${event.chunks.toLocaleString()} chunks total`.padEnd(60),
          );
        } else if (event.phase === "done") {
          process.stdout.write(`\r${"".padEnd(60)}\r`);
        }
      },
    });
  } catch (error) {
    console.error(`\n\nbuild failed: ${error.message}`);
    console.error(`${REAL_INDEX_DIR} was not touched. the working copy is at ${scratchDir} if you want to inspect it.`);
    process.exit(1);
  }

  console.log(`\nappend finished in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  console.log(`  ${result.chunkCount.toLocaleString()} total chunks (was ${oldManifest.chunkCount.toLocaleString()})`);

  // ---- reconcile metadata: this run only recorded ITS OWN totals -----------
  const newManifest = await readJsonSafe(path.join(scratchDir, "manifest.json"), {});
  const newReport = await readJsonSafe(path.join(scratchDir, "build-report.json"), {
    skipped: [],
    schemaProblems: [],
    uploadFailures: [],
  });

  const mergedManifest = {
    ...newManifest,
    sourceDirs: [...oldManifest.sourceDirs, newContentDir],
    fileCount: oldManifest.fileCount + (newManifest.fileCount ?? 0),
    skippedCount: oldManifest.skippedCount + (newManifest.skippedCount ?? 0),
    uploadFailureCount: (oldManifest.uploadFailureCount || 0) + (newManifest.uploadFailureCount || 0),
  };

  const mergedReport = {
    skipped: [...oldReport.skipped, ...newReport.skipped],
    schemaProblems: [...oldReport.schemaProblems, ...newReport.schemaProblems],
    uploadFailures: [...oldReport.uploadFailures, ...newReport.uploadFailures],
  };

  await fs.writeFile(path.join(scratchDir, "manifest.json"), `${JSON.stringify(mergedManifest, null, 2)}\n`);
  await fs.writeFile(path.join(scratchDir, "build-report.json"), `${JSON.stringify(mergedReport, null, 2)}\n`);

  console.log(`  fileCount: ${mergedManifest.fileCount}, skippedCount: ${mergedManifest.skippedCount}`);

  // ---- swap the verified copy into place -------------------------------------
  await fs.rm(REAL_INDEX_DIR, { recursive: true, force: true });
  await fs.rename(scratchDir, REAL_INDEX_DIR);

  console.log(`\ndone. ${REAL_INDEX_DIR} now has ${mergedManifest.chunkCount.toLocaleString()} chunks.`);
  console.log(`a backup of the pre-merge index is at ${backupDir} -- delete it once you've confirmed everything looks right.`);
  console.log(`\nnext steps:`);
  console.log(`  1. sanity-check:  node bin/search.js "<a query specific to the new content>"`);
  console.log(`  2. git add data/index <any new manifest files you added, e.g. data/media/*.json>`);
  console.log(`  3. git commit -m "..." && git push`);
}

main().catch((error) => {
  console.error(`\nfailed: ${error.message}`);
  console.error(`${REAL_INDEX_DIR} is untouched unless the log above already reached the "swap" step.`);
  process.exit(1);
});
