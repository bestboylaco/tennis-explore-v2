#!/usr/bin/env node
// pulls the CloudTrail record of the AnalyzeDocument calls.
//
//   npm run textract:cloudtrail
//   npm run textract:cloudtrail -- --redact-identity
//   npm run textract:cloudtrail -- --reconcile            check usage.json
//   npm run textract:cloudtrail -- --reconcile --event=DetectDocumentText
//   npm run textract:cloudtrail -- --month=2026-08        an earlier month
//
// this is the "you really did call the API" evidence. it wraps the AWS CLI
// rather than the SDK on purpose: the command is reproducible by hand, and an
// assessor can run the same line themselves without this repo.
//
// three things that will otherwise waste an afternoon:
//
//   events are DELAYED, up to about 15 minutes. an empty result immediately
//   after a run does not mean the call did not happen.
//
//   lookup-events is REGIONAL and only goes back 90 days. querying the wrong
//   region returns an empty list that reads exactly like "it never happened",
//   which is the single easiest way to conclude the story failed when it
//   worked.
//
//   whether Textract's data-plane calls appear in management events at all is
//   not guaranteed. if they do not, the fallback first-hand evidence is the
//   AnalyzeDocumentModelVersion in evidence/tenise-12-textract-run.json plus
//   the telemetry page count -- and the acceptance condition asks for
//   CloudTrail OR telemetry, not both.
//
// the output contains userIdentity (an IAM ARN and account id) and
// sourceIPAddress, and it is committed to git. --redact-identity replaces those
// with placeholders: what needs proving is that AnalyzeDocument happened, when,
// and how often -- not who ran it or from where. see
// docs/data-threat-model-and-classification.md.

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

import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";

import { TEXTRACT_REGION } from "../src/config/textract.client.js";
import { readUsage, textractCacheDefaults } from "../src/modules/ingestion/textractCache.service.js";

const run = promisify(execFile);
const argv = process.argv.slice(2);

const redact = argv.includes("--redact-identity");
const reconcile = argv.includes("--reconcile");
const eventName = argv.find((a) => a.startsWith("--event="))?.split("=")[1] ?? "AnalyzeDocument";
const OUTPUT = "evidence/tenise-12-cloudtrail.json";

/** yyyy-mm, matching the ledger's own UTC month key. */
const monthKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const month = argv.find((a) => a.startsWith("--month="))?.split("=")[1] ?? monthKey(new Date());

if (!/^\d{4}-\d{2}$/.test(month)) {
  console.error(`--month must look like 2026-09, got "${month}"`);
  process.exit(1);
}

/**
 * every event of one name in one month, following NextToken to the end.
 *
 * paging matters more than it looks. lookup-events returns at most 50 events a
 * call, so the old single request silently truncated at 50 -- fine as a sample
 * of evidence, useless as a count to reconcile a ledger against, because a
 * month with 80 calls and a month with 500 both come back as 50.
 *
 * the window is bounded to the month being reconciled for the same reason: an
 * unbounded lookup returns up to 90 days of history, and comparing three months
 * of events against one month of ledger would report a huge phantom underspend.
 */
async function lookupAll(name) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  const collected = [];

  let nextToken = null;

  do {
    const { stdout } = await run(
      "aws",
      [
        "cloudtrail",
        "lookup-events",
        "--lookup-attributes",
        `AttributeKey=EventName,AttributeValue=${name}`,
        "--region",
        TEXTRACT_REGION,
        "--start-time",
        start.toISOString(),
        "--end-time",
        end.toISOString(),
        "--max-results",
        "50",
        ...(nextToken ? ["--next-token", nextToken] : []),
        "--output",
        "json",
      ],
      { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
    );

    const page = JSON.parse(stdout);

    collected.push(...(page.Events ?? []));
    nextToken = page.NextToken ?? null;
  } while (nextToken);

  return collected;
}

console.log(`\nlooking up ${eventName} events in ${TEXTRACT_REGION} for ${month}`);
console.log("(CloudTrail lags by up to ~15 minutes -- an empty result right after a run is normal)\n");

let rawEvents;

try {
  rawEvents = await lookupAll(eventName);
} catch (error) {
  console.error(`the aws cli call failed: ${error.message.slice(0, 400)}`);
  console.error("\nchecks:");
  console.error("  aws --version                 is the cli installed");
  console.error("  aws sts get-caller-identity   are the credentials working");
  console.error("  cloudtrail:LookupEvents       is that permission granted");
  console.error("\nif LookupEvents is denied, that is not a failure of this story --");
  console.error("the acceptance condition accepts the telemetry page count instead.\n");
  process.exit(1);
}

const events = rawEvents.map((event) => {
  // CloudTrailEvent arrives as a JSON string inside the JSON.
  let detail = {};

  try {
    detail = JSON.parse(event.CloudTrailEvent ?? "{}");
  } catch {
    detail = {};
  }

  const identity = redact
    ? { redacted: "userIdentity removed -- see --redact-identity in bin/textract-cloudtrail.js" }
    : detail.userIdentity ?? null;

  return {
    eventId: event.EventId,
    eventName: event.EventName,
    eventTime: event.EventTime,
    eventSource: event.EventSource,
    awsRegion: detail.awsRegion ?? TEXTRACT_REGION,
    // the fields that carry the proof: what was called, when, and whether it
    // succeeded. these are never redacted.
    errorCode: detail.errorCode ?? null,
    requestId: detail.requestID ?? null,
    userIdentity: identity,
    sourceIPAddress: redact ? "redacted" : detail.sourceIPAddress ?? null,
    userAgent: detail.userAgent ?? null,
  };
});

