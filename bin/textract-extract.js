#!/usr/bin/env node
// the one command that spends money.
//
//   npm run textract -- --dry-run          say what it WOULD send. costs nothing.
//   npm run textract                       extract everything in data/scanned/
//   npm run textract -- --file x.pdf       one document
//   npm run textract -- --force            ignore the cache and re-extract
//
// everything else in this story is free: the index build reads a local cache,
// the tests use fixtures, the picker never leaves the machine. this file is the
// only place bytes go to AWS, which is why it is a deliberate, separate,
// human-run command rather than a step inside `npm run build:index`.
//
// three guards stand between the flags and the network, in order:
//
//   TEXTRACT_ENABLED   must be explicitly true. off by default so a mistyped
//                      npm script cannot spend the month.
//   the cache          a document already extracted is never sent again. this
//                      is what makes the second run cost zero pages.
//   assertBudget       refuses -- does not warn -- if the run would take the
//                      month past its cap, or exceed the per-run limit.

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

import { TEXTRACT_REGION, textractCredentialSummary } from "../src/config/textract.client.js";
import { DEFAULT_DPI, countPages } from "../src/modules/ingestion/pdfRaster.service.js";
import { DEFAULT_THRESHOLD } from "../src/modules/ingestion/tableLikelihood.js";
import { analyzeScannedPdf } from "../src/modules/ingestion/textract.service.js";
import {
  assertBudget,
  budgetStatus,
  readCache,
  recordUsage,
  textractCacheDefaults,
  writeCache,
} from "../src/modules/ingestion/textractCache.service.js";
import { API_TYPES } from "../src/shared/constants/telemetry.js";

const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(`--${name}`);
}

function option(name, fallback) {
  const found = argv.find((argument) => argument.startsWith(`--${name}=`));

  if (found) return found.split("=").slice(1).join("=");

  const index = argv.indexOf(`--${name}`);

  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
}

const dryRun = flag("dry-run");
const force = flag("force");
const twoPass = flag("two-pass");
const dpi = Number(option("dpi", DEFAULT_DPI));
const tableThreshold = Number(option("table-threshold", DEFAULT_THRESHOLD));
const singleFile = option("file", null);
const directory = option("dir", "data/scanned");

if (flag("help")) {
  console.log(`
usage: node bin/textract-extract.js [options]

  --dry-run       report what would be sent and what it would cost. no AWS call.
  --file <path>   one pdf instead of the whole folder
  --dir <path>    the folder to scan            (default: data/scanned)
  --dpi <n>       rasterisation resolution      (default: ${DEFAULT_DPI})
  --force         re-extract even if cached. SPENDS THE PAGES AGAIN.

  --two-pass      read every page with DetectDocumentText first -- a separate
                  1,000/month allowance -- and spend a TABLES page only on the
                  pages that look like they hold a table. a 12-page scan with 3
                  table pages costs 3 of the 100 rather than 12.

                  OFF by default. the saving is real but it rests on a
                  heuristic, and a page wrongly judged table-free is never
                  gridded. every page's decision and score is printed.

  --table-threshold <n>
                  how table-like a page must look to be escalated, 0..1
                  (default: ${DEFAULT_THRESHOLD}). 0 sends every page, which
                  makes --two-pass cost the same as not using it.
`);
  process.exit(0);
}

