#!/usr/bin/env node
// TENISE-68: does "low" actually cost less than "high", on the SAME
// question, through the real pipeline (ollama + the real built index)?
//
//   npm run eval:effort
//
// four questions, pulled straight from queries/gold_set.json rather than
// invented for this script, covering the shapes effort is supposed to act
// on differently:
//
//   SH-01   single_hop,   unstructured  -- no decomposition either way
//   MS-01   multi_hop,    unstructured  -- the comparison shape decomposition
//                                          exists for (see MULTI_HOP_SIGNALS)
//   SUM-01  summarisation,unstructured  -- the widest topN baseline (20), so
//                                          the fast/thorough topN scale is
//                                          the most visible here
//   AGG-01  aggregation,  structured    -- intended as a negative control:
//                                          answerFromTables() never calls
//                                          retrieve()/rerankCandidates()/
//                                          expandQuery(), by inspection of
//                                          answer.service.js, so effort is
//                                          structurally inert there. BUT: if
//                                          this environment has no
//                                          structured tables loaded (no
//                                          match-data corpus -- a known,
//                                          already-documented gap, see
//                                          memory/demo_blocked_missing_
//                                          match_data.md), answerFromTables
//                                          abstains immediately and
//                                          answerQuestion falls through to
//                                          answerFromDocuments -- which IS
//                                          effort-sensitive. so on a machine
//                                          with no table data this question
//                                          stops being a control and starts
//                                          being a live demonstration of
//                                          EXPANSION_ENABLED specifically
//                                          (see the printed `rephrasedAs`),
//                                          which the other three questions
//                                          may not exercise if their first
//                                          retrieval pass already graded as
//                                          sufficient. the script reports
//                                          whichever actually happened
//                                          rather than assuming the control
//                                          held.
//
// each question runs twice, back to back, "low" then "high", and this
// prints + saves the telemetry retrieve() itself already produces --
// reranked, subQueries, itemsOut -- rather than inferring anything indirect.
// requires a running ollama with the models in .env.example pulled, and the
// real index built at data/index (INDEX_DIR). no mocking: this is the one
// piece of TENISE-68's evidence that is not safe to fake, because a stub
// cannot tell you whether thorough's wider context genuinely took longer on
// an 8b model -- only a real run can.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { answerQuestion } from "../src/modules/chat/services/answer.service.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = path.join(projectRoot, "evidence", "tenise68-effort-eval.json");

const gold = JSON.parse(await fs.readFile(path.join(projectRoot, "queries", "gold_set.json"), "utf8")).questions;

const WANTED_IDS = ["SH-01", "MS-01", "SUM-01", "AGG-01"];
const testCases = WANTED_IDS.map((id) => {
  const found = gold.find((entry) => entry.id === id);

  if (!found) throw new Error(`gold_set.json no longer has ${id} -- update WANTED_IDS`);

  return found;
});

const LEVELS = ["low", "high"];

const runs = [];

console.log(`\nTENISE-68 effort eval -- ${testCases.length} questions x ${LEVELS.length} levels\n`);

for (const testCase of testCases) {
  for (const effort of LEVELS) {
    const startedAt = Date.now();
    let result = null;
    let error = null;

    try {
      result = await answerQuestion(testCase.query, { roleId: "admin", effort });
    } catch (err) {
      error = err.message;
    }

    const wallClockMs = Date.now() - startedAt;

    const row = {
      id: testCase.id,
      intent: testCase.intent,
      route: testCase.route,
      effort,
      wallClockMs,
      error,
      answered: result?.answered ?? null,
      answerChars: result ? String(result.answer ?? "").length : null,
      // telemetry.effort confirms the server-side resolution actually ran as
      // the level requested -- see answer.service.js's telemetry comment.
      effortEcho: result?.telemetry?.effort ?? null,
      reranked: result?.telemetry?.reranked ?? null,
      subQueries: result?.telemetry?.subQueries ?? null,
      itemsOut: result?.telemetry?.itemsOut ?? null,
      evidenceGrade: result?.telemetry?.evidenceGrade ?? null,
      rephrasedAs: result?.grading?.rephrasedAs ?? null,
      durationMs: result?.telemetry?.durationMs ?? null,
      // set only when a structured question's table lookup failed and
      // answerQuestion fell through to answerFromDocuments -- see the
      // AGG-01 note above. a structured question that actually stayed on
      // the table path has this as null/undefined.
      fellBackFrom: result?.telemetry?.fellBackFrom ?? null,
    };

    runs.push(row);

    console.log(
      `${effort.padEnd(9)} ${testCase.id.padEnd(7)} ${String(wallClockMs).padStart(6)}ms` +
        `  reranked=${String(row.reranked).padEnd(5)} subQueries=${row.subQueries ?? "-"}` +
        `  itemsOut=${row.itemsOut ?? "-"}  answered=${row.answered}` +
        (error ? `  ERROR: ${error}` : ""),
    );
  }
}

