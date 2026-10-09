#!/usr/bin/env node
// one-off overnight batch run (requested directly, 2026-10-01): run a large
// query set once per effort level, store question + answer + grounding +
// the EXACT prompt text sent to the model for every generation call, so a
// large corpus of answers can be reviewed at scale the next morning without
// re-running anything.
//
// in-process, same pattern as bin/eval-answers.js -- calls answerQuestion()
// directly rather than going through the HTTP server, so this only needs
// Ollama running, not the dev server.
//
// resilient on purpose: an 8+ hour unattended run WILL hit a slow or hung
// query eventually. each question gets its own try/catch and a 5-minute
// abort, a failure is recorded as a row (not a crash), and the xlsx +
// progress checkpoint are rewritten after every single row -- so killing
// this process at any point loses at most the one row in flight, and
// restarting it skips every (question, effort) pair already completed.

import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

import { answerQuestion } from "../src/modules/chat/services/answer.service.js";

const queriesPath = process.argv[2] || "queries/overnight_batch_2026-10-01.json";

// output names derive from the query file's own name, not a fixed date --
// a run against a differently-named question set must never resume from,
// or overwrite, a previous run's progress/output under the old hardcoded
// name (reported directly, 2026-10-10: "where do I edit questions for next
// time" implies there IS a next time, with a different file).
const runName = path.basename(queriesPath, path.extname(queriesPath));
const outDir = "eval-runs";
// scoped per run, not a shared folder -- two runs against different
// question sets used to both start numbering their prompt files at 0001
// in the same eval-runs/prompts/ directory, so the smaller/later run
// silently overwrote the larger/earlier one's files.
const promptsDir = `${outDir}/prompts/${runName}`;
const xlsxPath = `${outDir}/${runName}.xlsx`;
const progressPath = `${outDir}/${runName}.progress.json`;

const PER_QUERY_TIMEOUT_MS = 5 * 60 * 1000;
// an Excel cell hard-caps at 32,767 characters (XLSX.writeFile throws past
// it, which took the whole process down 3 rows into the real run,
// 2026-10-01: system prompt + a ~12,000-char evidence block, doubled when
// the repair pass fires and resends the evidence, routinely exceeds that).
// the full text always goes to its own file instead; the cell holds a short
// preview plus that file's path.
const CELL_PREVIEW_CHARS = 1500;

const queries = JSON.parse(await fsp.readFile(queriesPath, "utf8"));

await fsp.mkdir(promptsDir, { recursive: true });

let results = [];

try {
  results = JSON.parse(await fsp.readFile(progressPath, "utf8"));
  console.log(`resuming: ${results.length} (question, effort) pairs already done`);
} catch {
  // no checkpoint yet -- starting fresh.
}

let fileCounter = 0;

function sanitiseForFilename(text) {
  return String(text).slice(0, 60).replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

/**
 * writes the full prompt text to its own file and returns a short cell
 * value (a preview plus the file's path) safe to put in an xlsx cell. the
 * full text never goes into the spreadsheet itself -- see CELL_PREVIEW_CHARS
 * above for why.
 */
async function savePromptFile(effort, question, fullPromptText) {
  fileCounter += 1;

  const fileName = `${String(fileCounter).padStart(4, "0")}_${effort}_${sanitiseForFilename(question)}.txt`;
  const filePath = `${promptsDir}/${fileName}`;

  await fsp.writeFile(filePath, fullPromptText);

  const preview = fullPromptText.length > CELL_PREVIEW_CHARS
    ? `${fullPromptText.slice(0, CELL_PREVIEW_CHARS)}...`
    : fullPromptText;

  return `[full text: ${filePath}]\n\n${preview}`;
}

// backward-compat for rows already in a resumed progress.json from before
// this fix existed -- they still have the full text inline (JSON has no
// cell-size limit) but not yet a prompt file on disk.
for (const row of results) {
  if (row.fullPromptText && !row.promptCell) {
    row.promptCell = await savePromptFile(row.effort, row.question, row.fullPromptText);
  }
}

// fileCounter restarts at 0 every process launch, but this script is built
// to survive being killed and resumed mid-run over many hours -- without
// this, a second launch would reuse filenames 0001, 0002... and silently
// overwrite the first launch's prompt files with a different question's
// text. seeding it from how many rows already exist keeps every filename
// unique across restarts.
fileCounter = results.length;

const done = new Set(results.map((row) => `${row.effort}::${row.question}`));

function formatPrompts(prompts) {
  return prompts
    .map(
      (p, i) =>
        `--- call ${i + 1} (${p.stage}) ---\n[SYSTEM]\n${p.systemPrompt}\n\n` +
        `${p.examples?.length ? `[${p.examples.length} few-shot example(s) omitted for length]\n\n` : ""}` +
        `[USER]\n${p.userContent}`,
    )
    .join("\n\n");
}

// a blanket backstop, not just a fix for the one field that actually hit
// this (full_prompt_text) -- an xlsx cell hard-caps at 32,767 characters
// and XLSX.writeFile throws on the whole workbook if ANY cell exceeds it,
// which took the entire overnight run down 3 rows in. every string value
// goes through this before reaching a cell, whichever field it turns out
// to be.
const EXCEL_CELL_LIMIT = 32000;

function safeCell(value) {
  if (typeof value !== "string") return value;
  if (value.length <= EXCEL_CELL_LIMIT) return value;

  return `${value.slice(0, EXCEL_CELL_LIMIT)}...[truncated, ${value.length} chars total]`;
}

function writeOutputs() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    results.map((r) => ({
      effort: safeCell(r.effort),
      question: safeCell(r.question),
      expected_source: safeCell(r.expectedSource),
      intent: safeCell(r.intent),
      route: safeCell(r.route),
      answered: r.answered,
      grounded: r.grounded,
      cited_fraction: r.citedFraction,
      citation_count: r.citationCount,
      cited_doc_ids: safeCell(r.citedDocIds),
      cited_titles: safeCell(r.citedTitles),
      dangling_citations: safeCell(r.danglingCitations),
      unused_evidence_count: r.unusedEvidenceCount,
      unsupported_numbers: safeCell(r.unsupportedNumbers),
      number_citation_mismatches: safeCell(r.numberCitationMismatches),
      warnings: safeCell(r.warnings),
      duration_ms: r.durationMs,
      error: safeCell(r.error),
      answer: safeCell(r.answerApa),
      full_prompt_text: safeCell(r.promptCell),
    })),
  );

  // generous widths so the answer/prompt columns are at least skimmable
  // without the reader resizing every column by hand first.
  sheet["!cols"] = [
    { wch: 8 }, { wch: 60 }, { wch: 35 }, { wch: 14 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 30 },
    { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
    { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 80 }, { wch: 100 },
  ];

  XLSX.utils.book_append_sheet(workbook, sheet, "results");
  XLSX.writeFile(workbook, xlsxPath);
}

