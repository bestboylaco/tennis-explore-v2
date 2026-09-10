// caches Textract output and guards the monthly page budget (TENISE-12 / E2-06).
//
// this file exists because Textract is the only part of the pipeline that costs
// real money and is capped. the free tier gives 100 pages of table analysis a
// month; there is no way to buy the cap back once it is gone, and a mistake
// that re-sends a document is not recoverable by re-running. so nothing here is
// an optimisation -- every function is a guard.
//
// two guards, in order:
//
//   the cache   a document already extracted is never sent again. this is what
//               makes "run it twice, the second run costs nothing" true, and it
//               is why data/textract-cache/ is committed rather than ignored:
//               a teammate cloning the repo inherits the pages we already paid
//               for instead of spending their own.
//
//   the ledger  a running total per calendar month, checked BEFORE any bytes
//               leave the machine. it refuses rather than warns, because a
//               warning printed into a scrolling log is not a guard.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const DEFAULT_DIR = process.env.TEXTRACT_CACHE_DIR || "data/textract-cache";
const USAGE_FILE = "usage.json";

// the free tier's table-analysis allowance. deliberately the real number rather
// than something conservative -- a lower default would silently under-use a
// budget that expires at the end of the month anyway.
const DEFAULT_MONTHLY_BUDGET = Number(process.env.TEXTRACT_MONTHLY_PAGE_BUDGET ?? 100);

// the second guard: no single run may spend more than this, whatever the month
// has left. it is what stops a 400-page pdf handed over by mistake from
// consuming the entire allowance in one command on the first of the month.
const DEFAULT_MAX_PAGES_PER_RUN = Number(process.env.TEXTRACT_MAX_PAGES_PER_RUN ?? 20);

// the DETECTION allowance, which is a different and much larger bucket: 1,000
// pages a month against TABLES' 100, and about a tenth the price beyond it.
// two-pass extraction reads every page through this one, so it needs a guard of
// its own -- it is far harder to exhaust, but it is not free either.
const DEFAULT_MONTHLY_DETECT_BUDGET = Number(process.env.TEXTRACT_MONTHLY_DETECT_BUDGET ?? 1000);

/** yyyy-mm. the ledger is keyed by calendar month because the budget is. */
function monthKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * the cache key: a sha256 over the file's bytes.
 *
 * not the path, and not the mtime. the corpus lives outside the repo and is
 * re-synced from s3, which rewrites both -- keying on either would make every
 * re-sync a full-price re-extraction of documents we already hold. the bytes
 * are the document; if they change it really is a different document and it
 * really does need sending again.
 */
async function hashFile(filePath) {
  // streamed rather than read whole. this runs on every cache probe, including
  // once per candidate in the extraction plan, and the partner corpus holds
  // PDFs of a few hundred megabytes -- buffering one entirely to hash it costs
  // that much resident memory for a value that is consumed a chunk at a time.
  const hash = crypto.createHash("sha256");

  await pipeline(fs.createReadStream(filePath), hash);

  return hash.digest("hex");
}

function docIdFor(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[^A-Za-z0-9._-]+/g, "_");
}

/**
 * finds the cache entry for a hash, wherever it was filed.
 *
 * the filename carries the docId purely so a human can see what is in the
 * directory. the hash suffix is the real key, so lookup matches on the suffix
 * and a document that arrived under a different name still hits.
 */
async function findEntry(dir, sha256) {
  const suffix = `.${sha256.slice(0, 12)}.json`;

  try {
    const entries = await fsp.readdir(dir);

    const match = entries.find((name) => name.endsWith(suffix));

    return match ? path.join(dir, match) : null;
  } catch {
    // no cache directory yet. that is a miss, not an error.
    return null;
  }
}

/**
 * returns the cached extraction for a file, or null.
 *
 * pure local io -- this never calls AWS, which is what lets the extraction
 * pipeline consult it on every scanned pdf without any cost or credentials.
 */
export async function readCache(filePath, { dir = DEFAULT_DIR } = {}) {
  let sha256;

  try {
    sha256 = await hashFile(filePath);
  } catch {
    return null;
  }

  const entryPath = await findEntry(dir, sha256);

  if (!entryPath) return null;

  try {
    const entry = JSON.parse(await fsp.readFile(entryPath, "utf8"));

    // the suffix could collide in principle; the stored hash is the real check.
    // an incomplete entry should never have been written, but if one exists it
    // is treated as a miss rather than trusted.
    if (entry.sha256 !== sha256 || entry.complete !== true) return null;

    return entry;
  } catch {
    return null;
  }
}

