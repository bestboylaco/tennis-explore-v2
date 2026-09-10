#!/usr/bin/env node
// seeds a cache entry WITHOUT calling AWS, so the downstream half of the
// pipeline can be exercised on a machine with no working Textract access.
//
//   npm run textract:seed -- --file data/scanned/x.pdf --from-response resp.json
//   npm run textract:seed -- --file data/scanned/x.pdf --synthetic
//
// COSTS NOTHING and sends nothing. it never imports the AWS client at all.
//
// why this exists: everything after the API call -- block parsing, the cache,
// the chunker, the index, the checklist, the eval -- reads data/textract-cache/
// and nothing else. that is deliberate, and it is what lets a teammate clone the
// repo and get the tables with no AWS access. but it only works once the cache
// has something in it, and until the first real run there is no way to test any
// of it. this fills that gap.
//
// the two modes are NOT equivalent and the difference matters:
//
//   --from-response   replays a real captured Textract response through the
//                     real parser. this genuinely tests blocksToPage against
//                     API output, so it proves the parser handles the shapes
//                     AWS actually returns. use this whenever anyone can get a
//                     response JSON from anywhere.
//
//   --synthetic       invents plausible table blocks. it proves the PLUMBING
//                     works end to end -- cache, chunker, index, retrieval --
//                     and nothing whatsoever about Textract or about accuracy.
//                     entries are marked `synthetic: true` and the checklist
//                     refuses to score them.
//
// it writes to data/textract-cache-dev by default, never to the committed
// data/textract-cache. the real cache is the evidence path: an entry in it means
// a page was really paid for and really read, and putting invented data beside
// that would destroy the only thing that makes it worth committing.

// .env must load before ANY other import -- see the note in textract-extract.js.
import "dotenv/config";

import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { openDocument } from "../src/modules/ingestion/pdfRaster.service.js";
import { blocksToPage } from "../src/modules/ingestion/textractBlocks.js";
import { textractCacheDefaults, writeCache } from "../src/modules/ingestion/textractCache.service.js";

const argv = process.argv.slice(2);

const flag = (name) => argv.includes(`--${name}`);

function option(name, fallback) {
  const found = argv.find((argument) => argument.startsWith(`--${name}=`));

  if (found) return found.split("=").slice(1).join("=");

  const index = argv.indexOf(`--${name}`);

  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
}

const target = option("file", null);
const fromResponse = option("from-response", null);
const synthetic = flag("synthetic");
const dir = option("dir", "data/textract-cache-dev");

if (flag("help") || !target || (!fromResponse && !synthetic)) {
  console.log(`
usage: node bin/textract-seed.js --file <pdf> (--from-response <json> | --synthetic)

  --file <pdf>            the PDF to seed an entry for. must exist -- the cache
                          key is a hash of its bytes, so the entry only ever
                          matches this exact file.

  --from-response <json>  a captured Textract response. either one response
                          object, or { "pages": [ response, response, ... ] }
                          with one per page. parsed by the REAL parser.

  --synthetic             invent table blocks instead. proves the plumbing, and
                          nothing about Textract or about accuracy. the entry is
                          marked synthetic and the checklist will refuse it.

  --dir <path>            where to write   (default: data/textract-cache-dev)

then point the rest of the pipeline at the same directory:

  PowerShell   $env:TEXTRACT_CACHE_DIR="data/textract-cache-dev"
  bash         export TEXTRACT_CACHE_DIR=data/textract-cache-dev

  npm run textract:checklist
  npm run build:index -- --append data/scanned
`);
  process.exit(target && !fromResponse && !synthetic ? 1 : 0);
}

