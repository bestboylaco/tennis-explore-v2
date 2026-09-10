#!/usr/bin/env node
// TENISE-36 negative test: prove the access filter is a real, load-bearing
// condition rather than a no-op that happens to agree with expectations.
//
// Runs the exact same query through both retrieval arms twice -- once
// through the real per-role filter (as the app does), once with an
// "allow everything" predicate substituted in its place -- and compares
// whether the restricted chunk appears in the raw candidate list either
// way. Read-only against the on-disk index; never touches a running
// server or any real request path, so there is nothing to "re-enable"
// afterwards.
//
// needs a live Ollama (for the query embedding) and a built index. run
// with `npm run test:rbac-negative`.

import fs from "node:fs";

import { loadIndex } from "../src/modules/retrieval/retrieval.service.js";
import { buildAccessFilter } from "../src/modules/retrieval/accessControl.service.js";
import { embedQuery } from "../src/modules/ingestion/embedding.service.js";

const CASES = [
  {
    label: "athlete denied coach-only doc (sensitivity ceiling)",
    roleId: "athlete",
    query: "In the 2018 Paris pre-match scouting analysis, what was the score by which Sousa defeated Cecchinato in Round 1?",
    targetDocId: "2018-paris-joao-sousa-pre-match-analysis",
  },
  {
    label: "tour_coach denied athlete-visible doc (program scope)",
    roleId: "tour_coach",
    query: "According to the load monitoring and injury prevention presentation, what did the Hulin et al. BJSM 2013 study find about doubling weekly workload?",
    targetDocId: "aisworkload",
  },
];

const K = 50;

async function main() {
  console.log("Loading index (this takes a bit the first time)...");
  const index = await loadIndex();
  console.log(`Index loaded: ${index.store.size} chunks.\n`);

  const noFilter = {
    roleId: "NEGATIVE_TEST_NO_FILTER",
    isChunkAllowed: () => true,
    isIndexAllowed: () => () => true,
  };

  const report = [];

  for (const testCase of CASES) {
    console.log(`=== ${testCase.label} ===`);

    const realFilter = buildAccessFilter(testCase.roleId);
    const vector = await embedQuery(testCase.query, {});
    const docIdOf = (hit) => index.store.getChunk(hit.index)?.doc_id;

    const filteredDocIds = new Set([
      ...index.bm25.search(testCase.query, { k: K, isAllowed: realFilter.isIndexAllowed(index.store.chunks) }).map(docIdOf),
      ...index.store.search(vector, { k: K, isAllowed: realFilter.isChunkAllowed }).map(docIdOf),
    ]);

    const unfilteredDocIds = new Set([
      ...index.bm25.search(testCase.query, { k: K, isAllowed: noFilter.isIndexAllowed(index.store.chunks) }).map(docIdOf),
      ...index.store.search(vector, { k: K, isAllowed: noFilter.isChunkAllowed }).map(docIdOf),
    ]);

    const targetInFiltered = filteredDocIds.has(testCase.targetDocId);
    const targetInUnfiltered = unfilteredDocIds.has(testCase.targetDocId);
    const pass = !targetInFiltered && targetInUnfiltered;

    console.log(`  role: ${testCase.roleId}, target doc: ${testCase.targetDocId}`);
    console.log(`  WITH real per-role filter    -> target doc present in top-${K}? ${targetInFiltered}`);
    console.log(`  WITH filter bypassed (no-op) -> target doc present in top-${K}? ${targetInUnfiltered}`);
    console.log(`  ${pass ? "PASS" : "FAIL"}\n`);

    report.push({
      ...testCase,
      k: K,
      targetPresentWithRealFilter: targetInFiltered,
      targetPresentWithFilterBypassed: targetInUnfiltered,
      pass,
    });
  }

  const allPassed = report.every((r) => r.pass);

  fs.mkdirSync("evidence", { recursive: true });
  fs.writeFileSync("evidence/tenise36-negative-test.json", JSON.stringify(report, null, 2));

  console.log(`=== SUMMARY: ${allPassed ? "PASS" : "FAIL"} (${report.filter((r) => r.pass).length}/${report.length}) ===`);
  console.log("Full results written to evidence/tenise36-negative-test.json");

  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exitCode = 1;
});
