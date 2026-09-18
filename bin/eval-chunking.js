#!/usr/bin/env node
// the chunking-strategy evaluation (E2-07).
//
//   npm run eval:chunking                          # score every cell whose index exists
//   npm run eval:chunking -- --build               # build the missing cells first (needs ollama)
//   npm run eval:chunking -- --cells t800-o200-r1  # a subset
//   node bin/eval-chunking.js --check-questions    # only the ground-truth gate
//
// what it answers: for each file type, which chunking parameters should be the
// default -- with numbers from OUR corpus rather than a cited paper. fifteen
// questions, each with a verbatim answer span reviewed by a person before any
// setting was compared, scored as span recall@5 per cell.
//
// what it is not: bin/eval.js. that harness varies QUERY-TIME settings over one
// fixed index and scores at document level. this one varies the index itself,
// so each cell is its own build under data/index-eval/<cellId>, and the real
// data/index is never touched -- refused, not defaulted away from.
//
// scoring existing cells takes seconds. building does not, and needs ollama,
// so it never happens unless --build is passed: a harness that silently
// rebuilds is one nobody reruns while writing the report.

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// env.js insists on these at import time and the evaluation touches neither a
// port nor a database. supplied before anything below is imported.
process.env.PORT ||= "3000";
process.env.MONGODB_URI ||= "mongodb://unused-by-eval-chunking/db";
process.env.DOTENV_CONFIG_QUIET ||= "true";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const runner = path.join(here, "eval-chunking-run.js");

const { retrievalConfig } = await import("../src/config/retrieval.config.js");
const { extractFile } = await import("../src/modules/ingestion/extraction.service.js");
const {
  CELLS,
  DECISION_GAP_PP,
  TIE_BREAK_RULE,
  assertNotRealIndex,
  decide,
  evalIndexDirFor,
  summarise,
  validateQuestionSet,
  verifySpanInExtracted,
  spanOccurrences,
} = await import("../src/modules/evaluation/chunkingEval.service.js");

const QUESTIONS_PATH = "queries/chunking_questions.json";
const CORPUS_PATH = "queries/chunking_corpus.json";
const OUTPUT_PATH = "evidence/chunking_comparison.json";
const MARK = "<<<EVAL-CHUNKING>>>";

// ---- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const build = argv.includes("--build");
const checkOnly = argv.includes("--check-questions");
const cellsArg = argv.find((argument) => argument.startsWith("--cells"));

let selectedCells = CELLS;