/**
 * writes an extraction to the cache -- but ONLY if it is complete.
 *
 * this refusal is the point of the function. "page 3 threw, pages 1, 2, 4 and 5
 * came back" is an ordinary event when sending twenty pages one at a time, and
 * caching that result would be the worst possible outcome: every later run
 * reports a hit, the missing page never reappears, and because the run now
 * costs nothing there is no pressure to notice. an incomplete document is left
 * uncached so the next run retries it, and the CLI says which pages failed.
 *
 * the same instinct as ocr_scanned.py refusing to keep a sidecar when the yield
 * looks too low -- a partial result that is indistinguishable from a good one
 * is worse than no result.
 *
 * @returns the path written, or null if the result was rejected.
 */
export async function writeCache(filePath, result, { dir = DEFAULT_DIR } = {}) {
  if (result?.complete !== true) return null;

  // a self-consistency check on top of the caller's own flag: a result claiming
  // completeness while holding fewer pages than the document has is not
  // complete, whoever set the flag.
  if ((result.pages?.length ?? 0) !== result.pageCount) return null;

  const sha256 = await hashFile(filePath);
  const docId = docIdFor(filePath);
  const entryPath = path.join(dir, `${docId}.${sha256.slice(0, 12)}.json`);

  const entry = {
    sourceFile: path.basename(filePath),
    docId,
    sha256,
    pageCount: result.pageCount,
    dpi: result.dpi ?? null,
    pages: result.pages,
    // which API read each page. a "detect" page was never table-analysed, so a
    // later run can go back and upgrade just those rather than re-sending the
    // whole document -- and an entry with no tables means something different
    // depending on whether anything ever looked. an entry written before this
    // field existed has no pageModes, which reads as "all of them were".
    pageModes: result.pageModes ?? null,
    twoPass: result.twoPass ?? false,
    tables: result.tables ?? [],
    complete: true,
    // false for anything that came from Textract. true only for an entry seeded
    // locally to exercise the downstream pipeline without AWS.
    //
    // this flag exists because the acceptance condition is a cell-accuracy
    // percentage, and a checklist built from invented cells would score 100%
    // while proving nothing at all. marking it in the entry itself means the
    // checklist can refuse rather than relying on whoever generated it to
    // remember which directory held the real data.
    synthetic: result.synthetic === true,
    extractedAt: new Date().toISOString(),
  };

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(entryPath, `${JSON.stringify(entry, null, 2)}\n`);

  return entryPath;
}

// ---------------------------------------------------------------------------
// the budget ledger
// ---------------------------------------------------------------------------

function usagePath(dir) {
  return path.join(dir, USAGE_FILE);
}

/** the whole ledger: { "2026-08": { pages, calls } }. */
export async function readUsage({ dir = DEFAULT_DIR } = {}) {
  try {
    return JSON.parse(await fsp.readFile(usagePath(dir), "utf8"));
  } catch {
    // no ledger is a month with nothing spent, not a failure.
    return {};
  }
}

/**
 * adds a run's usage to this month's total.
 *
 * called after the pages have actually been sent, with what was really spent --
 * not with what was planned. a run that dies halfway must leave the ledger
 * showing the pages it did consume, or the next run's budget check is working
 * from a number that is too low.
 */
export async function recordUsage(
  { pages = 0, calls = 0, detectPages = 0, detectCalls = 0 },
  { dir = DEFAULT_DIR, now = new Date() } = {},
) {
  const ledger = await readUsage({ dir });
  const month = monthKey(now);
  const current = ledger[month] ?? {};

  // `pages` stays the TABLES count -- the capped one, and the number every
  // existing reader of this file already means by it. detection is tracked
  // separately because it bills a different, far larger allowance, and adding
  // it into the same total would make the cap look ten times closer than it is.
  //
  // read through ?? so a ledger written before detection was tracked stays
  // valid rather than turning into NaN on the first two-pass run.
  ledger[month] = {
    pages: (current.pages ?? 0) + pages,
    calls: (current.calls ?? 0) + calls,
    detectPages: (current.detectPages ?? 0) + detectPages,
    detectCalls: (current.detectCalls ?? 0) + detectCalls,
  };

  await writeLedger(dir, ledger);

  return ledger[month];
}

