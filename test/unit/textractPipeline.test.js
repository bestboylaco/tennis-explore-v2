import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { tinyPdf } from "./helpers/tinyPdf.js";

// the cache directory is read from the environment when the module first loads,
// so it has to be set before anything imports it -- hence the dynamic imports
// below rather than static ones at the top of the file.
let workDir;
let cacheDir;
let extractFile;
let writeCache;

before(async () => {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "textract-pipeline-test-"));
  cacheDir = path.join(workDir, "cache");

  process.env.TEXTRACT_CACHE_DIR = cacheDir;

  ({ extractFile } = await import("../../src/modules/ingestion/extraction.service.js"));
  ({ writeCache } = await import("../../src/modules/ingestion/textractCache.service.js"));
});

after(async () => {
  await fsp.rm(workDir, { recursive: true, force: true });
  delete process.env.TEXTRACT_CACHE_DIR;
});

/**
 * a PDF with no text layer at all -- what a scan looks like to both parsers.
 *
 * the trailing comment makes each fixture a genuinely DIFFERENT document. the
 * cache is keyed on content, deliberately, so two files built from the same
 * template are the same document to it and the second would hit the first one's
 * entry. a PDF comment after %%EOF is ignored by every parser and changes the
 * bytes, which is exactly what is wanted.
 */
async function scannedPdf(name, pageCount = 2) {
  const filePath = path.join(workDir, name);

  await fsp.writeFile(filePath, Buffer.concat([tinyPdf(pageCount, { text: false }), Buffer.from(`%${name}\n`)]));

  return filePath;
}

function cachedResult({ pageCount = 2, tables = [] } = {}) {
  return {
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => `text read off page ${index + 1}`),
    tables,
    complete: true,
  };
}

const SERVE_TABLE = {
  page: 2,
  index: 0,
  title: "Table 1. Serve speed by round",
  rowCount: 2,
  columnCount: 2,
  grid: [
    ["Round", "Serve speed"],
    ["R1", "182"],
  ],
  cells: [
    { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: "Round", confidence: 99 },
    { row: 1, column: 2, rowSpan: 1, columnSpan: 1, text: "Serve speed", confidence: 99 },
    { row: 2, column: 1, rowSpan: 1, columnSpan: 1, text: "R1", confidence: 98 },
    { row: 2, column: 2, rowSpan: 1, columnSpan: 1, text: "182", confidence: 71 },
  ],
  lowConfidenceCells: 1,
};

describe("a scanned pdf with no Textract cache", () => {
  it("still extracts to nothing, exactly as before this story", async () => {
    // the regression guard. the Textract lookup sits in the middle of
    // extractPdf's fallback chain, and if it threw or returned junk on a cache
    // miss it would break the 2,301 ordinary files that pass through it.
    const filePath = await scannedPdf("uncached.pdf");

    const extracted = await extractFile(filePath);

    assert.deepEqual(extracted.pages, []);
    assert.deepEqual(extracted.tables, []);
    assert.equal(extracted.ocr, false);
  });
});

describe("a scanned pdf whose extraction is cached", () => {
  it("reads its text out of the cache", async () => {
    const filePath = await scannedPdf("cached.pdf");

    await writeCache(filePath, cachedResult());

    const extracted = await extractFile(filePath);

    assert.deepEqual(extracted.pages, ["text read off page 1", "text read off page 2"]);
  });

  it("says the text came from Textract rather than the local ocr tool", async () => {
    // it matters downstream: a figure quoted from a machine-read page should be
    // framed as machine-read, and which engine did it is part of that.
    const filePath = await scannedPdf("engine.pdf");

    await writeCache(filePath, cachedResult());

    const extracted = await extractFile(filePath);

    assert.equal(extracted.ocr, true);
    assert.equal(extracted.ocrEngine, "textract");
  });

  it("carries the tables through to the extracted document", async () => {
    const filePath = await scannedPdf("tables.pdf");

    await writeCache(filePath, cachedResult({ tables: [SERVE_TABLE] }));

    const extracted = await extractFile(filePath);

    assert.equal(extracted.tables.length, 1);
    assert.equal(extracted.tables[0].page, 2);
  });

  it("does not call AWS -- the whole path is a local file read", async () => {
    // the guarantee that makes it safe for the index build to consult this on
    // every one of 2,301 files. if extraction could spend budget, a routine
    // rebuild could empty the month's allowance without anyone deciding to.
    const filePath = await scannedPdf("no-network.pdf");

    await writeCache(filePath, cachedResult({ tables: [SERVE_TABLE] }));

    // no credentials in the environment at all. a code path that reached
    // Textract would fail rather than quietly succeed.
    const saved = {
      key: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
    };

    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    try {
      const extracted = await extractFile(filePath);

      assert.equal(extracted.tables.length, 1);
    } finally {
      if (saved.key) process.env.AWS_ACCESS_KEY_ID = saved.key;
      if (saved.secret) process.env.AWS_SECRET_ACCESS_KEY = saved.secret;
    }
  });
});