if (cellsArg) {
  const list = cellsArg.includes("=") ? cellsArg.split("=")[1] : argv[argv.indexOf(cellsArg) + 1];
  const wanted = String(list ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const unknown = wanted.filter((id) => !CELLS.some((cell) => cell.id === id));

  if (wanted.length === 0 || unknown.length > 0) {
    console.error(`--cells needs a comma-separated list from: ${CELLS.map((cell) => cell.id).join(", ")}`);
    if (unknown.length > 0) console.error(`unknown: ${unknown.join(", ")}`);
    process.exit(2);
  }

  selectedCells = CELLS.filter((cell) => wanted.includes(cell.id));
}

// ---- preflight: corpus ---------------------------------------------------------

const corpusRoot = process.env.CHUNK_EVAL_CORPUS_ROOT;

if (!corpusRoot) {
  console.error(
    "CHUNK_EVAL_CORPUS_ROOT is not set. point it at the folder holding the files listed in " +
      `${CORPUS_PATH} (partner data, not committed), e.g.\n` +
      "  CHUNK_EVAL_CORPUS_ROOT=C:/IFN736-project/document-sources",
  );
  process.exit(2);
}

const corpus = JSON.parse(await fsp.readFile(CORPUS_PATH, "utf8"));
const questions = JSON.parse(await fsp.readFile(QUESTIONS_PATH, "utf8"));
const problems = [];

console.log(`\nchunking evaluation -- ${questions.length} questions over ${corpus.files.length} files\n`);
console.log(`corpus root: ${corpusRoot}`);

const seenHashes = new Map();

for (const file of corpus.files) {
  const full = path.join(corpusRoot, file.relPath);

  let bytes;

  try {
    bytes = await fsp.readFile(full);
  } catch {
    problems.push(`missing: ${file.relPath}`);
    continue;
  }

  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  if (bytes.length !== file.bytes) problems.push(`${file.relPath}: ${bytes.length} bytes, manifest says ${file.bytes}`);
  if (sha256 !== file.sha256) problems.push(`${file.relPath}: sha256 ${sha256.slice(0, 12)}..., manifest says ${file.sha256.slice(0, 12)}...`);

  // two byte-identical files break span uniqueness -- every question aimed at
  // one of them would hit both. match-data-example[74].csv is the live case.
  if (seenHashes.has(file.sha256)) {
    problems.push(`${file.relPath} is byte-identical to ${seenHashes.get(file.sha256)} (same sha256); only one may be listed`);
  }

  seenHashes.set(file.sha256, file.relPath);
}

if (problems.length > 0) {
  console.error(`\ncorpus preflight failed:\n${problems.map((line) => `  ${line}`).join("\n")}\n`);
  process.exit(1);
}

console.log(`corpus: ${corpus.files.length} files present, hashes match, no duplicates`);

// ---- preflight: the ground-truth gate --------------------------------------------
//
// runs before any index exists and depends on no chunking setting: extract each
// document, assert each span occurs exactly once in exactly one page (or one
// row) of the document it names, and nowhere else in the corpus. an `absent`
// span found here costs seconds; found after four builds it costs the builds.

const schemaProblems = validateQuestionSet(questions, corpus);

if (schemaProblems.length > 0) {
  console.error(`\nquestion set schema failed:\n${schemaProblems.map((line) => `  ${line}`).join("\n")}\n`);
  process.exit(1);
}

const extractedByDocId = new Map();

for (const file of corpus.files) {
  const extracted = await extractFile(path.join(corpusRoot, file.relPath));

  if (!extracted) {
    problems.push(`${file.relPath}: extractFile returned nothing`);
    continue;
  }

  extractedByDocId.set(file.docId, extracted);
}

const excluded = [];
const gate = [];

for (const question of questions) {
  const extracted = extractedByDocId.get(question.docId);
  const verdict = verifySpanInExtracted(question, extracted);

  // uniqueness across the whole corpus, not just the named document.
  const elsewhere = [...extractedByDocId.entries()]
    .filter(([docId]) => docId !== question.docId)
    .filter(([, other]) => spanOccurrences(other, question.answerSpan).length > 0)
    .map(([docId]) => docId);

  if (!verdict.ok) {
    excluded.push({ questionId: question.id, reason: verdict.reason, occurrences: verdict.occurrences });
  } else if (elsewhere.length > 0) {
    excluded.push({ questionId: question.id, reason: "not_unique_in_corpus", alsoIn: elsewhere });
  }

  gate.push({
    id: question.id,
    fileType: question.fileType,
    ok: verdict.ok && elsewhere.length === 0,
    where: verdict.ok ? (question.fileType === "records" ? `row ${verdict.row}` : `page ${verdict.page}`) : verdict.reason,
    elsewhere,
  });
}

console.log("\nground-truth gate (span found verbatim, exactly once, only in its own document):");

for (const row of gate) {
  console.log(`  ${row.ok ? "ok  " : "FAIL"} ${row.id}  ${row.fileType.padEnd(7)} ${row.where}${row.elsewhere.length ? `  also in: ${row.elsewhere.join(", ")}` : ""}`);
}

if (excluded.length > 0) {
  console.log(
    `\n!! ${excluded.length} question(s) EXCLUDED from every cell's denominator: ` +
      `${excluded.map((item) => `${item.questionId} (${item.reason})`).join(", ")}\n` +
      "!! fix the span in queries/chunking_questions.json -- an excluded question is a ground-truth error, not a chunking result.",
  );
} else {
  console.log("\nall spans verified. no question excluded.");
}

if (checkOnly) {
  process.exit(excluded.length > 0 ? 1 : 0);
}

// ---- cells: which exist, which need building ---------------------------------------

const cellState = [];

for (const cell of selectedCells) {
  const indexDir = evalIndexDirFor(cell.id);

  assertNotRealIndex(indexDir, { projectRoot });

  let manifest = null;

  try {
    manifest = JSON.parse(await fsp.readFile(path.join(indexDir, "manifest.json"), "utf8"));
  } catch {
    manifest = null;
  }

  // a directory named for one recipe holding an index built to another is
  // worse than a missing one. the name is the contract.
  if (manifest) {
    const built = manifest.chunking ?? {};
    const mismatch = [];

    if (built.targetChars !== cell.params.targetChars) mismatch.push(`targetChars ${built.targetChars}`);
    if (built.overlapChars !== cell.params.overlapChars) mismatch.push(`overlapChars ${built.overlapChars}`);
    if ((built.rowsPerChunk ?? 1) !== cell.params.rowsPerChunk) mismatch.push(`rowsPerChunk ${built.rowsPerChunk ?? 1}`);
    if (manifest.embeddingModel !== retrievalConfig.embedding.model) mismatch.push(`embeddingModel ${manifest.embeddingModel}`);
    if (manifest.embeddingProvider !== retrievalConfig.embedding.provider) mismatch.push(`embeddingProvider ${manifest.embeddingProvider}`);

    if (mismatch.length > 0) {
      console.error(
        `\n${indexDir} was built with ${mismatch.join(", ")}, which does not match its name or the current ` +
          `embedding config (${retrievalConfig.embedding.provider}/${retrievalConfig.embedding.model}). ` +
          `delete the directory and rebuild with --build.\n`,
      );
      process.exit(1);
    }
  }

  cellState.push({ cell, indexDir, exists: manifest !== null });
}

const missing = cellState.filter((state) => !state.exists);

if (missing.length > 0 && !build) {
  console.error(`\n${missing.length} cell index(es) missing. this harness never builds unless asked:\n`);
  console.error(`  npm run eval:chunking -- --build --cells ${missing.map((state) => state.cell.id).join(",")}\n`);
  console.error("  (needs ollama with the embedding model pulled; a few minutes per cell)\n");
  process.exit(1);
}

// ---- the pinned environment -------------------------------------------------------
//
// nothing is inherited that could change a result. every teammate's .env is
// different (TOP_N=16, RERANK_ENABLED=true, INDEX_DIR=data/index ...), so each
// child gets exactly this, and it is printed so a reader can check.

function envForCell(cell, extra = {}) {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    DOTENV_CONFIG_QUIET: "true",

    PORT: process.env.PORT,
    MONGODB_URI: process.env.MONGODB_URI,
    STORAGE_PROVIDER: "local",
    STRUCTURED_SOURCE_DIRS: "",

    // the embedding model must be the one the demo index uses, or the numbers
    // say nothing about the demo. taken from the loaded config, then pinned.
    OLLAMA_BASE_URL: retrievalConfig.embedding.baseUrl,
    EMBEDDING_PROVIDER: retrievalConfig.embedding.provider,
    EMBEDDING_MODEL: retrievalConfig.embedding.model,
    EMBEDDING_DIMENSION: String(retrievalConfig.embedding.dimension),
    EMBEDDING_BATCH_SIZE: String(retrievalConfig.embedding.batchSize ?? 16),

    INDEX_DIR: evalIndexDirFor(cell.id),
    CHUNK_EVAL_CORPUS_ROOT: corpusRoot,
    CHUNK_EVAL_QUESTIONS: QUESTIONS_PATH,
    CHUNK_EVAL_SKIP_IDS: excluded.map((item) => item.questionId).join(","),

    CHUNK_TARGET_CHARS: String(cell.params.targetChars),
    CHUNK_OVERLAP_CHARS: String(cell.params.overlapChars),
    CHUNK_MIN_CHARS: "120",
    CHUNK_ROWS_PER_CHUNK: String(cell.params.rowsPerChunk),
    CHUNK_RECORD_MAX_CHARS: "1400",
    CHUNK_FALLBACK_MIN_CHARS: "40",
    CHUNK_SLIDE_MIN_CHARS: "40",
    CHUNK_TABLE_HEADROOM_CHARS: "32",
    CONTEXTUAL_ENABLED: "true",
    CONTEXTUAL_MODE: "template",

    // hybrid rrf only. the llm reranker reorders the top 24 non-deterministically
    // and at n=15 that noise can exceed the chunking effect being measured.
    RERANK_ENABLED: "false",
    ROUTING_ENABLED: "false",
    HYDE_ENABLED: "false",
    DECOMPOSITION_ENABLED: "false",
    EXPANSION_ENABLED: "false",
    PLANNER_ENABLED: "false",
    TOP_N: "10",
    BM25_K: "50",
    DENSE_K: "50",
    RRF_K: "60",

    ...extra,
  };
}

