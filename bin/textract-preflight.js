#!/usr/bin/env node
// proves Textract works before any real extraction spends the budget.
//
//   npm run textract:preflight -- data/scanned/some-scan.pdf
//
// this costs AT MOST one page of the 100-page monthly Tables allowance, and it
// is deliberately structured so that the cheap failure modes are found first.
//
// the sequence matters:
//
//   1. environment      free. names what is missing rather than letting the SDK
//                       fail with a generic credentials error much later.
//
//   2. rasterise        free. proves pdf-parse can render this machine's PDFs
//                       to PNG at all, which is the whole plan-B premise.
//
//   3. DetectDocumentText   bills against the 1,000 pages/month DETECTION
//                       allowance, NOT the 100-page Tables one. it answers
//                       three questions at once -- are the credentials real, is
//                       textract:* granted, and is our PNG a format Textract
//                       accepts -- and none of those three is worth discovering
//                       with a page of the scarce quota.
//
//   4. AnalyzeDocument  only if step 3 passed. THIS is the one that costs a
//                       Tables page, and by now the only thing left it can
//                       prove is whether the TABLES feature itself is
//                       authorised, which is a different IAM action.

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

import { AnalyzeDocumentCommand, DetectDocumentTextCommand } from "@aws-sdk/client-textract";

import { TEXTRACT_REGION, textractClient, textractCredentialSummary } from "../src/config/textract.client.js";
import { DEFAULT_DPI, openDocument } from "../src/modules/ingestion/pdfRaster.service.js";
import { blocksToPage } from "../src/modules/ingestion/textractBlocks.js";
import { budgetStatus, recordUsage } from "../src/modules/ingestion/textractCache.service.js";

const argv = process.argv.slice(2);
const detectOnly = argv.includes("--detect-only");
const [target] = argv.filter((argument) => !argument.startsWith("--"));

if (!target) {
  console.error("usage: node bin/textract-preflight.js <a-scanned.pdf> [--detect-only]");
  console.error("  --detect-only  stop after the free-tier detection call; spends no Tables quota");
  process.exit(1);
}

console.log("\nTextract preflight");
console.log("=".repeat(60));

// --- 1. environment -------------------------------------------------------

const credentials = textractCredentialSummary();

console.log(`\n[1/4] environment`);
console.log(`  region                 ${TEXTRACT_REGION}`);
console.log(`  AWS_ACCESS_KEY_ID      ${credentials.hasStaticKeys ? "set" : "not set"}`);
console.log(`  AWS_PROFILE            ${credentials.hasProfile ? process.env.AWS_PROFILE : "not set"}`);

if (!credentials.configured) {
  // not fatal. the SDK can also find an SSO cache or an instance role that is
  // invisible from here, and guessing wrong would block a working setup.
  console.log("  !! neither static keys nor a profile found in the environment.");
  console.log("     the SDK may still find credentials elsewhere; continuing.");
}

// no bucket is checked, and that is not an oversight. this path never touches
// S3 -- s3:PutObject came back AccessDenied, which is precisely why the
// synchronous Bytes API is being used instead of StartDocumentAnalysis.

const budget = await budgetStatus();

console.log(`  this month's usage     ${budget.used}/${budget.budget} pages (${budget.remaining} left)`);

if (budget.remaining < 1) {
  console.error("\nno budget left this month. nothing was sent.\n");
  process.exit(1);
}

// --- 2. rasterise ---------------------------------------------------------

console.log(`\n[2/4] rendering page 1 of ${path.basename(target)}`);

let rendered;
let document;

try {
  // one open for both the page count and the render. reading them through the
  // one-shot helpers loads and parses the whole PDF twice, which on a partner
  // scan of a few hundred megabytes is the slowest thing this command does.
  document = await openDocument(target);

  rendered = await document.renderPage(1, {
    dpi: DEFAULT_DPI,
    onWarn: (message) => console.log(`  !! ${message}`),
  });

  console.log(`  document               ${document.pageCount} page(s)`);
  console.log(`  rendered               ${rendered.width}x${rendered.height} px at ${rendered.dpi} dpi`);
  console.log(`  png size               ${(rendered.png.length / 1024).toFixed(0)} KB`);
} catch (error) {
  console.error(`\ncould not render the pdf: ${error.message}`);
  console.error("nothing was sent to AWS.\n");
  process.exit(1);
} finally {
  // the parser holds a worker thread; without this the command prints its
  // verdict and then never exits.
  await document?.close();
}

const client = textractClient();

/**
 * turns an SDK exception into a sentence that says what to do about it.
 *
 * the distinctions matter enough to spell out: AccessDenied on
 * DetectDocumentText and AccessDenied on AnalyzeDocument are DIFFERENT IAM
 * actions, and throttling is not a permission problem at all -- it just means
 * try again.
 */
