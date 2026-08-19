#!/usr/bin/env node
// runs ONE strategy and prints one json line. not meant to be called by hand --
// bin/eval.js spawns this once per strategy.
//
// why a separate process at all: node caches modules, and retrieval.config.js
// freezes its values the first time it is imported. so flipping an environment
// variable and re-importing inside one process does nothing -- every strategy
// silently runs with the first strategy's settings and the comparison table
// comes out identical row after row, which is exactly the kind of result that
// looks like "the techniques made no difference" when really nothing was tested.
// a fresh process per strategy is the only way to be sure the config is real.

import fsp from "node:fs/promises";
import process from "node:process";

import { retrieve } from "../src/modules/retrieval/retrieval.service.js";

const questions = JSON.parse(await fsp.readFile(process.env.QUERY_SET || "queries/query_set.json", "utf8"));

function hitAt(evidence, expectedDocId, k) {
  return evidence.slice(0, k).some((chunk) => chunk.doc_id === expectedDocId) ? 1 : 0;
}

// reciprocal rank: 1/position of the first correct document, 0 if absent.
// averaged over the set this is mrr, which unlike hit@k rewards putting the
// right document FIRST rather than merely somewhere in the top ten.
function reciprocalRank(evidence, expectedDocId) {
  const position = evidence.findIndex((chunk) => chunk.doc_id === expectedDocId);

  return position === -1 ? 0 : 1 / (position + 1);
}

const totals = { hit1: 0, hit5: 0, hit10: 0, mrr: 0, ms: 0, failures: 0 };
const byTag = {};

for (const question of questions) {
  try {
    const result = await retrieve(question.query, { roleId: question.role ?? "admin" });

    const rr = reciprocalRank(result.evidence, question.expectedDocId);

    totals.hit1 += hitAt(result.evidence, question.expectedDocId, 1);
    totals.hit5 += hitAt(result.evidence, question.expectedDocId, 5);
    totals.hit10 += hitAt(result.evidence, question.expectedDocId, 10);
    totals.mrr += rr;
    totals.ms += result.telemetry.durationMs;

    // per-tag numbers are where the interesting story is. the headline average
    // usually hides that a technique helps enormously on one kind of question
    // and not at all on another.
    const tag = question.tag ?? "untagged";

    byTag[tag] ??= { n: 0, mrr: 0 };
    byTag[tag].n += 1;
    byTag[tag].mrr += rr;
  } catch (error) {
    totals.failures += 1;

    if (process.env.EVAL_VERBOSE) console.error(`  ! ${question.query}: ${error.message}`);
  }
}

const n = questions.length;

process.stdout.write(
  `${JSON.stringify({
    name: process.env.STRATEGY_NAME ?? "unnamed",
    hit1: totals.hit1 / n,
    hit5: totals.hit5 / n,
    hit10: totals.hit10 / n,
    mrr: totals.mrr / n,
    meanMs: Math.round(totals.ms / n),
    failures: totals.failures,
    byTag: Object.fromEntries(
      Object.entries(byTag).map(([tag, value]) => [tag, Number((value.mrr / value.n).toFixed(3))]),
    ),
  })}\n`,
);