async function runOne(question, expectedSource, effort) {
  const prompts = [];
  const row = { effort, question, expectedSource };
  const startedAt = Date.now();

  try {
    const result = await answerQuestion(question, {
      roleId: "admin",
      effort,
      signal: AbortSignal.timeout(PER_QUERY_TIMEOUT_MS),
      recordPrompt: (p) => prompts.push(p),
    });

    row.intent = result.intent;
    row.route = result.route;
    row.answered = result.answered;
    row.grounded = result.grounding?.grounded ?? null;
    row.citedFraction = result.grounding?.citedFraction ?? null;
    row.citationCount = result.citations.length;
    row.citedDocIds = result.citations.map((c) => c.docId).join("; ");
    row.citedTitles = result.citations.map((c) => c.title).join("; ");
    row.danglingCitations = (result.grounding?.danglingCitations ?? []).join("; ");
    row.unusedEvidenceCount = (result.grounding?.unusedEvidence ?? []).length;
    row.unsupportedNumbers = (result.grounding?.unsupportedNumbers ?? []).join("; ");
    row.numberCitationMismatches = (result.grounding?.numberCitationMismatches ?? [])
      .map((m) => JSON.stringify(m))
      .join("; ");
    row.warnings = (result.grounding?.warnings ?? []).map((w) => w.kind ?? w).join("; ");
    row.answerApa = result.answerApa;
    row.error = "";
  } catch (error) {
    row.error = error.message || String(error);
  }

  row.durationMs = Date.now() - startedAt;

  const fullPromptText = formatPrompts(prompts);

  row.promptCell = fullPromptText
    ? await savePromptFile(effort, question, fullPromptText)
    : "";

  return row;
}

console.log(`${queries.length} questions x 2 effort levels, low effort first, then high`);
console.log(`writing to ${xlsxPath} after every question\n`);

// refresh the spreadsheet on every launch, including a resume that finds
// nothing new to do -- otherwise a resumed run's xlsx stays whatever the
// PREVIOUS process last wrote (stale, or mid-crash) until the next new row
// completes, which could be a long wait or never if the whole set is done.
if (results.length > 0) writeOutputs();

for (const effort of ["low", "high"]) {
  for (const { question, expectedSource } of queries) {
    const key = `${effort}::${question}`;

    if (done.has(key)) continue;

    const startedAt = Date.now();
    const row = await runOne(question, expectedSource, effort);

    results.push(row);
    done.add(key);

    await fsp.writeFile(progressPath, JSON.stringify(results, null, 2));
    writeOutputs();

    const tag = row.error ? `ERROR: ${row.error}` : `${row.citationCount} citations, cited ${row.citedFraction ?? "?"}`;

    console.log(
      `[${effort}] (${((Date.now() - startedAt) / 1000).toFixed(0)}s) ${question.slice(0, 70)}... -- ${tag}`,
    );
  }
}

console.log(`\ndone. ${results.length} rows written to ${xlsxPath}`);
