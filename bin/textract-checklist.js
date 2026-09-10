#!/usr/bin/env node
// builds the cell-by-cell accuracy checklist, and scores it once filled in.
//
//   npm run textract:checklist              write the blank checklist
//   npm run textract:checklist -- --score   score the filled-in one
//
// COSTS NOTHING. it reads data/textract-cache/, which was already paid for.
//
// the acceptance condition is >= 95% of cells correct, and there is no honest
// way to establish that automatically -- "correct" means "matches what a human
// reads on the scanned page", and if we had a machine that knew that we would
// not need Textract. so this generates a form, a person fills it in against the
// original PDF, and the second pass turns it into a number.
//
// the one thing automation CAN do here is decide what order to check in.
// Textract reports a confidence per cell, so the cells it was least sure about
// go at the top of the list. a reviewer working top-down finds the errors
// first, and if they run out of time the unchecked remainder is the part least
// likely to contain any.

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

import { LOW_CONFIDENCE } from "../src/modules/ingestion/textractBlocks.js";
import { textractCacheDefaults } from "../src/modules/ingestion/textractCache.service.js";

const argv = process.argv.slice(2);
const scoring = argv.includes("--score");
const CHECKLIST = "evidence/tenise-12-table-checklist.md";
const SCORE_FILE = "evidence/tenise-12-cell-accuracy.json";

// ---------------------------------------------------------------------------
// scoring an already-filled checklist
// ---------------------------------------------------------------------------