/**
 * writes the ledger atomically: a full temp file, then a rename over the old one.
 *
 * a plain writeFile truncates first, so a crash or a full disk between the
 * truncate and the write leaves an empty or half-written usage.json -- which
 * readUsage then reads as a month with nothing spent, and the next run happily
 * re-spends a budget that is already gone. rename is atomic on both Windows and
 * POSIX, so a reader sees either the old ledger or the new one and never a
 * partial one. indexBuilder.writeState already does this; the ledger is the file
 * where losing it actually costs money.
 */
async function writeLedger(dir, ledger) {
  const target = usagePath(dir);
  const temporary = `${target}.${process.pid}.tmp`;

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`);

  try {
    await fsp.rename(temporary, target);
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** what the current month has spent and has left. reads only; costs nothing. */
export async function budgetStatus({
  dir = DEFAULT_DIR,
  monthlyBudget = DEFAULT_MONTHLY_BUDGET,
  detectBudget = DEFAULT_MONTHLY_DETECT_BUDGET,
  now = new Date(),
} = {}) {
  const ledger = await readUsage({ dir });
  const month = monthKey(now);
  const used = ledger[month]?.pages ?? 0;
  const detectUsed = ledger[month]?.detectPages ?? 0;

  return {
    month,
    used,
    budget: monthlyBudget,
    remaining: Math.max(0, monthlyBudget - used),
    // reported alongside rather than folded in. the two allowances are separate
    // and are nowhere near each other in size, so one "remaining" covering both
    // would be meaningless.
    detectUsed,
    detectBudget,
    detectRemaining: Math.max(0, detectBudget - detectUsed),
  };
}

/**
 * refuses a run that would overspend. throws rather than returning false.
 *
 * throwing is deliberate: this is called immediately before the loop that sends
 * bytes to AWS, and a boolean that a caller forgets to check is not a guard. the
 * message names both numbers so the operator can see how close they were rather
 * than just being told no.
 */
export async function assertBudget(
  pages,
  {
    dir = DEFAULT_DIR,
    monthlyBudget = DEFAULT_MONTHLY_BUDGET,
    detectBudget = DEFAULT_MONTHLY_DETECT_BUDGET,
    maxPerRun = DEFAULT_MAX_PAGES_PER_RUN,
    // pages that will go through DetectDocumentText. under two-pass this is
    // every page of the run, whether or not it then escalates.
    detectPages = 0,
    now = new Date(),
  } = {},
) {
  if (pages > maxPerRun) {
    throw new Error(
      `this run would send ${pages} pages, over the ${maxPerRun}-page per run limit. ` +
        `raise TEXTRACT_MAX_PAGES_PER_RUN if that is really intended, or send fewer files ` +
        `at a time -- the cap exists so one mistaken command cannot spend the whole month.`,
    );
  }

  const status = await budgetStatus({ dir, monthlyBudget, detectBudget, now });

  if (status.used + pages > monthlyBudget) {
    throw new Error(
      `this run would send ${pages} pages, but ${status.month} has already used ` +
        `${status.used} of its ${monthlyBudget}-page monthly budget (${status.remaining} left). ` +
        `nothing has been sent.`,
    );
  }

  // the detection allowance is ten times larger, so this refuses far less often
  // -- but a two-pass run reads EVERY page through it, including the ones that
  // never cost a TABLES page, so it is the guard that a large run hits first.
  if (status.detectUsed + detectPages > detectBudget) {
    throw new Error(
      `this run would read ${detectPages} pages with DetectDocumentText, but ${status.month} ` +
        `has already used ${status.detectUsed} of its ${detectBudget}-page detection budget ` +
        `(${status.detectRemaining} left). nothing has been sent.`,
    );
  }

  return status;
}

export const textractCacheDefaults = Object.freeze({
  dir: DEFAULT_DIR,
  monthlyBudget: DEFAULT_MONTHLY_BUDGET,
  detectBudget: DEFAULT_MONTHLY_DETECT_BUDGET,
  maxPagesPerRun: DEFAULT_MAX_PAGES_PER_RUN,
});
