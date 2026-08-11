#!/usr/bin/env node
// ask a question and get an answer with its sources.
//
//   npm run ask -- "how does serve load differ between training and tournaments?"
//   npm run ask -- --role physiotherapist "what does the research say about injury risk?"
//   npm run ask -- "how many matches were played on each surface?"
//
// runs the full path: classify the question, route it to documents or tables,
// gather evidence, answer, then check the answer against what was retrieved.
// no web server and no mongodb -- just ollama and a built index.

import process from "node:process";

import { ROLE_IDS } from "../src/shared/constants/accessControl.js";
import { answerQuestion } from "../src/modules/chat/services/answer.service.js";

const args = process.argv.slice(2);
let roleId = "analyst";
let showJson = false;
const words = [];

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--role") {
    roleId = args[i + 1];
    i += 1;
  } else if (args[i] === "--json") {
    showJson = true;
  } else {
    words.push(args[i]);
  }
}

const question = words.join(" ").trim();

if (question === "") {
  console.error('usage: npm run ask -- [--role <role>] [--json] "your question"');
  console.error(`roles: ${ROLE_IDS.join(", ")}`);
  process.exit(1);
}

try {
  const result = await answerQuestion(question, { roleId });

  if (showJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  console.log(
    `\n${result.intent} · ${result.route} · role ${roleId} · ${result.telemetry.durationMs}ms\n`,
  );

  console.log(result.answer);

  // the table, when the question earned one.
  if (result.table?.markdown) console.log(`\n${result.table.markdown}`);

  if (result.sql) console.log(`\nquery run:\n${result.sql}`);

  if (result.citations.length > 0) {
    console.log(`\n${"-".repeat(70)}\nsources`);

    for (const citation of result.citations) {
      console.log(`  [${citation.number}] ${citation.link?.label ?? citation.title}`);

      if (citation.link) console.log(`       ${citation.link.href}`);
      if (citation.authors?.length) console.log(`       ${citation.authors.join(", ")}`);
      if (citation.basis) {
        console.log(
          `       computed over ${citation.basis.rowsMatched} of ${citation.basis.rowsScanned} rows`,
        );
      }
    }
  }

  // the honest part. an answer that cites nothing reads exactly like one that
  // cites everything correctly, so we say which it was.
  if (!result.answered) {
    console.log(`\n  (no answer given${result.reason ? `: ${result.reason}` : ""})`);
  } else if (result.citations.length === 0) {
    console.log("\n  warning: the model cited nothing, so this answer is not grounded");
  }

  if (result.grounding.danglingCitations?.length > 0) {
    console.log(`  warning: cited [${result.grounding.danglingCitations.join("], [")}] which was never supplied`);
  }

  if (result.grounding.unsupportedNumbers?.length > 0) {
    console.log(`  warning: figures appearing in no source: ${result.grounding.unsupportedNumbers.join(", ")}`);
  }

  console.log();
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}
