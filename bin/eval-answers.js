#!/usr/bin/env node
// scores the assistant end to end against the gold set.
//
//   npm run eval:answers
//
// different from `npm run eval`, which measures retrieval alone. this one runs
// the whole path -- classify, route, gather, answer, verify -- and checks four
// things per question:
//
//   route      did it go to the documents or the tables, as intended
//   sources    did the right documents end up cited
//   grounding  did every claim carry a citation that resolves
//   abstention did it refuse the questions it should have refused
//
// the abstention column is the one to watch. a system scoring 100% on
// answerable questions while confidently inventing answers to the rest is worse
// than one scoring 90% and refusing cleanly, and only a set containing both can
// tell them apart.

import fsp from "node:fs/promises";
import process from "node:process";

import { answerQuestion } from "../src/modules/chat/services/answer.service.js";

const setPath = process.env.GOLD_SET || "queries/gold_set.json";

let questions;

try {
  questions = JSON.parse(await fsp.readFile(setPath, "utf8")).questions;
} catch (error) {
  console.error(`could not read ${setPath}: ${error.message}`);
  process.exit(1);
}

const results = [];

console.log(`\nrunning ${questions.length} gold questions\n`);

for (const question of questions) {
  const row = { id: question.id, tag: question.tag, query: question.query };

  try {
    const result = await answerQuestion(question.query, { roleId: question.role ?? "admin" });

    row.intent = result.intent;
    row.route = result.route;
    row.answered = result.answered;
    row.citationCount = result.citations.length;
    row.durationMs = result.telemetry.durationMs;

    if (question.expectAbstention) {
      // the only thing that counts here is that it refused. which route it took
      // to get there does not matter.
      row.pass = result.answered === false;
      row.check = row.pass ? "refused correctly" : "ANSWERED A QUESTION IT CANNOT ANSWER";
    } else {
      const checks = [];

      if (question.route && result.route !== question.route) {
        checks.push(`route ${result.route}, expected ${question.route}`);
      }

      if (question.expectedTable && result.telemetry.table !== question.expectedTable) {
        checks.push(`table ${result.telemetry.table ?? "none"}, expected ${question.expectedTable}`);
      }

      if (question.expectedDocIds) {
        const cited = new Set(result.citations.map((citation) => citation.docId));
        const found = question.expectedDocIds.filter((docId) => cited.has(docId));

        row.sourcesFound = `${found.length}/${question.expectedDocIds.length}`;

        if (found.length === 0) checks.push("none of the expected documents were cited");
      }

      if (question.minSources && result.citations.length < question.minSources) {
        checks.push(`cited ${result.citations.length}, expected at least ${question.minSources}`);
      }

      if (question.expectedAnswerContains) {
        const missing = question.expectedAnswerContains.filter(
          (needle) => !String(result.answer).includes(needle),
        );

        if (missing.length > 0) checks.push(`answer omitted ${missing.join(", ")}`);
      }

      if (!result.answered) checks.push("abstained on an answerable question");

      row.pass = checks.length === 0;
      row.check = checks.join("; ") || "ok";
    }
  } catch (error) {
    row.pass = false;
    row.check = `error: ${error.message}`;
  }

  results.push(row);

  console.log(
    `${row.pass ? " ok " : "FAIL"}  ${String(row.id).padEnd(7)} ${String(row.tag).padEnd(13)} ${row.check}`,
  );
}

// summary by tag, because an overall pass rate hides which capability is broken.
const byTag = {};

for (const row of results) {
  byTag[row.tag] ??= { pass: 0, total: 0 };
  byTag[row.tag].total += 1;

  if (row.pass) byTag[row.tag].pass += 1;
}

console.log(`\n${"-".repeat(46)}`);

for (const [tag, counts] of Object.entries(byTag)) {
  console.log(`${tag.padEnd(16)} ${counts.pass}/${counts.total}`);
}

const passed = results.filter((row) => row.pass).length;

console.log(`${"-".repeat(46)}\noverall          ${passed}/${results.length}\n`);

await fsp.mkdir("evidence", { recursive: true });
await fsp.writeFile(
  "evidence/answer_evaluation.json",
  `${JSON.stringify({ generatedAt: new Date().toISOString(), passed, total: results.length, results }, null, 2)}\n`,
);

console.log("written to evidence/answer_evaluation.json\n");