const HIDDEN = new Set(["PATH", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE", "MONGODB_URI", "PORT", "DOTENV_CONFIG_QUIET"]);
const sample = envForCell(selectedCells[0]);

console.log("\nresolved child environment (per cell; INDEX_DIR and CHUNK_* vary by cell):");

for (const [key, value] of Object.entries(sample)) {
  if (!HIDDEN.has(key)) console.log(`  ${key}=${value}`);
}

// ---- spawning --------------------------------------------------------------------

function runChild(cell, mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, mode], {
      cwd: projectRoot,
      env: envForCell(cell),
      stdio: ["ignore", "pipe", "inherit"],
    });

    let out = "";

    child.stdout.on("data", (buffer) => {
      out += buffer.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${mode} for ${cell.id} exited with code ${code}`));
        return;
      }

      const parts = out.split(MARK);

      if (parts.length < 3) {
        reject(new Error(`${mode} for ${cell.id} printed no result:\n${out}`));
        return;
      }

      try {
        resolve(JSON.parse(parts[parts.length - 2]));
      } catch (error) {
        reject(new Error(`could not parse ${mode} result for ${cell.id}: ${error.message}`));
      }
    });
  });
}

async function directoryBytes(directory) {
  let total = 0;

  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    total += entry.isDirectory() ? await directoryBytes(full) : (await fsp.stat(full)).size;
  }

  return total;
}

// ---- build --------------------------------------------------------------------------

for (const state of missing) {
  console.log(`\nbuilding ${state.cell.id} -> ${state.indexDir}`);

  const result = await runChild(state.cell, "build");

  console.log(`  built: ${result.chunkCount} chunks from ${result.fileCount} files in ${result.buildSeconds}s`);

  if (result.skipped.length > 0) {
    console.log(`  skipped ${result.skipped.length} file(s): ${result.skipped.map((item) => `${item.file} (${item.reason})`).join("; ")}`);
  }
}

// ---- score ----------------------------------------------------------------------------

const cells = [];

for (const state of cellState) {
  console.log(`\nscoring ${state.cell.id}`);

  const result = await runChild(state.cell, "score");

  let buildInfo = null;

  try {
    buildInfo = JSON.parse(await fsp.readFile(path.join(state.indexDir, "eval-build.json"), "utf8"));
  } catch {
    buildInfo = null;
  }

  const chunkCountByModality = Object.fromEntries(
    Object.entries(result.chunkStats).map(([modality, stats]) => [modality, stats.chunkCount]),
  );

  cells.push({
    id: state.cell.id,
    params: state.cell.params,
    purpose: state.cell.purpose,
    rationale: state.cell.rationale,
    indexDir: state.indexDir,
    chunkCount: result.manifest.chunkCount,
    chunkCountByModality,
    chunkStats: result.chunkStats,
    indexBytes: await directoryBytes(state.indexDir),
    buildSeconds: buildInfo?.buildSeconds ?? null,
    builtAt: result.manifest.builtAt,
    manifestChunking: result.manifest.chunking,
    byFileType: summarise(result.perQuestion),
    perQuestion: result.perQuestion,
  });
}

// ---- the deterministic control -------------------------------------------------------
//
// targetChars never reaches chunkRecords, so t800-o200-r1 holds record chunks
// byte-identical to t1600-o200-r1's. the record chunk that CONTAINS each span
// must therefore be the same chunk id in both. ranks can legitimately shift by
// a place or two because bm25's corpus statistics (avgdl, df) differ between
// the two indexes -- that is reported, not hidden -- but a different chunk id
// would mean the harness, not the chunking, moved.

const byId = Object.fromEntries(cells.map((cell) => [cell.id, cell]));
let control = null;

if (byId["t1600-o200-r1"] && byId["t800-o200-r1"]) {
  const a = byId["t1600-o200-r1"].perQuestion.filter((row) => row.fileType === "records");
  const b = Object.fromEntries(byId["t800-o200-r1"].perQuestion.filter((row) => row.fileType === "records").map((row) => [row.id, row]));

  const differences = a
    .map((row) => ({ id: row.id, baseline: row, control: b[row.id] }))
    .filter(({ baseline, control: other }) => !other || baseline.outcome !== other.outcome || baseline.rank !== other.rank || baseline.chunkId !== other.chunkId)
    .map(({ id, baseline, control: other }) => ({
      id,
      baseline: { outcome: baseline.outcome, rank: baseline.rank, chunkId: baseline.chunkId },
      control: other ? { outcome: other.outcome, rank: other.rank, chunkId: other.chunkId } : null,
    }));

  const sameChunk = differences.every((diff) => diff.control && diff.baseline.chunkId === diff.control.chunkId);

  control = {
    cells: ["t1600-o200-r1", "t800-o200-r1"],
    identicalOutcomesAndRanks: differences.length === 0,
    sameSpanChunkIds: sameChunk,
    differences,
    note:
      "record chunks are byte-identical between these two cells. identical outcomes and ranks are " +
      "expected; a rank shift with the same chunk id is explainable by bm25 corpus statistics " +
      "differing with the prose chunking; a different chunk id is a harness defect.",
  };

  console.log(
    `\ndeterministic control (records, t1600-o200-r1 vs t800-o200-r1): ` +
      (differences.length === 0 ? "identical" : `${differences.length} difference(s)${sameChunk ? " (same chunk ids, ranks moved)" : " -- DIFFERENT CHUNK IDS, harness defect"}`),
  );
}

// ---- decisions -------------------------------------------------------------------------

const COMPARISONS = [
  { fileType: "prose", parameter: "targetChars", baseline: "t1600-o200-r1", challenger: "t800-o200-r1" },
  { fileType: "prose", parameter: "overlapChars", baseline: "t1600-o200-r1", challenger: "t1600-o0-r1" },
  { fileType: "records", parameter: "rowsPerChunk", baseline: "t1600-o200-r1", challenger: "t1600-o200-r5" },
  // the combination check. two variables at once, so it says whether the two
  // single-variable wins survive together -- not which one earned it.
  { fileType: "prose", parameter: "targetChars+overlapChars", baseline: "t1600-o200-r1", challenger: "t800-o0-r1" },
];

const decisions = COMPARISONS.filter((c) => byId[c.baseline] && byId[c.challenger]).map((c) =>
  decide({ fileType: c.fileType, parameter: c.parameter, baseline: byId[c.baseline], challenger: byId[c.challenger] }),
);

// ---- print ------------------------------------------------------------------------------

const pct = (r) => (r?.value === null || r?.value === undefined ? "   -   " : `${(r.value * 100).toFixed(0).padStart(3)}% ${`${r.k}/${r.n}`.padStart(5)}`);
const num = (v) => (v === null || v === undefined ? "  -  " : v.toFixed(3));

console.log(`\n${"cell".padEnd(16)}${"prose r@5".padEnd(12)}${"prose r@10".padEnd(12)}${"prose mrr".padEnd(11)}${"rec r@5".padEnd(12)}${"rec r@10".padEnd(12)}${"rec mrr".padEnd(11)}chunks   bytes`);
console.log("-".repeat(110));

for (const cell of cells) {
  const p = cell.byFileType.prose;
  const r = cell.byFileType.records;

  console.log(
    `${cell.id.padEnd(16)}${pct(p.recall5).padEnd(12)}${pct(p.recall10).padEnd(12)}${num(p.spanMrr).padEnd(11)}` +
      `${pct(r.recall5).padEnd(12)}${pct(r.recall10).padEnd(12)}${num(r.spanMrr).padEnd(11)}` +
      `${String(cell.chunkCount).padStart(6)}  ${cell.indexBytes.toLocaleString()}`,
  );
}

console.log("\noutcomes per cell (prose | records): intact_retrieved / intact_not_retrieved / not_intact_anywhere");

for (const cell of cells) {
  const o = (t) => `${t.outcomes.intact_retrieved}/${t.outcomes.intact_not_retrieved}/${t.outcomes.not_intact_anywhere}`;

  console.log(`  ${cell.id.padEnd(16)} ${o(cell.byFileType.prose).padEnd(10)} | ${o(cell.byFileType.records)}`);
}

if (decisions.length > 0) {
  console.log("\ndecisions (pre-registered tie-break rule):");

  for (const decision of decisions) {
    console.log(`  ${decision.fileType.padEnd(8)} ${decision.parameter.padEnd(13)} -> ${decision.winner.padEnd(14)} [${decision.tieBrokenAt}] ${decision.reason}`);
  }
}

// ---- write -------------------------------------------------------------------------------

let gitCommit = null;

try {
  gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
} catch {
  gitCommit = null;
}

let ollamaVersion = null;

try {
  const response = await fetch(`${retrievalConfig.embedding.baseUrl}/api/version`);

  ollamaVersion = (await response.json()).version ?? null;
} catch {
  ollamaVersion = null;
}

const questionsRaw = await fsp.readFile(QUESTIONS_PATH);

const output = {
  generatedAt: new Date().toISOString(),
  gitCommit,
  node: process.version,
  embedding: {
    provider: retrievalConfig.embedding.provider,
    model: retrievalConfig.embedding.model,
    dimension: retrievalConfig.embedding.dimension,
    ollamaVersion,
  },
  retrievalSetting: {
    mode: "hybrid rrf, reranker off",
    why:
      "the llm reranker reorders the top 24 into the top 10 non-deterministically; at n=15 that " +
      "noise can exceed the chunking effect under measurement. routing, decomposition, hyde and " +
      "expansion are off for the same reason: one variable per comparison.",
    env: Object.fromEntries(Object.entries(sample).filter(([key]) => !HIDDEN.has(key) && !key.startsWith("INDEX_DIR"))),
  },
  corpus: {
    manifest: CORPUS_PATH,
    corpusRoot,
    fileCount: corpus.files.length,
    files: corpus.files.map(({ relPath, docId, fileType, sha256, bytes, rowCount, pageCount }) => ({ relPath, docId, fileType, sha256, bytes, rowCount, pageCount })),
    scope:
      "prose = pdf only in practice: the corpus root holds no .txt/.md, .docx is unsupported by " +
      "extractFile, and there are no .pptx so chunkSlides (slideMinChars) is not evaluated. pdfs " +
      "with textract tables are excluded because chunkTables' budget also depends on targetChars.",
  },
  questionSet: {
    path: QUESTIONS_PATH,
    sha256: crypto.createHash("sha256").update(questionsRaw).digest("hex"),
    count: questions.length,
    byFileType: Object.fromEntries(["prose", "records"].map((t) => [t, questions.filter((q) => q.fileType === t).length])),
    spanRules: {
      minChars: 40,
      maxChars: 180,
      why: "<= overlapChars (200) so a span straddling a boundary is rescued whole under any overlapping setting",
    },
    gate,
  },
  tieBreakRule: TIE_BREAK_RULE,
  decisionGapPp: DECISION_GAP_PP,
  excluded,
  knownConfounds: [
    "minChars is applied after the overlap tail is prepended (chunking.service.js, splitText's final filter), so a short trailing fragment survives at overlap=200 and is dropped at overlap=0; the overlap cell biases against overlap=0 by removing content.",
    "bm25 corpus statistics differ between cells because the prose chunk population differs; record-question ranks in the control pair may shift by a place for that reason alone.",
    "authors.slice(0, 3) and detectSection's slice(0, 200) are not per-file-type and were deliberately left hardcoded; both feed context_header and therefore the vectors, but are outside the append guard.",
    "STRUCTURED_SOURCE_DIRS / manifest.sourceDirs affect answerFromTables, not retrieve(); the records arm here goes through retrieve() and is unaffected.",
  ],
  control,
  cells,
  decisions,
};

await fsp.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fsp.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

console.log(`\nwritten to ${OUTPUT_PATH}\n`);