if (scoring) {
  let markdown;

  try {
    markdown = await fsp.readFile(CHECKLIST, "utf8");
  } catch {
    console.error(`\n${CHECKLIST} does not exist yet. run without --score first.\n`);
    process.exit(1);
  }

  let currentTable = null;

  const rows = [];

  for (const line of markdown.split("\n")) {
    const heading = line.match(/^###\s+(.+?)\s*$/);

    if (heading) {
      currentTable = heading[1];
      continue;
    }

    // only the numbered data rows. the header and separator rows of each table
    // do not start with a digit in the first column.
    const match = line.match(/^\|\s*(\d+)\s*\|(.*)\|\s*$/);

    if (!match) continue;

    const cells = match[2].split("|").map((cell) => cell.trim());
    const [row, column, extracted, confidence, correct, sourceValue] = cells;

    rows.push({
      table: currentTable,
      row: Number(row),
      column: Number(column),
      extracted,
      confidence: confidence === "" ? null : Number(confidence),
      // anything that is not an explicit Y or N is "not reviewed". a blank must
      // never count as a pass -- that would let an unfilled checklist score
      // 100% and the whole exercise would prove nothing.
      verdict: /^y$/i.test(correct) ? "correct" : /^n$/i.test(correct) ? "wrong" : "unreviewed",
      sourceValue: sourceValue ?? "",
    });
  }

  const reviewed = rows.filter((entry) => entry.verdict !== "unreviewed");
  const wrong = rows.filter((entry) => entry.verdict === "wrong");
  const correct = reviewed.length - wrong.length;
  const accuracy = reviewed.length === 0 ? 0 : (correct / reviewed.length) * 100;

  console.log(`\ncell accuracy\n${"=".repeat(52)}`);
  console.log(`  cells in the checklist   ${rows.length}`);
  console.log(`  reviewed                 ${reviewed.length}`);
  console.log(`  correct                  ${correct}`);
  console.log(`  wrong                    ${wrong.length}`);
  console.log(`  accuracy                 ${accuracy.toFixed(1)}%  (threshold 95%)`);

  if (rows.length !== reviewed.length) {
    console.log(`\n  !! ${rows.length - reviewed.length} cell(s) have no Y/N and are NOT counted.`);
    console.log("     an unreviewed cell is not a passing cell.");
  }

  if (wrong.length > 0) {
    console.log(`\n  wrong cells:`);

    for (const entry of wrong) {
      console.log(
        `    ${entry.table}  r${entry.row}c${entry.column}  ` +
          `read "${entry.extracted}" but the page says "${entry.sourceValue}"` +
          (entry.confidence === null ? "" : `  (confidence ${entry.confidence})`),
      );
    }
  }

  await fsp.mkdir("evidence", { recursive: true });
  await fsp.writeFile(
    SCORE_FILE,
    `${JSON.stringify(
      {
        scoredAt: new Date().toISOString(),
        threshold: 95,
        cellsInChecklist: rows.length,
        cellsReviewed: reviewed.length,
        correct,
        wrong: wrong.length,
        accuracyPercent: Number(accuracy.toFixed(2)),
        passes: reviewed.length > 0 && accuracy >= 95,
        wrongCells: wrong,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\n  ${accuracy >= 95 && reviewed.length > 0 ? "PASSES" : "DOES NOT PASS"} the 95% threshold`);
  console.log(`\nwritten to ${SCORE_FILE}\n`);

  process.exit(0);
}

// ---------------------------------------------------------------------------
// generating the blank checklist
// ---------------------------------------------------------------------------

const cacheDir = textractCacheDefaults.dir;

let entries;

try {
  entries = (await fsp.readdir(cacheDir))
    .filter((name) => name.endsWith(".json") && name !== "usage.json")
    .sort();
} catch {
  entries = [];
}

if (entries.length === 0) {
  console.error(`\nnothing in ${cacheDir} to check. run npm run textract first.\n`);
  process.exit(1);
}

const sections = [];

let totalCells = 0;
let totalLowConfidence = 0;
let totalTables = 0;

const skippedSynthetic = [];

for (const name of entries) {
  const entry = JSON.parse(await fsp.readFile(path.join(cacheDir, name), "utf8"));

  // an entry seeded by bin/textract-seed.js --synthetic. its cells were
  // invented, so a reviewer comparing them against the scanned page would find
  // nothing to compare and a score built from them would be a number with no
  // meaning behind it. the acceptance condition is a cell-accuracy percentage,
  // which makes this the one place where quietly including fake data would
  // manufacture a passing result.
  if (entry.synthetic === true) {
    skippedSynthetic.push(entry.docId ?? name);
    continue;
  }

  for (const table of entry.tables ?? []) {
    // a cell with no text was blank on the page too. there is nothing for a
    // reviewer to compare, and including them would pad the denominator with
    // free passes -- which would make the accuracy figure meaningless.
    const cells = (table.cells ?? []).filter((cell) => cell.text !== "");

    if (cells.length === 0) continue;

    totalTables += 1;

    // least confident first. a reviewer working top-down meets the likely
    // errors immediately rather than after forty correct cells.
    const ordered = [...cells].sort(
      (a, b) => (a.confidence ?? 101) - (b.confidence ?? 101) || a.row - b.row || a.column - b.column,
    );

    const lowConfidence = cells.filter(
      (cell) => cell.confidence !== null && cell.confidence < LOW_CONFIDENCE,
    ).length;

    totalCells += cells.length;
    totalLowConfidence += lowConfidence;

    const heading = `${entry.docId} — page ${table.page}, table ${table.index + 1}`;

    const lines = [
      `### ${heading}`,
      "",
      `${table.rowCount} rows x ${table.columnCount} columns, ${cells.length} non-empty cells, ` +
        `${lowConfidence} below ${LOW_CONFIDENCE}% confidence.` +
        (table.title ? ` Caption read as: "${table.title}".` : ""),
      "",
      "Least confident cells first. Compare each against the scanned page and put",
      "Y or N in `correct?`; when N, write what the page actually says.",
      "",
      "| # | row | col | extracted | conf | correct? | source value |",
      "|---|-----|-----|-----------|------|----------|--------------|",
    ];

    ordered.forEach((cell, index) => {
      // a pipe inside a value would break the row the scorer parses.
      const safe = String(cell.text).replace(/\|/g, "\\|");
      const confidence = cell.confidence === null ? "" : cell.confidence.toFixed(1);

      lines.push(`| ${index + 1} | ${cell.row} | ${cell.column} | ${safe} | ${confidence} |  |  |`);
    });

    sections.push(lines.join("\n"));
  }
}

if (skippedSynthetic.length > 0) {
  console.log(`\n  !! skipped ${skippedSynthetic.length} synthetic entr(ies): ${skippedSynthetic.join(", ")}`);
  console.log("     seeded locally by textract:seed --synthetic, so their cells were never");
  console.log("     read off a page. scoring them would produce an accuracy figure that");
  console.log("     measures nothing.");
}

if (sections.length === 0) {
  console.error(
    skippedSynthetic.length > 0
      ? "\nevery entry in the cache is synthetic. there is nothing real to check --\n" +
          "run npm run textract against a real document first.\n"
      : "\nno tables with any text were found in the cache.\n",
  );
  process.exit(1);
}

const document = [
  "# TENISE-12 — Textract cell accuracy checklist",
  "",
  `Generated ${new Date().toISOString()} from \`${cacheDir}\`.`,
  "",
  "## How to use this",
  "",
  "1. Open the scanned PDF beside this file.",
  "2. For each row, find the cell at (row, col) in the table named by the heading.",
  "3. Put `Y` in `correct?` if the extracted value matches the page exactly.",
  "4. Put `N` and fill in `source value` if it does not.",
  "5. Run `npm run textract:checklist -- --score`.",
  "",
  "A blank `correct?` counts as **not reviewed**, not as correct. An unfilled",
  "checklist therefore scores nothing rather than a false 100%.",
  "",
  "The cells are ordered least-confident-first within each table, so the most",
  "likely errors are at the top of each list.",
  "",
  `**Totals:** ${totalTables} table(s), ${totalCells} non-empty cells, ` +
    `${totalLowConfidence} below ${LOW_CONFIDENCE}% confidence.`,
  "",
  `**Threshold:** at least 95% of reviewed cells must be correct.`,
  "",
  "---",
  "",
  sections.join("\n\n---\n\n"),
  "",
].join("\n");

await fsp.mkdir("evidence", { recursive: true });
await fsp.writeFile(CHECKLIST, document);

console.log(`\nchecklist written to ${CHECKLIST}`);
console.log(`  ${totalTables} table(s), ${totalCells} cell(s) to check`);
console.log(`  ${totalLowConfidence} cell(s) below ${LOW_CONFIDENCE}% confidence, listed first`);
console.log(`\nfill in the correct? column, then:  npm run textract:checklist -- --score\n`);