// the real cache is the evidence path. an entry in it is a claim that a page was
// paid for and really read, and this command cannot make that claim.
if (path.resolve(dir) === path.resolve(textractCacheDefaults.dir)) {
  console.error(`\nrefusing to seed into ${dir} -- that is the real, committed cache.`);
  console.error("an entry there means a page was actually sent to Textract and paid for.");
  console.error("seed somewhere else (the default is data/textract-cache-dev) and point");
  console.error("TEXTRACT_CACHE_DIR at it.\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// how many pages, and does the file exist
//
// read from the PDF rather than taken on trust: writeCache refuses an entry
// whose page array does not match its pageCount, and that guard is worth
// keeping honest here too.
// ---------------------------------------------------------------------------

let pageCount;

try {
  const document = await openDocument(target);

  pageCount = document.pageCount;
  await document.close();
} catch (error) {
  console.error(`\ncould not read ${target}: ${error.message}\n`);
  process.exit(1);
}

console.log(`\nseeding a cache entry for ${path.basename(target)} (${pageCount} page(s))`);
console.log(`mode   ${synthetic ? "SYNTHETIC -- invented data" : `replay of ${fromResponse}`}`);
console.log(`into   ${dir}\n`);

// ---------------------------------------------------------------------------
// mode 1: replay a real response
// ---------------------------------------------------------------------------

/** one Textract response per page, however the file happened to be shaped. */
async function responsesFromFile(file) {
  let parsed;

  try {
    parsed = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    console.error(`could not read ${file} as JSON: ${error.message}\n`);
    process.exit(1);
  }

  // a single-page capture is the common case -- it is what one AnalyzeDocument
  // call returns, and what someone would paste out of the console.
  const responses = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.pages)
      ? parsed.pages
      : [parsed];

  if (!responses.every((each) => Array.isArray(each?.Blocks))) {
    console.error("that file does not look like a Textract response: every entry needs a Blocks array.");
    console.error('expected one response object, or { "pages": [ response, ... ] }.\n');
    process.exit(1);
  }

  if (responses.length !== pageCount) {
    // not fatal -- a one-page capture against a ten-page PDF is a normal thing
    // to have. the remaining pages are recorded as read-but-empty rather than
    // silently invented.
    console.log(
      `  !! ${responses.length} response(s) for a ${pageCount}-page document. ` +
        `the rest will be stored as empty pages.`,
    );
  }

  return responses;
}

// ---------------------------------------------------------------------------
// mode 2: invent something table-shaped
// ---------------------------------------------------------------------------

/**
 * builds Textract-shaped blocks for a small table.
 *
 * deliberately real block shapes -- CELL under TABLE via CHILD, WORD under CELL,
 * a TABLE_TITLE, a MERGED_CELL under its own relationship type -- so the entry
 * exercises the same parser paths a real response would. confidences vary and
 * some land below the low-confidence threshold, so the checklist's
 * least-confident-first ordering is exercised rather than assumed.
 */
function syntheticBlocks(pageNumber) {
  const blocks = [];
  const id = (kind, row, column) => `p${pageNumber}-${kind}-${row}-${column}`;

  const grid = [
    ["Round", "Aces", "Speed"],
    ["R1", "7", "182"],
    ["R2", "11", "191"],
    ["QF", "9", "188"],
  ];

  const cellIds = [];

  grid.forEach((cells, rowIndex) => {
    cells.forEach((text, columnIndex) => {
      const wordId = id("w", rowIndex, columnIndex);
      const cellId = id("c", rowIndex, columnIndex);

      // a spread that puts a few cells under the 90% threshold on every page.
      const confidence = 84 + ((pageNumber + rowIndex * 3 + columnIndex * 5) % 16);

      blocks.push({ Id: wordId, BlockType: "WORD", Text: text, Confidence: confidence });
      blocks.push({
        Id: cellId,
        BlockType: "CELL",
        RowIndex: rowIndex + 1,
        ColumnIndex: columnIndex + 1,
        RowSpan: 1,
        ColumnSpan: 1,
        Confidence: confidence,
        Relationships: [{ Type: "CHILD", Ids: [wordId] }],
      });

      cellIds.push(cellId);
    });
  });

  const titleWord = { Id: id("tw", 0, 0), BlockType: "WORD", Text: `Table`, Confidence: 99 };
  const titleWordTwo = { Id: id("tw", 0, 1), BlockType: "WORD", Text: `${pageNumber}.`, Confidence: 99 };
  const titleWordThree = { Id: id("tw", 0, 2), BlockType: "WORD", Text: "Serve summary", Confidence: 99 };
  const titleBlock = {
    Id: id("t", 0, 0),
    BlockType: "TABLE_TITLE",
    Relationships: [{ Type: "CHILD", Ids: [titleWord.Id, titleWordTwo.Id, titleWordThree.Id] }],
  };

  blocks.push(titleWord, titleWordTwo, titleWordThree, titleBlock);

  blocks.push({
    Id: id("table", 0, 0),
    BlockType: "TABLE",
    Confidence: 97,
    Relationships: [
      { Type: "CHILD", Ids: cellIds },
      { Type: "TABLE_TITLE", Ids: [titleBlock.Id] },
    ],
  });

  // the page's prose, so the document chunker has something to work with too.
  blocks.push(
    { Id: id("l", 0, 0), BlockType: "LINE", Text: `SYNTHETIC SEED DATA -- page ${pageNumber}` },
    { Id: id("l", 0, 1), BlockType: "LINE", Text: "This text was generated locally and never came from Textract." },
    { Id: id("l", 0, 2), BlockType: "LINE", Text: `Table ${pageNumber}. Serve summary` },
  );

  return blocks;
}

// ---------------------------------------------------------------------------
// build the result in exactly the shape analyzeScannedPdf returns
// ---------------------------------------------------------------------------

const responses = synthetic
  ? Array.from({ length: pageCount }, (_, index) => ({ Blocks: syntheticBlocks(index + 1) }))
  : await responsesFromFile(fromResponse);

const pages = [];
const tables = [];
const pageModes = [];

for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
  const response = responses[pageNumber - 1];

  if (!response) {
    // a capture that covered fewer pages than the document has. recorded as an
    // empty page rather than dropped, so the array stays aligned with the real
    // page numbering exactly as the extractor would leave it.
    pages.push("");
    pageModes.push("tables");
    continue;
  }

  // the real parser, and the page number from this loop rather than from the
  // response -- the same rule the extractor follows, and for the same reason.
  const parsed = blocksToPage(response.Blocks ?? [], pageNumber);

  pages.push(parsed.text);
  tables.push(...parsed.tables);
  pageModes.push("tables");

  console.log(
    `  page ${String(pageNumber).padStart(3)}  ${parsed.tables.length} table(s), ${parsed.text.length} chars`,
  );
}

