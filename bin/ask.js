#!/usr/bin/env node
// the whole thing: retrieve, answer, cite. runs without the web server, without
// mongodb, without anything but ollama and a built index.
//
//   npm run ask -- "how does serve load differ between training and tournaments?"
//   npm run ask -- --role physiotherapist "what does the evidence say about injury risk?"

import process from "node:process";

import { ROLE_IDS } from "../src/shared/constants/accessControl.js";
import { retrieve } from "../src/modules/retrieval/retrieval.service.js";
import { buildContext } from "../src/modules/retrieval/contextBuilder.service.js";
import { bindCitations, findUnsupportedNumbers } from "../src/modules/retrieval/citation.service.js";
import { retrievalConfig } from "../src/config/retrieval.config.js";
import { buildGenerationMessages } from "../src/modules/chat/prompts/generationPrompt.js";

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

const question = words.join(" ").trim();

if (question === "") {
  console.error('usage: npm run ask -- [--role <role>] "your question"');
  console.error(`roles: ${ROLE_IDS.join(", ")}`);
  process.exit(1);
}

// talks to ollama directly rather than through the express service, so this
// script has no dependency on mongodb being up. same prompt, same model.
async function generate(messages) {
  const response = await fetch(`${retrievalConfig.generation.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: retrievalConfig.generation.model,
      messages,
      stream: false,
      options: { temperature: 0 },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `ollama returned ${response.status}. is it running, and is ` +
        `"${retrievalConfig.generation.model}" pulled?`,
    );
  }

  const payload = await response.json();

  return String(payload.message?.content ?? "");
}

try {
  const retrieval = await retrieve(question, { roleId });

  if (retrieval.evidence.length === 0) {
    console.log(`\nnothing in the index is visible to role "${roleId}" for that question.\n`);
    process.exit(0);
  }

  const context = buildContext(retrieval.evidence);

  process.stdout.write(
    `\nretrieved ${retrieval.evidence.length} chunks ` +
      `(${retrieval.plan.kind}, ${retrieval.telemetry.durationMs}ms). thinking...\n\n`,
  );

  const answer = await generate(
    buildGenerationMessages({ question, evidence: retrieval.evidence }),
  );

  const bound = bindCitations(answer, retrieval.evidence);
  const unsupported = findUnsupportedNumbers(answer, retrieval.evidence);

  console.log(answer.trim());
  console.log(`\n${"-".repeat(70)}\nsources`);

  for (const citation of bound.citations) {
    const where = [citation.title, citation.page ? `p${citation.page}` : null, citation.date]
      .filter(Boolean)
      .join(" · ");

    console.log(`  [${citation.number}] ${where}`);

    if (citation.authors.length > 0) console.log(`       ${citation.authors.join(", ")}`);
  }

  // the honest part. an answer that cites nothing looks exactly like one that
  // cites everything correctly, so we say which it was.
  if (bound.citations.length === 0) {
    console.log("  (none -- the model did not cite anything, so this answer is not grounded)");
  }

  if (bound.dangling.length > 0) {
    console.log(`\n  warning: cited [${bound.dangling.join("], [")}] which was never supplied`);
  }

  if (unsupported.length > 0) {
    console.log(`  warning: these figures appear in no source: ${unsupported.join(", ")}`);
  }

  console.log(`\n  context used: ${context.chars} chars${context.droppedCount > 0 ? `, ${context.droppedCount} chunk(s) dropped to fit` : ""}`);
  console.log();
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}