events.sort((a, b) => String(a.eventTime).localeCompare(String(b.eventTime)));

console.log(`${events.length} event(s) found\n`);

for (const event of events.slice(0, 20)) {
  console.log(
    `  ${event.eventTime}  ${event.eventName}  ${event.awsRegion}` +
      (event.errorCode ? `  ERROR ${event.errorCode}` : "  ok"),
  );
}

if (events.length > 20) console.log(`  ...and ${events.length - 20} more`);

// ---------------------------------------------------------------------------
// reconciliation
//
// usage.json is written by this machine, and it drifts: a run killed between
// spending and recording, a teammate using the same key on another laptop, a
// month where somebody ran the preflight from an older checkout. CloudTrail is
// the only record that is not ours.
//
// but it is NOT authoritative in the other direction, and that asymmetry is the
// whole design of what follows. Textract's data-plane calls are not guaranteed
// to appear in management events at all -- this file has said so since it was
// written -- so "CloudTrail shows fewer calls than the ledger" has two readings:
// the ledger over-counts, or CloudTrail simply does not record them here. Only
// one of those is safe to act on.
//
// so reconciliation only ever raises the ledger, never lowers it. lowering it
// on a silent trail would hand back budget that has really been spent, and the
// next run would sail past a cap that was already reached.
// ---------------------------------------------------------------------------

let reconciliation = null;

if (reconcile) {
  const ledger = await readUsage();
  const recorded = ledger[month] ?? { pages: 0, calls: 0, detectPages: 0, detectCalls: 0 };

  const successes = events.filter((event) => !event.errorCode).length;
  const isTables = eventName === "AnalyzeDocument";
  const ledgerCount = isTables ? recorded.pages ?? 0 : recorded.detectPages ?? 0;
  const allowance = isTables ? "TABLES" : "detection";

  console.log(`\n${"-".repeat(60)}`);
  console.log(`reconciling ${month} -- ${eventName} against the ${allowance} allowance`);
  console.log(`  usage.json          ${ledgerCount} page(s)`);
  console.log(`  CloudTrail          ${successes} successful event(s) of ${events.length} total`);

  let verdict;

  if (events.length === 0) {
    verdict = "no-trail";
    console.log(`\n  CloudTrail returned nothing for ${month}.`);
    console.log("  this is NOT evidence that nothing was spent. Textract data-plane calls");
    console.log("  are not guaranteed to appear in management events, events lag ~15");
    console.log(`  minutes, and lookup-events is regional (${TEXTRACT_REGION}).`);
    console.log(`  the ledger is left at ${ledgerCount} -- unchanged.`);
  } else if (successes > ledgerCount) {
    verdict = "ledger-behind";
    console.log(`\n  !! CloudTrail records ${successes - ledgerCount} MORE call(s) than the ledger.`);
    console.log("  pages were spent that this machine did not record -- another machine,");
    console.log("  an interrupted run, or a preflight from an older checkout.");
    console.log(`  raise ${textractCacheDefaults.dir}/usage.json for ${month} to ${successes}`);
    console.log("  before the next run, or that run will overspend the cap.");
  } else if (successes < ledgerCount) {
    verdict = "trail-behind";
    console.log(`\n  CloudTrail records ${ledgerCount - successes} FEWER call(s) than the ledger.`);
    console.log("  the ledger is deliberately NOT lowered. it is the conservative number,");
    console.log("  and a trail that under-reports is far more likely than a ledger that");
    console.log("  invented spending -- see the note above.");
  } else {
    verdict = "match";
    console.log(`\n  match. the ledger and CloudTrail agree on ${successes} page(s).`);
  }

  reconciliation = { month, allowance, ledgerPages: ledgerCount, cloudTrailSuccesses: successes, verdict };
}

await fsp.mkdir("evidence", { recursive: true });
await fsp.writeFile(
  OUTPUT,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      region: TEXTRACT_REGION,
      eventName,
      month,
      identityRedacted: redact,
      reconciliation,
      eventCount: events.length,
      successCount: events.filter((event) => !event.errorCode).length,
      firstEventAt: events[0]?.eventTime ?? null,
      lastEventAt: events.at(-1)?.eventTime ?? null,
      note:
        "CloudTrail lookup-events is regional and retains 90 days. An empty result " +
        "does not prove the API was not called -- events lag by up to ~15 minutes, and " +
        "Textract data-plane calls are not guaranteed to appear in management events. " +
        "The telemetry page count in tenise-12-textract-run.json is the alternative " +
        "evidence the acceptance condition accepts.",
      events,
    },
    null,
    2,
  )}\n`,
);

if (events.length === 0) {
  console.log("\nno events. before concluding the calls did not happen, check:");
  console.log(`  - has it been 15 minutes since the run?`);
  console.log(`  - is ${TEXTRACT_REGION} the region the extraction actually ran in?`);
  console.log(`  - does CloudTrail record Textract data-plane calls on this account at all?`);
  console.log("\nevidence/tenise-12-textract-run.json carries the model version and page");
  console.log("count either way, and the acceptance condition accepts that instead.");
}

console.log(`\nwritten to ${OUTPUT}${redact ? " (identity redacted)" : ""}`);

if (!redact) {
  console.log("\n!! this file contains an IAM ARN, an account id and a source IP, and it");
  console.log("   is committed to git. re-run with --redact-identity if that is not");
  console.log("   wanted -- the proof does not depend on those fields.\n");
} else {
  console.log("");
}