const result = {
  filePath: target,
  pages,
  pageModes,
  tables,
  pageCount,
  pagesSent: 0,
  apiCalls: 0,
  detectPages: 0,
  failures: [],
  dpi: null,
  twoPass: false,
  // writeCache refuses anything incomplete, and rightly. this IS complete --
  // every page has an entry -- it just did not cost anything.
  complete: true,
  modelVersion: synthetic ? null : "replayed",
  synthetic,
};

await fsp.mkdir(dir, { recursive: true });

const written = await writeCache(target, result, { dir });

if (!written) {
  console.error("\nwriteCache refused the entry. that is the completeness guard working:");
  console.error(`pages=${pages.length} pageCount=${pageCount} complete=${result.complete}\n`);
  process.exit(1);
}

console.log(`\nwritten to ${written}`);
console.log(`  ${tables.length} table(s), ${pages.filter((text) => text !== "").length} page(s) with text`);

// the ledger is NOT touched. nothing was spent, and recording a zero-cost entry
// as usage would make the budget check work from a number that never happened.

if (synthetic) {
  console.log("\n  !! SYNTHETIC. these cells were invented, not read off a page.");
  console.log("     npm run textract:checklist will REFUSE to score this entry --");
  console.log("     a cell-accuracy figure from invented data would be meaningless.");
  console.log("     it is here to prove the pipeline runs, and nothing else.");
}

console.log("\nnext -- point the rest of the pipeline at this directory:\n");
console.log(`  PowerShell   $env:TEXTRACT_CACHE_DIR="${dir}"`);
console.log(`  bash         export TEXTRACT_CACHE_DIR=${dir}`);
console.log("\n  npm run build:index -- --append data/scanned");
console.log("  npm run textract:checklist\n");
