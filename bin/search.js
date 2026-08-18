#!/usr/bin/env node
// searches the index and prints what came back. no language model involved.
//
//   npm run search -- "serve load during tournaments"
//   npm run search -- --role analyst "athlete heart rate monitoring"
//
// this is the tool for answering "is retrieval working", separately from "is the
// model writing a good answer". when an answer is wrong, run this first -- if
// the right chunk is not in this list, the problem is retrieval and no amount of
// prompt tuning will fix it.

import process from "node:process";

import { ROLE_IDS } from "../src/shared/constants/accessControl.js";
import { retrieve, loadIndex } from "../src/modules/retrieval/retrieval.service.js";

const args = process.argv.slice(2);
let roleId = "analyst";
const words = [];

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--role") {
    roleId = args[i + 1];
    i += 1;
  } else {
    words.push(args[i]);
  }
}

const query = words.join(" ").trim();

if (query === "") {
  console.error('usage: npm run search -- [--role <role>] "your question"');
  console.error(`roles: ${ROLE_IDS.join(", ")}`);
  process.exit(1);
}

try {
  const index = await loadIndex();

  if (index.manifest.embeddingProvider === "hash") {
    console.warn("!! this index was built with the offline hash provider. similarity is meaningless.\n");
  }

  const result = await retrieve(query, { roleId });

  console.log(`\nquery    ${query}`);
  console.log(`role     ${roleId}`);
  console.log(`routed   ${result.plan.kind}  (${result.plan.reason})`);

  if (result.notes.length > 0) console.log(`notes    ${result.notes.join("; ")}`);

  console.log(
    `stats    ${result.telemetry.fusedCandidates} fused from ${result.telemetry.corpusSize} chunks, ` +
      `${result.telemetry.singleArmInTopN}/${result.evidence.length} found by one arm only, ` +
      `${result.telemetry.durationMs}ms\n`,
  );

  for (const chunk of result.evidence) {
    const where = [chunk.title, chunk.page ? `p${chunk.page}` : null, chunk.section]
      .filter(Boolean)
      .join(" · ");

    console.log(`[${chunk.citationNumber}] ${where}`);
    console.log(`    ${chunk.sensitivity}/${chunk.data_domain}  found by ${chunk.foundBy.join("+")}  rrf ${chunk.rrfScore.toFixed(4)}`);
    console.log(`    ${chunk.text.replace(/\s+/g, " ").slice(0, 200)}...\n`);
  }
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}