if (twoPass && !(tableThreshold >= 0 && tableThreshold <= 1)) {
  console.error(`--table-threshold must be between 0 and 1, got ${option("table-threshold", "")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// what is there to do
// ---------------------------------------------------------------------------

async function listPdfs() {
  if (singleFile) return [singleFile];

  try {
    const entries = await fsp.readdir(directory, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch {
    return [];
  }
}

const files = await listPdfs();

if (files.length === 0) {
  console.error(`\nno pdfs found in ${singleFile ?? directory}.`);
  console.error("put the scanned documents there, or pass --file <path>.");
  console.error("\nnpm run textract:pick -- <corpus-folder>   finds good candidates\n");
  process.exit(1);
}

console.log(`\nTextract extraction${dryRun ? " (DRY RUN -- nothing will be sent)" : ""}`);
console.log("=".repeat(64));

const status = await budgetStatus();

console.log(`\nregion            ${TEXTRACT_REGION}`);
console.log(`cache             ${textractCacheDefaults.dir}`);
console.log(`this month        ${status.used}/${status.budget} pages used, ${status.remaining} left`);
console.log(`per-run limit     ${textractCacheDefaults.maxPagesPerRun} pages`);
console.log(`dpi               ${dpi}`);

if (twoPass) {
  console.log(
    `mode              two-pass (threshold ${tableThreshold}) -- ` +
      `detection first, TABLES only where a table is likely`,
  );
  console.log(
    `detection month   ${status.detectUsed}/${status.detectBudget} pages used, ` +
      `${status.detectRemaining} left`,
  );
} else {
  console.log(`mode              single-pass -- every page costs a TABLES page`);
}

// printed as the VALUE ACTUALLY IN EFFECT, not as what .env says. these used to
// be read from an environment that had never loaded .env, so a setting could be
// written down, believed, and ignored all at once. showing the resolved value
// makes that failure visible in the line above the one that refuses.
console.log(`TEXTRACT_ENABLED  ${process.env.TEXTRACT_ENABLED ?? "(unset)"}\n`);

// work out the plan before sending anything, so --dry-run and the real run
// agree by construction rather than by two similar-looking code paths.
const plan = [];

for (const filePath of files) {
  const name = path.basename(filePath);

  let pageCount;

  try {
    pageCount = await countPages(filePath);
  } catch (error) {
    console.log(`  ${name.padEnd(44)} unreadable: ${error.message}`);
    continue;
  }

  const cached = force ? null : await readCache(filePath);

  plan.push({ filePath, name, pageCount, cached: Boolean(cached), pages: cached ? 0 : pageCount });
}

const toSend = plan.filter((item) => !item.cached);
const pagesToSend = toSend.reduce((sum, item) => sum + item.pages, 0);

for (const item of plan) {
  const verdict = item.cached
    ? "cached -- 0 pages"
    : `${item.pages} page(s) to send`;

  console.log(`  ${item.name.padEnd(44)} ${verdict}`);
}

console.log(`\n  ${"-".repeat(60)}`);

if (twoPass) {
  // the WORST case, deliberately. the plan cannot know which pages will
  // escalate without sending them, so the guard is asked to clear the full
  // amount and the saving shows up as an underspend afterwards. planning for
  // the hoped-for number would be a budget check that passes on an estimate and
  // is then exceeded in the loop.
  console.log(`  ${plan.length} file(s), up to ${pagesToSend} TABLES page(s) -- worst case, if EVERY`);
  console.log(`  page turns out to hold a table. ${pagesToSend} detection page(s) either way.`);
  console.log(`  leaving at least ${status.remaining - pagesToSend} of this month's ${status.budget}\n`);
} else {
  console.log(`  ${plan.length} file(s), ${pagesToSend} page(s) would be sent`);
  console.log(`  leaving ${status.remaining - pagesToSend} of this month's ${status.budget}\n`);
}

if (dryRun) {
  console.log("dry run. nothing was sent.\n");
  process.exit(0);
}

if (pagesToSend === 0) {
  // the acceptance condition for caching, visible in the output: run it twice
  // and the second run reports zero.
  console.log("everything is already cached. no pages sent, nothing billed.\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// the guards
// ---------------------------------------------------------------------------

if (process.env.TEXTRACT_ENABLED !== "true") {
  console.error("TEXTRACT_ENABLED is not 'true'. refusing to send anything.");
  console.error("set it in .env once you have checked the page count above.\n");
  process.exit(1);
}

const credentials = textractCredentialSummary();

if (!credentials.configured) {
  console.log("!! no AWS keys or profile in the environment. the SDK may still find");
  console.log("   credentials elsewhere -- continuing, but this is the usual cause of");
  console.log("   an UnrecognizedClientException below.\n");
}

try {
  // under two-pass every page goes through detection whether or not it
  // escalates, so both allowances are checked against the same worst case.
  await assertBudget(pagesToSend, { detectPages: twoPass ? pagesToSend : 0 });
} catch (error) {
  console.error(`\nrefused: ${error.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// the extraction itself
//
// wrapped in a function because it is driven two different ways depending on
// what telemetry is available -- see the section below. the work is identical
// either way; only who is measuring it differs.
// ---------------------------------------------------------------------------

const results = [];
const startedAt = Date.now();

let totalPages = 0;
let totalCalls = 0;
let totalDetectPages = 0;

async function extractAll() {
  for (const item of toSend) {
    console.log(`${item.name} -- ${item.pageCount} page(s)`);

    const result = await analyzeScannedPdf(item.filePath, {
      dpi,
      twoPass,
      tableThreshold,
      onWarn: (message) => console.log(`    !! ${message}`),
      onPage: (event) => {
        if (event.ok) {
          // under two-pass, say which API read the page and how table-like it
          // looked. a filter in front of a capped resource that does not show
          // its working cannot be told apart from a filter that is dropping
          // tables, and the score is the only way to review a skip after the
          // fact without paying to look again.
          const decision = event.likelihood
            ? ` [${event.mode === "tables" ? "TABLES" : "detect"} ${event.likelihood.score.toFixed(2)}]`
            : "";

          console.log(
            `    page ${String(event.pageNumber).padStart(3)}  ok  ${decision} ` +
              `${event.tables} table(s), ${event.characters} chars` +
              (event.lowConfidenceCells > 0 ? `, ${event.lowConfidenceCells} low-confidence cell(s)` : ""),
          );
        } else {
          console.log(`    page ${String(event.pageNumber).padStart(3)}  FAIL ${event.error}`);
        }
      },
    });

    // the ledger is updated with what was ACTUALLY spent, and before the cache
    // is even considered. a document that failed halfway still consumed its
    // pages, and a ledger that forgot them would let the next run overspend.
    totalPages += result.pagesSent;
    totalCalls += result.apiCalls;
    totalDetectPages += result.detectPages;

    await recordUsage({
      pages: result.pagesSent,
      calls: result.apiCalls,
      detectPages: result.detectPages,
      detectCalls: result.detectCalls,
    });

    const cachePath = await writeCache(item.filePath, result);

    if (cachePath) {
      console.log(`    cached -> ${cachePath}`);
    } else {
      // writeCache refusing is the guard working, not a bug. see its comment.
      console.log(
        `    NOT cached -- ${result.failures.length} page(s) failed. ` +
          `re-run to retry them; the pages that succeeded will be charged again.`,
      );
    }

    results.push({
      file: item.name,
      pageCount: result.pageCount,
      pagesSent: result.pagesSent,
      apiCalls: result.apiCalls,
      detectPages: result.detectPages,
      pageModes: result.pageModes,
      tables: result.tables.length,
      lowConfidenceCells: result.tables.reduce((sum, table) => sum + table.lowConfidenceCells, 0),
      failures: result.failures,
      complete: result.complete,
      cached: Boolean(cachePath),
      modelVersion: result.modelVersion,
      detectModelVersion: result.detectModelVersion,
    });

    if (twoPass) {
      const skipped = result.pageModes.filter((mode) => mode === "detect").length;

      console.log(
        `    ${result.tables.length} table(s) found -- ${result.pagesSent} TABLES page(s) spent, ` +
          `${skipped} page(s) read on the detection allowance instead ` +
          `(${item.pageCount - result.pagesSent} saved)\n`,
      );
    } else {
      console.log(`    ${result.tables.length} table(s) found across the document\n`);
    }
  }

  // the shape runIngestion's toUsage() expects, so the same return value feeds
  // either telemetry path unchanged.
  return { pages: totalPages, apiCalls: totalCalls, documents: results.length };
}

// ---------------------------------------------------------------------------
// telemetry
//
// runIngestion's `handlers` parameter was left there for exactly this moment.
// its PIPELINE already binds the extract stage to API_TYPES.TEXTRACT, and that
// stage has recorded skipStage("not_implemented") on every run since it was
// written because nothing ever filled it in. supplying a handler turns it from
// a stub into measured volume with no change to the record structure, which is
// what TENISE-26 asked for.
//
// it needs a Source document in Mongo, though, and this command is normally run
// on a laptop with no Mongo at all. so: use runIngestion when there is a source
// to attach to, and otherwise measure the same numbers directly and say plainly
// that the stage was not recorded. persistTelemetryRecord silently does nothing
// without Mongo, so a run that looked recorded and was not is a real risk worth
// one line of warning.
//
// Source has no field naming a file on disk, which is why the handler closes
// over the paths instead. that keeps this out of the model and out of the
// storage layer, which is a teammate's unfinished work.
// ---------------------------------------------------------------------------

const sourceId = option("source-id", null);

let record;
let finalStatus;

if (sourceId && process.env.MONGODB_URI) {
  console.log(`recording against source ${sourceId} via runIngestion\n`);

  const [{ runIngestion }, { connectMongoDB, disconnectMongoDB }] = await Promise.all([
    import("../src/modules/ingestion/ingestion.service.js"),
    import("../src/infrastructure/database/mongodb.service.js"),
  ]);

  await connectMongoDB();

  try {
    // the handler returns { pages, apiCalls, documents }, which runIngestion
    // hands straight to recordApiUsage under API_TYPES.TEXTRACT -- the binding
    // that has been sitting in its PIPELINE unused since it was written.
    const summary = await runIngestion(sourceId, { handlers: { extract: () => extractAll() } });

    record = { recordId: summary.telemetryRecordId, ingestion: { byApi: summary.volume.byApi } };

    console.log(`extract stage: ${summary.stages.extract}`);
  } catch (error) {
    // runIngestion has already marked the run failed and set the source to
    // "failed"; it rethrows so the caller knows. without this the command dies
    // with a raw stack trace, and the useful part -- which is that this is
    // almost always credentials -- is buried in it.
    console.error(`\n  FAILED: ${error.name ?? "Error"}: ${error.message}`);
    console.error("\n  npm run textract:preflight -- <file>   diagnoses it in one page.");
    console.error("  whatever was spent before the failure is already in the ledger.\n");

    await disconnectMongoDB().catch(() => {});
    process.exit(1);
  } finally {
    // mongoose holds the event loop open; without this the command prints its
    // summary and then never exits.
    await disconnectMongoDB().catch(() => {});
  }

  finalStatus = await budgetStatus();
} else {
  const { startTelemetryRun } = await import(
    "../src/modules/telemetry/services/telemetryRecorder.service.js"
  );
  const { QUERY_CLASSES, RUN_STATUSES, TELEMETRY_RUN_TYPES } = await import(
    "../src/shared/constants/telemetry.js"
  );

  if (!process.env.MONGODB_URI) {
    console.log("!! MONGODB_URI is not set. the run is still measured and written to");
    console.log("   evidence/, but NOT persisted to the telemetry store, and the");
    console.log("   extract stage of runIngestion stays 'not_implemented' in Mongo.");
    console.log("   pass --source-id <id> with Mongo running to record it there.\n");
  }

  const run = startTelemetryRun({
    runType: TELEMETRY_RUN_TYPES.INGESTION,
    queryClass: QUERY_CLASSES.NOT_APPLICABLE,
    correlationId: `textract:${new Date().toISOString()}`,
  });

  try {
    await extractAll();
  } catch (error) {
    // credentials or permissions. every remaining file would fail identically,
    // so stop rather than printing the same error once per document.
    console.error(`\n  FAILED: ${error.name ?? "Error"}: ${error.message}`);
    console.error("\n  this is a credentials or permissions problem, so the run is stopping");
    console.error("  rather than repeating the same error for every remaining file.");
    console.error("  npm run textract:preflight -- <file>   diagnoses it in one page.\n");

    run.fail(error);
    await run.finish(RUN_STATUSES.FAILED);

    // whatever was spent before the failure is already in the ledger.
    process.exit(1);
  }

  // the figure TENISE-26 asks for: real Textract volume on a real key, split by
  // the API that bills it.
  run.recordApiUsage(API_TYPES.TEXTRACT, {
    pages: totalPages,
    apiCalls: totalCalls,
    documents: results.length,
    durationMs: Date.now() - startedAt,
  });

  record = await run.finish(RUN_STATUSES.SUCCESS);
  finalStatus = await budgetStatus();
}

const plannedPages = toSend.reduce((sum, item) => sum + item.pages, 0);

const evidence = {
  ranAt: new Date().toISOString(),
  region: TEXTRACT_REGION,
  dpi,
  api: twoPass
    ? "DetectDocumentText then AnalyzeDocument where a table was likely (synchronous, Bytes)"
    : "AnalyzeDocument (synchronous, Bytes)",
  featureTypes: ["TABLES"],
  twoPass,
  tableThreshold: twoPass ? tableThreshold : null,
  documents: results,
  totals: {
    documents: results.length,
    pagesSent: totalPages,
    apiCalls: totalCalls,
    // the separate allowance. kept out of pagesSent on purpose -- that number
    // is the capped one, and the acceptance condition reads it.
    detectPages: totalDetectPages,
    // what the same run would have cost with every page sent to TABLES. this is
    // the whole claim of two-pass, so it is recorded rather than asserted.
    tablePagesSaved: twoPass ? plannedPages - totalPages : 0,
    tables: results.reduce((sum, item) => sum + item.tables, 0),
    durationMs: Date.now() - startedAt,
  },
  budget: finalStatus,
  telemetry: {
    recordId: record.recordId ?? null,
    persisted: Boolean(process.env.MONGODB_URI),
    // the specific path an assessor checks against the acceptance condition.
    textractPages: record.ingestion?.byApi?.[API_TYPES.TEXTRACT]?.pages ?? null,
  },
};

await fsp.mkdir("evidence", { recursive: true });
await fsp.writeFile(
  "evidence/tenise-12-textract-run.json",
  `${JSON.stringify(evidence, null, 2)}\n`,
);

console.log("=".repeat(64));
console.log(`${results.length} document(s), ${totalPages} TABLES page(s) sent, ${totalCalls} API call(s)`);

if (twoPass) {
  console.log(
    `${totalDetectPages} detection page(s) on the separate allowance -- ` +
      `${evidence.totals.tablePagesSaved} TABLES page(s) saved against sending every page`,
  );
  console.log(
    `detection now ${finalStatus.detectUsed}/${finalStatus.detectBudget} ` +
      `(${finalStatus.detectRemaining} left)`,
  );
}

console.log(`${evidence.totals.tables} table(s) extracted`);
console.log(`budget now ${finalStatus.used}/${finalStatus.budget} (${finalStatus.remaining} left)`);
console.log(`telemetry ingestion.byApi.textract.pages = ${evidence.telemetry.textractPages}`);
console.log("\nwritten to evidence/tenise-12-textract-run.json");
console.log("\nnext:");
console.log("  npm run textract:checklist                 build the cell-accuracy checklist");
console.log("  npm run build:index -- --append data/scanned   index the tables\n");
