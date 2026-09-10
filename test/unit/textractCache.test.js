import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  assertBudget,
  budgetStatus,
  readCache,
  readUsage,
  recordUsage,
  writeCache,
} from "../../src/modules/ingestion/textractCache.service.js";

let workDir;

before(async () => {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "textract-cache-test-"));
});

after(async () => {
  await fsp.rm(workDir, { recursive: true, force: true });
});

/** a scratch directory per test, so no test can see another's ledger. */
async function scratch(name) {
  const dir = path.join(workDir, name);

  await fsp.mkdir(dir, { recursive: true });

  return dir;
}

async function samplePdf(dir, name, bytes) {
  const filePath = path.join(dir, name);

  await fsp.writeFile(filePath, bytes);

  return filePath;
}

function completeResult(overrides = {}) {
  return {
    pageCount: 2,
    pages: ["page one text", "page two text"],
    tables: [{ page: 1, index: 0, grid: [["a", "b"]], cells: [], rowCount: 1, columnCount: 2 }],
    complete: true,
    ...overrides,
  };
}

describe("textract cache -- hits and misses", () => {
  it("reads back what it wrote", async () => {
    const dir = await scratch("roundtrip");
    const pdf = await samplePdf(dir, "scan.pdf", "original bytes");

    await writeCache(pdf, completeResult(), { dir });

    const hit = await readCache(pdf, { dir });

    assert.equal(hit.pageCount, 2);
    assert.deepEqual(hit.pages, ["page one text", "page two text"]);
  });

  it("misses when nothing has been cached for the file", async () => {
    const dir = await scratch("empty");
    const pdf = await samplePdf(dir, "scan.pdf", "original bytes");

    assert.equal(await readCache(pdf, { dir }), null);
  });

  it("misses once the file's bytes change", async () => {
    // the key is the sha256 of the content. a re-scanned or corrected pdf is a
    // different document and must be sent again; mtime would have re-sent it on
    // every fresh git clone instead, burning the monthly budget for nothing.
    const dir = await scratch("changed-bytes");
    const pdf = await samplePdf(dir, "scan.pdf", "original bytes");

    await writeCache(pdf, completeResult(), { dir });
    assert.notEqual(await readCache(pdf, { dir }), null);

    await fsp.writeFile(pdf, "re-scanned, different bytes");

    assert.equal(await readCache(pdf, { dir }), null);
  });

  it("still hits after the file is moved or re-downloaded to a new path", async () => {
    // corpus files live outside the repo and get re-synced from s3. keying on
    // the path would make every re-sync a full-price re-extraction.
    const dir = await scratch("moved");
    const original = await samplePdf(dir, "scan.pdf", "identical bytes");

    await writeCache(original, completeResult(), { dir });

    const elsewhere = await samplePdf(dir, "renamed-copy.pdf", "identical bytes");

    assert.equal((await readCache(elsewhere, { dir })).pageCount, 2);
  });

  it("records the source file and a timestamp alongside the result", async () => {
    const dir = await scratch("provenance");
    const pdf = await samplePdf(dir, "scan.pdf", "original bytes");

    await writeCache(pdf, completeResult(), { dir });

    const hit = await readCache(pdf, { dir });

    assert.equal(hit.sourceFile, "scan.pdf");
    assert.match(hit.extractedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(hit.sha256.length, 64);
  });
});

describe("textract cache -- only complete documents are cached", () => {
  it("refuses to write a result with pages missing", async () => {
    // the failure this prevents: page 3 throws, pages 1-2 succeed, and an
    // incomplete result gets cached. every later run then reports a cache hit
    // and the missing page is invisible forever -- and re-running costs nothing
    // because the cache says the work is done.
    const dir = await scratch("incomplete");
    const pdf = await samplePdf(dir, "scan.pdf", "original bytes");

    const written = await writeCache(pdf, completeResult({ complete: false }), { dir });

    assert.equal(written, null);
    assert.equal(await readCache(pdf, { dir }), null);
  });

  it("refuses to write when fewer pages came back than the document has", async () => {
    const dir = await scratch("short");
    const pdf = await samplePdf(dir, "scan.pdf", "original bytes");

    const written = await writeCache(pdf, completeResult({ pageCount: 5 }), { dir });

    assert.equal(written, null);
  });
});

describe("textract cache -- the monthly budget", () => {
  it("allows a run that fits inside the budget", async () => {
    const dir = await scratch("within");

    await assert.doesNotReject(() => assertBudget(10, { dir, monthlyBudget: 100, maxPerRun: 20 }));
  });

  it("refuses a run that would take the month past its budget", async () => {
    const dir = await scratch("over-month");
    const now = new Date("2026-08-27T00:00:00Z");

    await recordUsage({ pages: 95, calls: 95 }, { dir, now });

    await assert.rejects(
      () => assertBudget(10, { dir, monthlyBudget: 100, maxPerRun: 20, now }),
      /monthly/i,
    );
  });

  it("refuses a single run larger than the per-run cap", async () => {
    // the second guard. a 400-page pdf handed to the CLI by mistake fits the
    // monthly budget check on a fresh month and would spend all of it at once.
    const dir = await scratch("over-run");

    await assert.rejects(
      () => assertBudget(40, { dir, monthlyBudget: 100, maxPerRun: 20 }),
      /per run/i,
    );
  });

  it("counts a month's usage separately from the previous month's", async () => {
    const dir = await scratch("month-reset");

    await recordUsage({ pages: 98, calls: 98 }, { dir, now: new Date("2026-07-30T00:00:00Z") });

    const august = new Date("2026-08-01T00:00:00Z");

    // july is full, august is empty. the budget is monthly, so august is free.
    await assert.doesNotReject(() =>
      assertBudget(10, { dir, monthlyBudget: 100, maxPerRun: 20, now: august }),
    );
  });

  it("accumulates usage across several runs in the same month", async () => {
    const dir = await scratch("accumulate");
    const now = new Date("2026-08-27T00:00:00Z");

    await recordUsage({ pages: 4, calls: 4 }, { dir, now });
    await recordUsage({ pages: 6, calls: 7 }, { dir, now });

    const ledger = await readUsage({ dir });

    assert.deepEqual(ledger["2026-08"], { pages: 10, calls: 11, detectPages: 0, detectCalls: 0 });
  });

  it("marks a locally seeded entry as synthetic", async () => {
    // the acceptance condition is a cell-accuracy percentage, so an entry of
    // invented cells sitting unlabelled beside real ones is the one mistake
    // that could manufacture a passing result out of nothing.
    const dir = await scratch("synthetic");
    const file = path.join(dir, "seeded.pdf");

    await fsp.writeFile(file, "%PDF-1.4 seeded");

    const written = await writeCache(
      file,
      { pages: ["invented"], pageCount: 1, tables: [], complete: true, synthetic: true },
      { dir },
    );

    assert.equal(JSON.parse(await fsp.readFile(written, "utf8")).synthetic, true);
  });

  it("marks an ordinary extraction as not synthetic", async () => {
    const dir = await scratch("not-synthetic");
    const file = path.join(dir, "real.pdf");

    await fsp.writeFile(file, "%PDF-1.4 real");

    const written = await writeCache(
      file,
      { pages: ["read off a page"], pageCount: 1, tables: [], complete: true },
      { dir },
    );

    // explicitly false rather than absent, so a reader never has to decide what
    // a missing flag means on the one field that gates the accuracy evidence.
    assert.equal(JSON.parse(await fsp.readFile(written, "utf8")).synthetic, false);
  });

  it("keeps the two allowances apart in the ledger", async () => {
    // `pages` is the TABLES count and nothing else. detection bills a separate
    // bucket ten times the size, and adding the two together would make the cap
    // that actually binds look far closer than it is.
    const dir = await scratch("two-allowances");
    const now = new Date("2026-08-27T00:00:00Z");

    await recordUsage({ pages: 2, calls: 2, detectPages: 9, detectCalls: 9 }, { dir, now });

    assert.deepEqual(await readUsage({ dir }).then((led) => led["2026-08"]), {
      pages: 2,
      calls: 2,
      detectPages: 9,
      detectCalls: 9,
    });
  });

  it("extends a ledger written before detection was tracked", async () => {
    // the committed ledger predates two-pass. reading a missing field as NaN
    // would corrupt the running total the budget check depends on.
    const dir = await scratch("old-ledger");
    const now = new Date("2026-08-27T00:00:00Z");

    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "usage.json"), JSON.stringify({ "2026-08": { pages: 5, calls: 5 } }));

    const recorded = await recordUsage({ pages: 1, calls: 1, detectPages: 3, detectCalls: 3 }, { dir, now });

    assert.deepEqual(recorded, { pages: 6, calls: 6, detectPages: 3, detectCalls: 3 });
  });

  it("reports how much of the budget is left without spending any of it", async () => {
    const dir = await scratch("status");
    const now = new Date("2026-08-27T00:00:00Z");

    await recordUsage({ pages: 12, calls: 12, detectPages: 40, detectCalls: 40 }, { dir, now });

    const status = await budgetStatus({ dir, monthlyBudget: 100, detectBudget: 1000, now });

    assert.deepEqual(status, {
      month: "2026-08",
      used: 12,
      budget: 100,
      remaining: 88,
      detectUsed: 40,
      detectBudget: 1000,
      detectRemaining: 960,
    });
  });

  it("refuses a run that would exhaust the detection allowance", async () => {
    // a two-pass run reads EVERY page through detection, including the ones
    // that never cost a TABLES page, so this is the guard a large run meets
    // first even though the bucket is ten times bigger.
    const dir = await scratch("detect-cap");
    const now = new Date("2026-08-27T00:00:00Z");

    await recordUsage({ pages: 0, calls: 0, detectPages: 995, detectCalls: 995 }, { dir, now });

    await assert.rejects(
      () => assertBudget(2, { dir, monthlyBudget: 100, detectBudget: 1000, detectPages: 20, now }),
      /detection budget/,
    );
  });

  it("leaves the detection guard alone when nothing will be detected", async () => {
    // the single-pass path passes no detectPages, so a month that has used its
    // detection allowance must not block an ordinary run.
    const dir = await scratch("detect-unused");
    const now = new Date("2026-08-27T00:00:00Z");

    await recordUsage({ pages: 0, calls: 0, detectPages: 1000, detectCalls: 1000 }, { dir, now });

    await assert.doesNotReject(() =>
      assertBudget(5, { dir, monthlyBudget: 100, detectBudget: 1000, now }),
    );
  });

  it("treats a missing ledger as a month with nothing spent", async () => {
    const dir = await scratch("no-ledger");

    assert.deepEqual(await readUsage({ dir }), {});
    assert.equal((await budgetStatus({ dir, monthlyBudget: 100 })).used, 0);
  });

  it("does not leave the ledger truncated if the write is interrupted", async () => {
    // written to a temp file and renamed over the old one. a plain writeFile
    // truncates first, and a crash in that window leaves a usage.json that
    // reads as a month with nothing spent -- which lets the next run re-spend a
    // budget that is already gone.
    const dir = await scratch("atomic");
    const now = new Date("2026-08-27T00:00:00Z");

    await recordUsage({ pages: 7, calls: 7 }, { dir, now });

    const entries = await fsp.readdir(dir);

    assert.deepEqual(
      entries.filter((name) => name.includes(".tmp")),
      [],
      "the temp file must not be left behind",
    );
    assert.equal((await readUsage({ dir }))["2026-08"].pages, 7);
  });
});
