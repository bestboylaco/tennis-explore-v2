#!/usr/bin/env node
// finds the cheapest scanned documents worth spending the budget on.
//
//   npm run textract:pick -- "C:/IFN736-project/document-sources"
//
// COSTS NOTHING. no AWS call is made anywhere in this file.
//
// the candidates are not "any scanned pdf" -- they come from the skipped list
// in data/index/build-report.json, specifically the 144 files recorded as
// "no usable text extracted". those are real partner documents that pdf-parse
// AND poppler both failed to read, which is exactly the population this story
// exists to rescue. picking an arbitrary scan instead would demonstrate the
// pipeline without recovering anything.
//
// ranking is by cost first. every page is one of 100 for the month, so a
// 4-page document with two dense tables is worth far more than a 40-page one
// with the same tables.

// .env must load before ANY other import. these CLIs are run as bare
// `node bin/...` with no -r flag, and nothing else in their import graph calls
// dotenv.config() -- src/config/env.js and retrieval.config.js do, but neither
// is reachable from here. without this line the AWS keys in .env are invisible
// to the SDK's credential chain, TEXTRACT_ENABLED=true in .env does nothing,
// and every TEXTRACT_* setting silently falls back to its default. ESM
// evaluates imports depth-first in source order, so being FIRST is what makes
// it beat the module-load-time constants in textract.client.js and
// textractCache.service.js.
import "dotenv/config";

import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { openDocument } from "../src/modules/ingestion/pdfRaster.service.js";

const argv = process.argv.slice(2);
const limit = Number(argv.find((argument) => argument.startsWith("--limit="))?.split("=")[1] ?? 12);
const maxPages = Number(argv.find((argument) => argument.startsWith("--max-pages="))?.split("=")[1] ?? 12);
const [corpusDir] = argv.filter((argument) => !argument.startsWith("--"));

if (!corpusDir) {
  console.error("usage: node bin/textract-pick.js <corpus-folder> [--limit=12] [--max-pages=12]");
  console.error("\nthe corpus folder is where the partner PDFs live -- outside the repo, e.g.");
  console.error('  node bin/textract-pick.js "C:/IFN736-project/document-sources"');
  process.exit(1);
}

const REPORT = "data/index/build-report.json";

let report;

try {
  report = JSON.parse(await fsp.readFile(REPORT, "utf8"));
} catch (error) {
  console.error(`could not read ${REPORT}: ${error.message}`);
  console.error("that file is written by npm run build:index. build the index first.");
  process.exit(1);
}

// the exact reason string indexBuilder records when a document produced no
// chunks at all. other skip reasons -- an oversized file, a parse crash -- are
// different problems and Textract is not the answer to them.
const scanned = (report.skipped ?? []).filter((entry) => entry.reason === "no usable text extracted");

console.log(`\n${scanned.length} files were skipped as unreadable in the last index build.`);
console.log(`looking for them under ${corpusDir}\n`);

/** builds a name -> full path map once, rather than walking the tree per file. */
async function indexCorpus(directory) {
  const found = new Map();

  async function walk(current) {
    let entries;

    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const full = path.join(current, entry.name);

      if (entry.isDirectory()) await walk(full);
      else if (entry.name.toLowerCase().endsWith(".pdf")) found.set(entry.name, full);
    }
  }

  await walk(directory);

  return found;
}

const corpus = await indexCorpus(corpusDir);

console.log(`${corpus.size} pdfs in the corpus folder.\n`);

/**
 * a cheap proxy for "does this page have a table on it".
 *
 * a rendered page is a grid of pixels; a page with ruled tables has far more
 * dark pixels arranged in long horizontal runs than a page of prose does. this
 * counts non-white pixels as a stand-in for ink, and long horizontal dark runs
 * as a stand-in for rules.
 *
 * it is a heuristic and it is only used to ORDER a shortlist a human then looks
 * at. it never decides anything on its own -- which is the only reason a
 * measure this rough is acceptable here.
 */
function inkStatistics(png) {
  // PNG is compressed, so the pixels are not readable without decoding it.
  // rather than pull in a decoder for a heuristic, use the compressed size as
  // the density proxy: a page with dense ruled tables compresses far worse than
  // a mostly-white page of prose at the same resolution.
  return { bytes: png.length };
}

const rows = [];

for (const entry of scanned) {
  const filePath = corpus.get(entry.file);

  if (!filePath) continue;

  // one open per candidate, not two. the page count and the first page's raster
  // both come off the same handle -- reading them through the one-shot helpers
  // read and parsed each PDF twice, across up to 144 candidates.
  let doc;

  try {
    doc = await openDocument(filePath);

    // a long document is disqualified on cost alone, before any rendering.
    if (doc.pageCount > maxPages) continue;

    const first = await doc.renderPage(1, { dpi: 150 });
    const ink = inkStatistics(first.png);

    // KB of PNG per megapixel: resolution-independent, so a small page and a
    // large one are compared on density rather than on size.
    const megapixels = (first.width * first.height) / 1e6;
    const density = ink.bytes / 1024 / Math.max(megapixels, 0.01);

    rows.push({ file: entry.file, filePath, pages: doc.pageCount, density: Math.round(density) });

    process.stdout.write(`\r  examined ${rows.length} candidate(s)...`);
  } catch {
    // a file that will not even render is not a candidate. it is also not worth
    // reporting -- it was already recorded as skipped, for this same reason.
  } finally {
    // every exit from the block above has to release the handle: the `continue`
    // when the document is too long, the throw when it will not render, and the
    // ordinary path. each open holds a worker thread, and 144 leaked ones would
    // stop the command exiting after it had printed its shortlist.
    await doc?.close();
  }
}

process.stdout.write(`\r${"".padEnd(40)}\r`);

if (rows.length === 0) {
  console.error(`no skipped file under ${maxPages} pages was found in ${corpusDir}.`);
  console.error("try a larger --max-pages, or check the corpus folder is the right one.\n");
  process.exit(1);
}

// fewest pages first, because pages are the currency. density breaks ties: at
// equal cost, take the page with more ink on it.
rows.sort((a, b) => a.pages - b.pages || b.density - a.density);

const shortlist = rows.slice(0, limit);

console.log(`${rows.length} candidates under ${maxPages} pages. best ${shortlist.length}:\n`);
console.log(`  ${"pages".padStart(5)}  ${"ink".padStart(6)}  file`);
console.log(`  ${"-".repeat(5)}  ${"-".repeat(6)}  ${"-".repeat(50)}`);

for (const row of shortlist) {
  console.log(`  ${String(row.pages).padStart(5)}  ${String(row.density).padStart(6)}  ${row.file}`);
}

const pair = shortlist.slice(0, 2);
const pairPages = pair.reduce((sum, row) => sum + row.pages, 0);

console.log(`\nthe two cheapest come to ${pairPages} page(s) of the 100/month allowance.`);
console.log("\ncopy the two you want into data/scanned/ and check they really do hold");
console.log("statistical tables before spending anything -- the ink figure is a proxy,");
console.log("not a table detector:\n");

for (const row of pair) {
  console.log(`  cp "${row.filePath}" data/scanned/`);
}

await fsp.mkdir("evidence", { recursive: true });
await fsp.writeFile(
  "evidence/tenise-12-candidates.json",
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      corpusDir,
      skippedUnreadable: scanned.length,
      examined: rows.length,
      candidates: shortlist,
    },
    null,
    2,
  )}\n`,
);

console.log("\nwritten to evidence/tenise-12-candidates.json\n");
