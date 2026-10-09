#!/usr/bin/env node
// E2-08 evidence: builds a small de-identified index from real partner data and
// then looks for the names it was built from -- by keyword search, and by
// reading every byte of every file the build wrote.
//
//   DEID_SECRET=<at least 16 chars> npm run eval:deid
//   DEID_SECRET=... npm run eval:deid -- path/to/a.pdf path/to/folder-of-pdfs
//
// what goes in:
//   tables  the DEID_DEMO_MAX_TABLES smallest csv/xlsx under STRUCTURED_SOURCE_DIRS
//           (default 2 -- the match export and one ITF ranking week).
//   pdfs    the paths given on the command line, or, with none, the
//           DEID_DEMO_PDFS (default 4) pdfs with the most full-name mentions out
//           of an evenly spaced sample of DEID_DEMO_PDF_SCAN (default 200) under
//           CHUNK_EVAL_CORPUS_ROOT. chosen that way so the demo exercises free
//           text, not just columns.
//   names   the dictionary is built from ALL of STRUCTURED_SOURCE_DIRS (via
//           DEID_DICTIONARY_DIRS), not just the tables indexed here.
//
// where it goes: data/index-deid-demo/ (gitignored, rebuilt every run, refused
// if it ever resolves to the real data/index) and evidence/e2-08_deidentification.json.
//
// the evidence file holds NO raw names. a probe is identified by its index and
// the sha256 of its normalised form, so the result can be committed and checked
// by anyone who already knows a name, without publishing the list.
//
// embeddings default to the offline "hash" provider. every probe here is
// lexical -- bm25 and a byte scan -- so vector quality cannot change a result,
// and hash keeps the build to seconds instead of an hour of ollama.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(projectRoot, "evidence", "e2-08_deidentification.json");

// pinned BEFORE dotenv, which never overrides a variable already set. .env
// holds INDEX_DIR=data/index and EMBEDDING_PROVIDER=ollama for the real app,
// and neither may reach this script.
process.env.INDEX_DIR = process.env.DEID_DEMO_INDEX_DIR || "data/index-deid-demo";
process.env.EMBEDDING_PROVIDER = process.env.DEID_DEMO_EMBEDDING_PROVIDER || "hash";

dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

process.env.DEID_ENABLED ||= "true";

if (process.env.DEID_ENABLED !== "true") {
  console.error("eval:deid measures de-identification -- it cannot run with DEID_ENABLED other than true.");
  process.exit(1);
}

if (!process.env.DEID_SECRET) {
  console.error("DEID_SECRET is not set. set it (16+ characters) in the shell or .env and re-run.");
  process.exit(1);
}

process.env.DEID_DICTIONARY_DIRS ||= process.env.STRUCTURED_SOURCE_DIRS || "";

const { retrievalConfig } = await import("../src/config/retrieval.config.js");
const { assertNotRealIndex } = await import("../src/modules/evaluation/chunkingEval.service.js");
const { buildIndex, dictionarySourceDirs } = await import("../src/modules/ingestion/indexBuilder.service.js");
const { extractFile, listIngestableFiles } = await import("../src/modules/ingestion/extraction.service.js");
const { buildDictionary, canonicalDeidentification, keyIdFor, nameTokens, replaceNames } = await import(
  "../src/modules/ingestion/deidentification.service.js"
);
const { VectorStore } = await import("../src/infrastructure/vector/vectorStore.service.js");
const { BM25Index } = await import("../src/modules/retrieval/bm25.service.js");

const deid = retrievalConfig.deidentification;
const indexDir = assertNotRealIndex(process.env.INDEX_DIR, { projectRoot });

