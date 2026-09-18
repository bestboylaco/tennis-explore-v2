#!/usr/bin/env node
// runs ONE cell of the chunking evaluation (E2-07) and prints one fenced json
// payload. not meant to be called by hand -- bin/eval-chunking.js spawns this,
// once to build a cell's index and once to score it.
//
//   node bin/eval-chunking-run.js build    # buildIndex into INDEX_DIR
//   node bin/eval-chunking-run.js score    # retrieve every question against it
//
// why a separate process, same as bin/eval-run.js: retrieval.config.js freezes
// its values on first import and retrieve() calls loadIndex() with no
// arguments, so neither CHUNK_* nor INDEX_DIR can change inside one process.
// the parent pins the whole environment for each spawn and prints it.

import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  assertNotRealIndex,
  classifyOutcome,
} from "../src/modules/evaluation/chunkingEval.service.js";

const MARK = "<<<EVAL-CHUNKING>>>";
const mode = process.argv[2];

function emit(payload) {
  process.stdout.write(`${MARK}${JSON.stringify(payload)}${MARK}\n`);
}

function log(line) {
  process.stderr.write(`${line}\n`);
}

if (mode !== "build" && mode !== "score") {
  log("usage: node bin/eval-chunking-run.js <build|score>  (spawned by bin/eval-chunking.js)");
  process.exit(2);
}

// the guard runs in the child as well as the parent. a child is the process
// that actually opens the writer, so it is the one that must refuse.
const indexDir = assertNotRealIndex(process.env.INDEX_DIR);

const corpusRoot = process.env.CHUNK_EVAL_CORPUS_ROOT;

if (!corpusRoot) {
  log("CHUNK_EVAL_CORPUS_ROOT is not set.");
  process.exit(2);
}

const corpus = JSON.parse(await fsp.readFile("queries/chunking_corpus.json", "utf8"));
const files = corpus.files.map((file) => path.join(corpusRoot, file.relPath));

if (mode === "build") {
  const { checkEmbeddingProvider } = await import("../src/modules/ingestion/embedding.service.js");
  const { buildIndex } = await import("../src/modules/ingestion/indexBuilder.service.js");

  const check = await checkEmbeddingProvider();

  if (!check.ok) {
    log(`cannot reach the embedding model: ${check.error}`);
    process.exit(3);
  }

  // rebuilt from nothing every time. a cell directory is named by its recipe,
  // so a half-finished one from an interrupted run is worth nothing.
  await fsp.rm(indexDir, { recursive: true, force: true });
  await fsp.mkdir(indexDir, { recursive: true });

  const startedAt = Date.now();
  let lastReported = 0;

  const result = await buildIndex({
    sourceDirs: files,
    outputDir: indexDir,
    resume: false,
    onProgress: (event) => {
      if (event.phase === "file" && (event.done - lastReported >= 5 || event.done === event.total)) {
        lastReported = event.done;
        log(`    ${event.done}/${event.total} files, ${event.chunks} chunks`);
      } else if (event.phase === "bm25" && event.done === undefined) {
        log(`    building keyword index over ${event.chunks} chunks`);
      }
    },
  });

  const buildSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));

  await fsp.writeFile(
    path.join(indexDir, "eval-build.json"),
    `${JSON.stringify({ builtAt: new Date().toISOString(), buildSeconds, chunkCount: result.chunkCount, fileCount: result.fileCount, skipped: result.skipped }, null, 2)}\n`,
  );

  emit({
    chunkCount: result.chunkCount,
    fileCount: result.fileCount,
    buildSeconds,
    skipped: result.skipped,
    schemaFailures: result.problems.length,
  });

  process.exit(0);
}

// ---- score ------------------------------------------------------------------

const { loadIndex, retrieve } = await import("../src/modules/retrieval/retrieval.service.js");

const questions = JSON.parse(await fsp.readFile(process.env.CHUNK_EVAL_QUESTIONS, "utf8"));
const skip = new Set((process.env.CHUNK_EVAL_SKIP_IDS ?? "").split(",").filter(Boolean));
const topN = Number(process.env.TOP_N ?? 10);
const k = 5;

const index = await loadIndex();
const { store } = index;

// chunk statistics per modality. a packed record chunk has no character cap on
// purpose, so mean/max chunk chars is how that cost is reported.
const stats = {};

for (const chunk of store.chunks) {
  const modality = chunk.modality ?? "unknown";
  const entry = (stats[modality] ??= { chunkCount: 0, totalChars: 0, maxChunkChars: 0 });
  const length = (chunk.text ?? "").length;

  entry.chunkCount += 1;
  entry.totalChars += length;
  entry.maxChunkChars = Math.max(entry.maxChunkChars, length);
}

for (const entry of Object.values(stats)) {
  entry.meanChunkChars = Math.round(entry.totalChars / Math.max(entry.chunkCount, 1));
  delete entry.totalChars;
}

const perQuestion = [];

for (const question of questions) {
  if (skip.has(question.id)) continue;

  const startedAt = Date.now();
  const result = await retrieve(question.query, { roleId: question.role ?? "admin", topN });
  const retrieved = result.evidence;
  const docChunks = store.chunks.filter((chunk) => chunk.doc_id === question.docId);
  const docRankIndex = retrieved.findIndex((chunk) => chunk.doc_id === question.docId);

  const classified = classifyOutcome({
    spanInSource: true,
    retrieved,
    docChunks,
    span: question.answerSpan,
    k,
  });

  perQuestion.push({
    id: question.id,
    fileType: question.fileType,
    docId: question.docId,
    ...classified,
    docRank: docRankIndex === -1 ? null : docRankIndex + 1,
    docChunkCount: docChunks.length,
    top5: retrieved.slice(0, k).map((chunk) => chunk.chunk_id),
    ms: Date.now() - startedAt,
  });

  log(`    ${question.id}  ${classified.outcome.padEnd(22)} rank ${classified.rank ?? "-"}`);
}

emit({
  manifest: {
    chunking: store.manifest.chunking,
    embeddingProvider: store.manifest.embeddingProvider,
    embeddingModel: store.manifest.embeddingModel,
    dimension: store.manifest.dimension,
    contextual: store.manifest.contextual,
    chunkCount: store.manifest.chunkCount,
    fileCount: store.manifest.fileCount,
    builtAt: store.manifest.builtAt,
  },
  chunkStats: stats,
  perQuestion,
});