function explain(error, action) {
  const name = error.name ?? "Error";

  const guidance = {
    AccessDeniedException:
      `the credentials are valid but not allowed to call ${action}. note this is its own IAM ` +
      `action -- being allowed to call DetectDocumentText does not imply AnalyzeDocument, ` +
      `and AnalyzeDocument with FeatureTypes:["TABLES"] is what this story needs.`,
    SubscriptionRequiredException:
      "the key is valid and the request reached AWS, but this ACCOUNT is not subscribed to " +
      "Textract -- so it is neither a credentials problem nor an IAM policy problem, and no " +
      "amount of granting textract:* on the user will fix it. subscribe the account to Amazon " +
      "Textract in the region above (or use an account that already is).",
    UnsupportedDocumentException:
      "Textract rejected the image itself, which is a format problem and NOT a permission " +
      "problem. the bytes we sent were not a PNG it could decode.",
    InvalidParameterException:
      "the request was malformed -- usually FeatureTypes, or Bytes that are empty.",
    ProvisionedThroughputExceededException:
      "throttled. this is a rate limit, not a permission problem: wait a moment and retry.",
    ThrottlingException: "throttled. a rate limit, not a permission problem. retry.",
    UnrecognizedClientException: "the access key is not recognised. check AWS_ACCESS_KEY_ID.",
    InvalidSignatureException: "the secret key does not match the access key.",
    ExpiredTokenException: "the session token has expired. refresh the credentials.",
    ValidationException: "the request failed validation -- check the region and the image size.",
  }[name];

  return `${name}: ${error.message}${guidance ? `\n     -> ${guidance}` : ""}`;
}

// --- 3. detection (free-tier bucket) --------------------------------------

console.log(`\n[3/4] DetectDocumentText -- bills the 1,000 page/month DETECTION allowance`);
console.log(`      (deliberately first: this proves credentials, textract:* and the PNG format`);
console.log(`       without touching the scarce 100-page Tables allowance)`);

try {
  const response = await client.send(
    new DetectDocumentTextCommand({ Document: { Bytes: rendered.png } }),
  );

  const lines = (response.Blocks ?? []).filter((block) => block.BlockType === "LINE");

  console.log(`  ok                     ${response.Blocks?.length ?? 0} blocks, ${lines.length} lines`);
  console.log(`  model version          ${response.DetectDocumentTextModelVersion ?? "(not reported)"}`);

  if (lines[0]) console.log(`  first line             "${lines[0].Text?.slice(0, 60)}"`);

  // recorded the moment it succeeds, and separately from the Tables call below,
  // so a preflight that fails at step 4 still leaves an accurate ledger.
  await recordUsage({ detectPages: 1, detectCalls: 1 });
} catch (error) {
  console.error(`\n  FAILED ${explain(error, "DetectDocumentText")}`);
  console.error("\nstopping here. no Tables quota was spent.\n");
  process.exit(1);
}

if (detectOnly) {
  console.log("\n--detect-only was given. stopping before the Tables call.\n");
  process.exit(0);
}

// --- 4. table analysis (the expensive one) --------------------------------

console.log(`\n[4/4] AnalyzeDocument FeatureTypes:["TABLES"] -- SPENDS 1 page of ${budget.budget}`);

try {
  const response = await client.send(
    new AnalyzeDocumentCommand({
      Document: { Bytes: rendered.png },
      FeatureTypes: ["TABLES"],
    }),
  );

  const blocks = response.Blocks ?? [];
  const parsed = blocksToPage(blocks, 1);

  console.log(`  ok                     ${blocks.length} blocks`);
  console.log(`  model version          ${response.AnalyzeDocumentModelVersion ?? "(not reported)"}`);
  console.log(`  tables found           ${parsed.tables.length}`);

  for (const table of parsed.tables) {
    console.log(
      `    table ${table.index + 1}: ${table.rowCount}x${table.columnCount}` +
        `, ${table.lowConfidenceCells} low-confidence cell(s)`,
    );
  }

  // the preflight does NOT write to the cache -- it is a probe of one page of
  // one file, and recording it as an extraction would make the cache claim a
  // document is done when only its first page was read.
  //
  // it DOES write to the usage ledger. the page is spent either way, and the
  // ledger is the number the next run's budget check works from; leaving it out
  // and telling the operator to "subtract it by hand" made every subsequent
  // check quietly one page too generous.
  await recordUsage({ pages: 1, calls: 1 });

  await fsp.mkdir("evidence", { recursive: true });
  await fsp.writeFile(
    "evidence/tenise-12-preflight.json",
    `${JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        region: TEXTRACT_REGION,
        file: path.basename(target),
        dpi: rendered.dpi,
        imagePixels: `${rendered.width}x${rendered.height}`,
        detectDocumentText: "ok",
        analyzeDocumentTables: "ok",
        modelVersion: response.AnalyzeDocumentModelVersion ?? null,
        blockCount: blocks.length,
        tablesFound: parsed.tables.length,
        pagesSpent: 1,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log("preflight PASSED. plan B works end to end on this machine.");
  console.log("  1 Tables page and 1 detection page spent, both recorded in usage.json.");
  console.log("  the cache is deliberately NOT written -- only page 1 of the file was read.");
  console.log("\nwritten to evidence/tenise-12-preflight.json");
  console.log("\nnext:  npm run textract -- --dry-run\n");
} catch (error) {
  console.error(`\n  FAILED ${explain(error, "AnalyzeDocument")}`);
  console.error(
    "\nnote that step 3 passed, so credentials and image format are fine --" +
      "\nthis is specifically the TABLES feature being refused or failing.\n",
  );
  process.exit(1);
}