// ---------------------------------------------------------------------------
// did it actually do something -- per question, fast vs thorough.
// ---------------------------------------------------------------------------
const comparisons = testCases.map((testCase) => {
  const fast = runs.find((row) => row.id === testCase.id && row.effort === "low");
  const thorough = runs.find((row) => row.id === testCase.id && row.effort === "high");

  // true only if BOTH runs actually stayed on the table path. if either one
  // fell through to answerFromDocuments (no table data loaded in this
  // environment -- see the AGG-01 note above), this is no longer a clean
  // reading of "does effort touch answerFromTables": it is measuring the
  // document fallback instead, same as the unstructured questions.
  const staysOnTablePath = testCase.route === "structured" && !fast.fellBackFrom && !thorough.fellBackFrom;

  return {
    id: testCase.id,
    route: testCase.route,
    staysOnTablePath,
    fastFellBackFrom: fast.fellBackFrom,
    thoroughFellBackFrom: thorough.fellBackFrom,
    fastWallClockMs: fast.wallClockMs,
    thoroughWallClockMs: thorough.wallClockMs,
    fastFaster: fast.wallClockMs < thorough.wallClockMs,
    fastReranked: fast.reranked,
    thoroughReranked: thorough.reranked,
    fastSubQueries: fast.subQueries,
    thoroughSubQueries: thorough.subQueries,
    fastItemsOut: fast.itemsOut,
    thoroughItemsOut: thorough.itemsOut,
    stagesDiffered:
      fast.reranked !== thorough.reranked ||
      fast.subQueries !== thorough.subQueries ||
      fast.itemsOut !== thorough.itemsOut,
  };
});

console.log("\nper-question comparison\n");

for (const comparison of comparisons) {
  console.log(
    `${comparison.id} (${comparison.route}): fast=${comparison.fastWallClockMs}ms thorough=${comparison.thoroughWallClockMs}ms` +
      `  stagesDiffered=${comparison.stagesDiffered}  itemsOut ${comparison.fastItemsOut}->${comparison.thoroughItemsOut}` +
      (comparison.route === "structured" && !comparison.staysOnTablePath
        ? `  [fell through to documents -- not a clean table-path control in this environment]`
        : ""),
  );
}

// a structured question only counts as a genuine negative-control reading
// once it actually stayed on the table path for both effort levels. with no
// structured tables loaded in this environment (queries/gold_set.json's
// AGG-01/AGG-02 expect a match-data table that is not present here), that
// condition is not met, and the honest conclusion is "not demonstrated live
// here" rather than a false pass or fail.
const documentComparisons = comparisons.filter((comparison) => comparison.route === "unstructured");
const tableControlComparisons = comparisons.filter(
  (comparison) => comparison.route === "structured" && comparison.staysOnTablePath,
);
const tableFallbackComparisons = comparisons.filter(
  (comparison) => comparison.route === "structured" && !comparison.staysOnTablePath,
);

const allDocumentQuestionsDiffered = documentComparisons.every((comparison) => comparison.stagesDiffered);
const tableControlHeld =
  tableControlComparisons.length > 0 ? tableControlComparisons.every((comparison) => !comparison.stagesDiffered) : null;

const evidence = {
  story: "TENISE-68",
  generatedAt: new Date().toISOString(),
  runs,
  comparisons,
  accepted: allDocumentQuestionsDiffered,
  summary: {
    allDocumentQuestionsDiffered,
    // null = no table question in this run actually stayed on the table
    // path, so the negative control was not exercised live -- true by code
    // inspection of answerFromTables (no retrieve/expand/rerank calls in
    // it), not demonstrated by this particular run.
    tableControlHeld,
    tableQuestionsFellBackToDocuments: tableFallbackComparisons.map((comparison) => comparison.id),
  },
};

await fs.mkdir(path.dirname(evidencePath), { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log(`\nTENISE-68 result: every document question changed stages = ${allDocumentQuestionsDiffered}`);

if (tableFallbackComparisons.length > 0) {
  console.log(
    `note: ${tableFallbackComparisons.map((c) => c.id).join(", ")} fell through to the document path in this ` +
      `environment (no structured tables loaded -- see queries/gold_set.json's expectedTable), so the table-path ` +
      `negative control was NOT demonstrated live here. answerFromTables itself calls neither retrieve(), ` +
      `expandQuery() nor rerankCandidates() -- see answer.service.js -- so effort remains structurally inert there ` +
      `by inspection, just not proven by this run.`,
  );
} else {
  console.log(`the table question(s) stayed unaffected = ${tableControlHeld}`);
}

console.log(`evidence written to ${path.relative(projectRoot, evidencePath)}`);