const intEnv = (name, fallback) => {
  const value = Number(process.env[name]);

  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const MAX_TABLES = intEnv("DEID_DEMO_MAX_TABLES", 2);
const MAX_PDFS = intEnv("DEID_DEMO_PDFS", 4);
const PDF_SCAN = intEnv("DEID_DEMO_PDF_SCAN", 200);
const PROBES = intEnv("DEID_DEMO_PROBES", 10);

const splitDirs = (value) =>
  String(value || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

const structuredDirs = splitDirs(process.env.STRUCTURED_SOURCE_DIRS);

if (structuredDirs.length === 0) {
  console.error("STRUCTURED_SOURCE_DIRS is not set -- it is where the athlete names come from.");
  process.exit(1);
}

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const isMultiWord = (text) => nameTokens(text).length > 1;

// ---------------------------------------------------------------------------
// the dictionary, exactly as the build will make it
// ---------------------------------------------------------------------------

console.log("building the name dictionary...");

const dictionary = await buildDictionary(dictionarySourceDirs(structuredDirs));

console.log(`  ${dictionary.personCount.toLocaleString()} distinct names, key ${dictionary.keyId}`);

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

const tableFiles = [];

for (const directory of structuredDirs) {
  for (const file of await listIngestableFiles(directory)) {
    if ([".csv", ".xlsx", ".xls"].includes(path.extname(file).toLowerCase())) tableFiles.push(file);
  }
}

const tables = tableFiles
  .map((file) => ({ file, size: fs.statSync(file).size }))
  .sort((a, b) => a.size - b.size || a.file.localeCompare(b.file))
  .slice(0, MAX_TABLES)
  .map((entry) => entry.file);

/** full-name mentions in one text, as pseudonym -> { count, forms }. */
function fullNameMentions(text, into = new Map()) {
  replaceNames(text, dictionary, (pseudonym, matched) => {
    if (!isMultiWord(matched)) return;

    const entry = into.get(pseudonym) ?? { count: 0, forms: new Map() };
    const form = nameTokens(matched).join(" ");

    entry.count += 1;
    entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1);
    into.set(pseudonym, entry);
  });

  return into;
}

async function rawText(file) {
  const extracted = await extractFile(file).catch(() => null);

  if (!extracted) return "";
  if (extracted.kind === "records") {
    // one line per row, cells separated by a character that is not a legal gap
    // inside a name -- so given and family columns never fuse into a false hit,
    // and the slug in profileLink still counts as the mention it is.
    return extracted.records.map((record) => Object.values(record).join(" | ")).join("\n");
  }

  return (extracted.pages ?? []).join("\n");
}

let pdfs = [];
const requested = process.argv.slice(2);

if (requested.length > 0) {
  for (const target of requested) {
    pdfs.push(...(await listIngestableFiles(target)).filter((file) => file.toLowerCase().endsWith(".pdf")));
  }
} else {
  const root = process.env.CHUNK_EVAL_CORPUS_ROOT;

  if (!root) {
    console.error("no pdfs given and CHUNK_EVAL_CORPUS_ROOT is not set -- pass pdf paths as arguments.");
    process.exit(1);
  }

  const all = (await listIngestableFiles(root)).filter((file) => file.toLowerCase().endsWith(".pdf"));
  const step = Math.max(1, Math.floor(all.length / PDF_SCAN));
  const sample = all.filter((_, index) => index % step === 0).slice(0, PDF_SCAN);
  const scored = [];

  console.log(`choosing pdfs: scanning ${sample.length} of ${all.length} for full-name mentions...`);

  for (const [index, file] of sample.entries()) {
    // a file whose own name holds an athlete name would put that name into
    // manifest.sourceDirs, which is a raw path by design (the table store opens
    // it). the demo leaves such files out rather than report a known leak.
    if (replaceNames(path.basename(file), dictionary) !== path.basename(file)) continue;

    const mentions = fullNameMentions(await rawText(file));
    const total = [...mentions.values()].reduce((sum, entry) => sum + entry.count, 0);

    if (total > 0) scored.push({ file, total });

    if ((index + 1) % 25 === 0) process.stdout.write(`\r  ${index + 1}/${sample.length}`);
  }

  process.stdout.write("\n");

  pdfs = scored
    .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file))
    .slice(0, MAX_PDFS)
    .map((entry) => entry.file);
}

const sources = [...tables, ...pdfs];

for (const file of sources) {
  if (replaceNames(file, dictionary) !== file) {
    console.warn(`!! a source path contains a dictionary name; manifest.sourceDirs will hold it: ${replaceNames(file, dictionary)}`);
  }
}