describe("the cached tables reach the index as chunks", () => {
  it("produces a table chunk that survives the schema gate", async () => {
    // end to end across the seam this story adds: cache -> extractFile ->
    // chunkTables -> enforceSchema. every one of those has its own tests; this
    // is the one that would catch them disagreeing about a field name.
    const { chunkTables } = await import("../../src/modules/ingestion/chunking.service.js");
    const { enforceSchema, classifyDocument } = await import(
      "../../src/modules/ingestion/metadata.service.js"
    );
    const { grantsForDocument } = await import("../../src/shared/constants/accessControl.js");

    const filePath = await scannedPdf("end-to-end.pdf");

    await writeCache(filePath, cachedResult({ tables: [SERVE_TABLE] }));

    const extracted = await extractFile(filePath);
    const chunks = chunkTables(extracted, { authors: [], eventDate: null });

    assert.equal(chunks.length, 1);
    assert.match(chunks[0].text, /Table 1\. Serve speed by round \(page 2\)/);
    assert.match(chunks[0].text, /\| R1 \| 182 \|/);

    const classification = classifyDocument({
      sourceType: extracted.sourceType,
      fileName: path.basename(filePath),
      text: extracted.pages[0],
    });

    const { valid, problems } = enforceSchema(
      {
        ...chunks[0],
        source_type: extracted.sourceType,
        authors: [],
        event_date: null,
        ingested_at: new Date().toISOString(),
        content_hash: "deadbeef",
        data_domain: classification.domain,
        sensitivity: classification.sensitivity,
        program: classification.program,
        acl_groups: grantsForDocument(classification),
      },
      { strict: false },
    );

    assert.deepEqual(problems, []);
    assert.equal(valid, true);
  });

  it("keeps the low-confidence count on the chunk for the checklist", async () => {
    const { chunkTables } = await import("../../src/modules/ingestion/chunking.service.js");

    const filePath = await scannedPdf("confidence.pdf");

    await writeCache(filePath, cachedResult({ tables: [SERVE_TABLE] }));

    const [chunk] = chunkTables(await extractFile(filePath));

    assert.equal(chunk.low_confidence_cells, 1);
    assert.equal(chunk.ocr_engine, "textract");
  });

  it("carries the synthetic flag out of the cache and into the extraction", async () => {
    // this is the load-bearing part of the guard. chunkTables stamps every
    // table chunk ocr_engine:"textract", which for a seeded entry is a claim
    // that is simply not true -- so unless the flag survives this far, the
    // index build has nothing to refuse on, and the shards are append-only.
    const filePath = await scannedPdf("seeded.pdf");

    await writeCache(filePath, { ...cachedResult({ tables: [SERVE_TABLE] }), synthetic: true });

    assert.equal((await extractFile(filePath)).synthetic, true);
  });

  it("reports a real extraction as not synthetic", async () => {
    const filePath = await scannedPdf("genuine.pdf");

    await writeCache(filePath, cachedResult({ tables: [SERVE_TABLE] }));

    // false rather than undefined, so the index build's check never has to
    // decide what a missing flag means.
    assert.equal((await extractFile(filePath)).synthetic, false);
  });
});
