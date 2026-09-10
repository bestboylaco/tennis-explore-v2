#!/usr/bin/env node
// asks five questions that only the scanned documents can answer.
//
//   npm run textract:eval
//
// COSTS NOTHING at AWS -- it queries the local index. It does need Ollama, the
// same as npm run eval:answers, because it runs the full answering path.
//
// this is the acceptance condition "the tables are retrievable", and it is
// deliberately end-to-end rather than a retrieval-only check. a chunk that
// ranks first and still cannot be read into an answer has not made the table
// usable to anyone.
//
// the questions are answerable ONLY from the scanned files. that is what makes
// a pass mean something: before this story those 144 documents contributed
// nothing to the index, so every one of these questions had to be refused.
// a question that a digital-native PDF could also answer would pass whether
// Textract worked or not.
//
// it follows bin/eval-answers.js rather than reimplementing scoring -- same
// answerQuestion() call, same pass/fail shape -- so the two evidence files can
// be read side by side.

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
import process from "node:process";

import { answerQuestion } from "../src/modules/chat/services/answer.service.js";

const setPath = process.env.TEXTRACT_QUESTION_SET || "queries/tenise-12-scanned-questions.json";
const OUTPUT = "evidence/tenise-12-retrieval.json";
const THRESHOLD = 4;

let questions;

try {
  questions = JSON.parse(await fsp.readFile(setPath, "utf8")).questions;
} catch (error) {
  console.error(`could not read ${setPath}: ${error.message}`);
  process.exit(1);
}

// the file ships as a template. running it unfilled would produce five failures
// that look like a broken pipeline rather than an unfinished question set.
const placeholders = questions.filter(
  (question) =>
    question.query.startsWith("REPLACE ME") ||
    (question.expectedDocIds ?? []).some((docId) => docId.startsWith("REPLACE_ME")),
);

if (placeholders.length > 0) {
  console.error(`\n${placeholders.length} of ${questions.length} questions are still placeholders.`);
  console.error(`fill in ${setPath} first -- it explains how at the top of the file.`);
  console.error("\nthe questions must be answerable ONLY from the scanned documents,");
  console.error("or a pass proves nothing about this story.\n");
  process.exit(1);
}

const results = [];

console.log(`\n${questions.length} questions that only the scanned documents can answer\n`);

for (const question of questions) {
  const row = { id: question.id, tag: question.tag, shape: question.shape, query: question.query };

  try {
    const result = await answerQuestion(question.query, { roleId: question.role ?? "admin" });

    row.answered = result.answered;
    row.citationCount = result.citations.length;
    row.durationMs = result.telemetry.durationMs;

    const checks = [];

    if (!result.answered) checks.push("abstained on an answerable question");

    // did the scanned document actually get cited -- not merely something that
    // happened to contain a similar number.
    if (question.expectedDocIds) {
      const cited = new Set(result.citations.map((citation) => citation.docId));
      const found = question.expectedDocIds.filter((docId) => cited.has(docId));

      row.sourcesFound = `${found.length}/${question.expectedDocIds.length}`;

      if (found.length === 0) checks.push("the scanned document was not cited");
    }

    // and did the value from the table reach the answer. citing the right
    // document while getting the number wrong is not a pass -- the number is
    // the entire reason the table was extracted.
    if (question.expectedAnswerContains) {
      const missing = question.expectedAnswerContains.filter(
        (needle) => !String(result.answer).includes(needle),
      );

      row.valuesFound = `${question.expectedAnswerContains.length - missing.length}/${question.expectedAnswerContains.length}`;

      if (missing.length > 0) checks.push(`answer omitted ${missing.join(", ")}`);
    }

    if (question.minSources && result.citations.length < question.minSources) {
      checks.push(`cited ${result.citations.length}, expected at least ${question.minSources}`);
    }

    // which chunk answered it. a table chunk carries section "table", so this
    // says whether the answer came from the extracted grid or from prose on the
    // same page -- both are wins for the story, but they are different wins.
    row.citedSections = [...new Set(result.citations.map((citation) => citation.section ?? "none"))];
    row.fromTableChunk = row.citedSections.includes("table");

    row.pass = checks.length === 0;
    row.check = checks.join("; ") || "ok";
  } catch (error) {
    row.pass = false;
    row.check = `error: ${error.message}`;
  }

  results.push(row);

  console.log(
    `${row.pass ? " ok " : "FAIL"}  ${String(row.id).padEnd(6)} ` +
      `${String(row.shape ?? "").padEnd(24)} ${row.check}`,
  );
}

const passed = results.filter((row) => row.pass).length;
const fromTables = results.filter((row) => row.fromTableChunk).length;

console.log(`\n${"-".repeat(56)}`);
console.log(`passed              ${passed}/${results.length}   (threshold ${THRESHOLD})`);
console.log(`answered from a table chunk   ${fromTables}/${results.length}`);
console.log(`${"-".repeat(56)}\n`);

await fsp.mkdir("evidence", { recursive: true });
await fsp.writeFile(
  OUTPUT,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      questionSet: setPath,
      threshold: THRESHOLD,
      passed,
      total: results.length,
      passes: passed >= THRESHOLD,
      answeredFromTableChunk: fromTables,
      results,
    },
    null,
    2,
  )}\n`,
);

console.log(`${passed >= THRESHOLD ? "PASSES" : "DOES NOT PASS"} the ${THRESHOLD}/5 threshold`);
console.log(`\nwritten to ${OUTPUT}\n`);