// ---------------------------------------------------------------------------
// what is in the sources BEFORE de-identification
// ---------------------------------------------------------------------------

console.log(`reading ${sources.length} sources raw...`);

const mentionsByKind = { table: new Map(), pdf: new Map() };
const replacements = { fullName: 0, single: 0 };

for (const file of sources) {
  const text = await rawText(file);

  fullNameMentions(text, tables.includes(file) ? mentionsByKind.table : mentionsByKind.pdf);
  replaceNames(text, dictionary, (_, matched) => {
    if (isMultiWord(matched)) replacements.fullName += 1;
    else replacements.single += 1;
  });
}

/** the most frequent multi-word form, as the query a person would type. */
const representative = (entry) => [...entry.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

// deterministic and unbiased: order by the hash of the pseudonym, not by
// frequency, so the probes are not just the most-mentioned handful.
function pickProbes(map, count, kind) {
  return [...map.entries()]
    .sort((a, b) => sha256(a[0]).localeCompare(sha256(b[0])))
    .slice(0, count)
    .map(([pseudonym, entry]) => ({ kind, pseudonym, name: representative(entry), sourceMentions: entry.count }));
}

const freeTextProbes = pickProbes(mentionsByKind.pdf, Math.ceil(PROBES / 2), "free-text");
const used = new Set(freeTextProbes.map((probe) => probe.pseudonym));
const tableProbes = pickProbes(
  new Map([...mentionsByKind.table].filter(([pseudonym]) => !used.has(pseudonym))),
  PROBES - freeTextProbes.length,
  "structured",
);
const probes = [...freeTextProbes, ...tableProbes];

if (probes.length === 0) {
  console.error("no names were found in the chosen sources -- nothing to probe.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

await fsp.rm(indexDir, { recursive: true, force: true });

console.log(`building ${path.relative(projectRoot, indexDir)} (${retrievalConfig.embedding.provider} embeddings)...`);

const built = await buildIndex({
  sourceDirs: sources,
  outputDir: indexDir,
  resume: false,
  onProgress: (event) => {
    if (event.phase === "file") process.stdout.write(`\r  ${event.done}/${event.total} files, ${event.chunks} chunks`);
  },
});

process.stdout.write("\n");

// ---------------------------------------------------------------------------
// probe
// ---------------------------------------------------------------------------

const store = await VectorStore.load(indexDir);
const bm25 = await BM25Index.load(indexDir, store.chunks.map((chunk) => chunk.chunk_id));
const vocab = new Set(bm25.vocab);

// every file the build wrote, decoded once. utf8 so non-ascii names compare
// correctly; a binary file decodes to noise that cannot spell a name by chance
// in any realistic size.
const indexFiles = [];

for (const entry of await fsp.readdir(indexDir, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile()) continue;

  const full = path.join(entry.parentPath ?? entry.path, entry.name);

  indexFiles.push({ file: path.relative(indexDir, full), text: await fsp.readFile(full, "utf8") });
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** the name in any spacing, case or slug form -- the same gaps the matcher allows. */
const nameRegex = (name) =>
  new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${nameTokens(name).map(escape).join("[\\s_'’,-]+")}(?![\\p{L}\\p{M}\\p{N}])`, "giu");

const hits = probes.map((probe, index) => {
  const pattern = nameRegex(probe.name);
  const rawScan = Object.fromEntries(
    indexFiles
      .map(({ file, text }) => [file, (text.match(pattern) ?? []).length])
      .filter(([, count]) => count > 0),
  );

  // a bm25 result only counts as a hit if it actually CONTAINS the name. the
  // query is ORed term by term, so a given name that appears on its own
  // elsewhere still returns rows -- those are not this person.
  const results = bm25.search(probe.name, { k: 50 });
  const bm25Hits = results.filter((result) => {
    const chunk = store.chunks[result.index];
    const text = chunk ? `${chunk.embedding_text ?? ""}\n${chunk.text ?? ""}` : "";

    return nameRegex(probe.name).test(text);
  }).length;

  const tokens = nameTokens(probe.name);

  return {
    probe: index,
    rawScan: Object.values(rawScan).reduce((sum, count) => sum + count, 0),
    rawScanFiles: Object.keys(rawScan),
    bm25ResultsContainingName: bm25Hits,
    bm25ResultsForQuery: results.length,
    nameTokensInVocab: tokens.filter((token) => vocab.has(token)).length,
    nameTokens: tokens.length,
    pseudonymInIndex: indexFiles.some(({ text }) => text.includes(probe.pseudonym)),
  };
});

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

let gitCommit = null;

try {
  gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
} catch {
  gitCommit = null;
}

const manifest = JSON.parse(await fsp.readFile(path.join(indexDir, "manifest.json"), "utf8"));
const allZero = hits.every((hit) => hit.rawScan === 0 && hit.bm25ResultsContainingName === 0);

const evidence = {
  generatedAt: new Date().toISOString(),
  gitCommit,
  node: process.version,
  story: "E2-08 de-identification transform inside the ingestion path",
  config: {
    deidentification: {
      ...canonicalDeidentification({
        enabled: true,
        fields: deid.fields.map((field) => field.name),
        keyId: keyIdFor(deid.secret),
      }),
      configPath: deid.configPath,
      fields: deid.fields.map(({ name, prefix, columns, compositeColumns, freeText, familyNameAlone, familyNameMinLength }) => ({
        name,
        prefix,
        columns,
        compositeColumns,
        freeText,
        familyNameAlone,
        familyNameMinLength,
      })),
      dictionaryFolders: dictionarySourceDirs(structuredDirs).length,
    },
    embedding: { provider: retrievalConfig.embedding.provider, model: retrievalConfig.embedding.model },
    indexDir: path.relative(projectRoot, indexDir).replaceAll("\\", "/"),
    // basenames, through the transform, so even a file name cannot carry a name in here.
    sources: sources.map((file) => ({
      kind: tables.includes(file) ? "table" : "pdf",
      file: replaceNames(path.basename(file), dictionary),
    })),
    secret: "never recorded -- see keyId",
  },
  keyId: dictionary.keyId,
  dictionary: {
    persons: dictionary.personCount,
    multiWordEntries: dictionary.phrases.size,
    singleWordEntries: dictionary.singles.size,
  },
  index: {
    chunks: built.chunkCount,
    files: built.fileCount,
    skipped: built.skipped.length,
    manifestDeidentification: manifest.deidentification,
  },
  // how much the transform actually did to these sources. single-word
  // replacements are the surname-alone rule -- see docs/DEIDENTIFICATION.md for
  // why that number is the one to watch.
  replacementsInSources: replacements,
  probes: probes.map((probe, index) => ({
    index,
    kind: probe.kind,
    sha256: sha256(probe.name),
    tokens: nameTokens(probe.name).length,
    sourceMentions: probe.sourceMentions,
  })),
  hits,
  summary: {
    probes: probes.length,
    allZero,
    // a probe passes on rawScan === 0 and bm25ResultsContainingName === 0.
    // nameTokensInVocab is reported, not judged: a given name can legitimately
    // remain on its own elsewhere ("Ivan" with no surname is nobody in particular).
    rule: "rawScan === 0 && bm25ResultsContainingName === 0, for every probe",
  },
};

await fsp.mkdir(path.dirname(OUTPUT), { recursive: true });
await fsp.writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(`\n${probes.length} probes (${freeTextProbes.length} free-text, ${tableProbes.length} structured):`);

for (const hit of hits) {
  const verdict = hit.rawScan === 0 && hit.bm25ResultsContainingName === 0 ? "ok  " : "LEAK";

  console.log(
    `  ${verdict} probe ${hit.probe}  raw ${hit.rawScan}  bm25 ${hit.bm25ResultsContainingName}` +
      `  pseudonym in index: ${hit.pseudonymInIndex}`,
  );
}

console.log(`\nreplacements in sources: ${replacements.fullName} full-name, ${replacements.single} single-word`);
console.log(`wrote ${path.relative(projectRoot, OUTPUT)}`);

process.exit(allZero ? 0 : 1);
