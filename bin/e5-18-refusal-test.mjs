#!/usr/bin/env node
import fs from "node:fs";
import { submitChatQuestion } from "../src/modules/chat/services/chat.service.js";

// E5-18 acceptance test: an unanswerable set of 10 (system must refuse all 10,
// no factual claim in any) and an answerable set of 20 (false refusal rate
// must be <=10%, i.e. at most 2 wrongly refused). Run as `admin` throughout so
// a role-access denial (a different, already-tested mechanism -- E5-17) can
// never be mistaken for a grounding refusal here.
//
// needs a live Ollama and a built index -- run with `npm run eval:refusal`.

const UNANSWERABLE = [
  { id: "U-01", q: "What was Novak Djokovic's serve speed at the 2019 Australian Open final?", note: "hallucination trap: real player, plausible stat, not in this corpus (gold_set ABS-04)" },
  { id: "U-02", q: "What does Allistair McCaw list as the E.Q. skills in coaching?", note: "named source not present in corpus (gold_set ABS-06)" },
  { id: "U-03", q: "What was Serena Williams' fastest recorded serve speed in her career?", note: "replaced 2026-08-20: original beep-test question was answered from a verbalised table row -- genuinely grounded, not absent. Verified this one returns 0 evidence before adding it." },
  { id: "U-04", q: "What was Rafael Nadal's forehand topspin RPM at the 2022 French Open final?", note: "hallucination trap: external player/event, ultra-specific fabricated-sounding stat" },
  { id: "U-05", q: "What is the median singles ranking per month across the ranking data?", note: "structured route, ranking CSV not present on this machine" },
  { id: "U-06", q: "What is Roger Federer's career win-loss record against Rafael Nadal?", note: "replaced 2026-08-20: original Alcaraz-ranking question was answered correctly from a verbalised match-data row -- genuinely grounded (also proved the answerFromTables fallback-to-documents fix works). Verified this head-to-head question returns 0 evidence before adding it." },
  { id: "U-07", q: "What is the standard treatment protocol for carpal tunnel syndrome in office workers?", note: "replaced 2026-08-20: original ACL-protocol question was answered from a real public research document (published clinical research is classified research:public, not clinical -- clinical domain is reserved for TA's own internal medical records). Verified this unrelated-condition question returns 0 evidence before adding it." },
  { id: "U-08", q: "What is the direct phone number for the head of the National Academy program?", note: "personal/PII specifics not retrievable in this form" },
  { id: "U-09", q: "What does the 2027 National Academy technology roadmap say about AI-based recovery tracking?", note: "hallucination trap: plausible doc-naming pattern (real docs exist for 2024-25/2025-26), 2027 does not" },
  { id: "U-10", q: "What training philosophy did Rafael Nadal's uncle and coach Toni Nadal describe in his own coaching manual?", note: "unresolved: answered live on 2026-08-20 from a real interview paper (giles-movement-interviews-paper-2), grounded/citedFraction 1 -- kept as a known caveat rather than replaced again, see evidence/e5-18-refusal-rate.json" },
];

const ANSWERABLE = [
  { id: "A-01", q: "What does the research say about accelerometer load in matches compared with training, and how does the Catapult programme apply that?", src: "gold_set MS-01" },
  { id: "A-02", q: "How was the wearable stroke detection algorithm validated, and what was it then used to measure in match play?", src: "gold_set MS-02" },
  { id: "A-03", q: "What are the risk factors for lumbar bone stress injuries and what planning controls are recommended to reduce them?", src: "gold_set MS-03" },
  { id: "A-04", q: "Summarise what we know about lumbar stress injuries in junior players and how they are prevented.", src: "gold_set SUM-01" },
  { id: "A-05", q: "Give me an executive summary of the wearable technology research in this knowledge base.", src: "gold_set SUM-02" },
  { id: "A-06", q: "What percentage of a year's training and competition is disrupted by a lumbar stress fracture?", src: "gold_set SH-01, expect '47'" },
  { id: "A-07", q: "How many strokes were manually coded and categorised in the PhD study?", src: "gold_set SH-02, expect '5349'" },
  { id: "A-08", q: "What does Mark Kovacs say about the tournament round a player needs to reach?", src: "gold_set ABS-01, now answerable" },
  { id: "A-09", q: "According to Beni Linder, what percentages of speed should players vary between?", src: "gold_set ABS-02, now answerable" },
  { id: "A-10", q: "Who were the authors of the first Cardio Tennis publication and in what year was it published?", src: "gold_set SRC-01, expect 'Murphy'" },
  { id: "A-11", q: "How many female tennis players were recruited for the Whiteside 2013 serve kinematics study?", src: "gold_set SRC-02" },
  { id: "A-12", q: "Tell me about serve volume distribution and accelerometer load from wearable microtechnology.", src: "query_set exact-match" },
  { id: "A-13", q: "What does the research say about macro periodisation of competition in international women's tennis?", src: "query_set exact-match" },
  { id: "A-14", q: "How should a season be structured for long term athlete development?", src: "query_set paraphrase" },
  { id: "A-15", q: "How is machine learning used to detect tennis strokes from wearable sensors?", src: "query_set exact-match" },
  { id: "A-16", q: "Can a sensor tell the difference between a forehand and a backhand?", src: "query_set paraphrase" },
  { id: "A-17", q: "What does the research say about determining stroke and movement profiles in competitive match play?", src: "query_set exact-match" },
  { id: "A-18", q: "What does the research say about differentiating stroke and movement using accelerometer load?", src: "query_set exact-match" },
  { id: "A-19", q: "What does the research say about conditioning and fitness training for tennis players?", src: "query_set exact-match" },
  { id: "A-20", q: "What new hardware or technology is the National Academy planning to use for measuring athlete movement, recovery, or capacity, such as Prism Neuro, the 1080 Sprint, or VO2 Master?", src: "verified live in this session (2026-08-20)" },
];

async function runOne(item, expectAnswered) {
  const started = Date.now();

  try {
    const result = await submitChatQuestion(item.q, {
      roleId: "admin",
      correlationId: `e5-18:${item.id}`,
    });

    const durationMs = Date.now() - started;
    const answered = result.response.answered === true;
    const correct = answered === expectAnswered;

    return {
      id: item.id,
      question: item.q,
      expectAnswered,
      answered,
      correct,
      durationMs,
      answerPreview: String(result.response.answer ?? "").slice(0, 160),
      evidenceCount: result.response.evidenceCount ?? result.citations?.length ?? 0,
    };
  } catch (error) {
    return {
      id: item.id,
      question: item.q,
      expectAnswered,
      answered: null,
      correct: false,
      durationMs: Date.now() - started,
      error: error.message,
    };
  }
}

async function main() {
  const results = { unanswerable: [], answerable: [] };

  console.log(`Starting E5-18 test: ${UNANSWERABLE.length} unanswerable + ${ANSWERABLE.length} answerable questions.`);
  console.log("This runs sequentially against the real pipeline (Ollama) -- expect several minutes.\n");

  for (const item of UNANSWERABLE) {
    process.stdout.write(`[unanswerable] ${item.id}... `);
    const r = await runOne(item, false);
    results.unanswerable.push(r);
    console.log(`${r.correct ? "OK (refused)" : "FAIL (answered when it should have refused)"} (${r.durationMs}ms)`);
  }

  for (const item of ANSWERABLE) {
    process.stdout.write(`[answerable]   ${item.id}... `);
    const r = await runOne(item, true);
    results.answerable.push(r);
    console.log(`${r.correct ? "OK (answered)" : "FAIL (wrongly refused)"} (${r.durationMs}ms)`);
  }

  const falseClaims = results.unanswerable.filter((r) => r.answered === true).length;
  const falseRefusals = results.answerable.filter((r) => r.answered === false).length;
  const falseRefusalRate = (falseRefusals / ANSWERABLE.length) * 100;
  const avgLatencyMs =
    [...results.unanswerable, ...results.answerable].reduce((sum, r) => sum + r.durationMs, 0) /
    (UNANSWERABLE.length + ANSWERABLE.length);

  const summary = {
    unanswerableSet: { total: UNANSWERABLE.length, falseClaims, passed: falseClaims === 0 },
    answerableSet: {
      total: ANSWERABLE.length,
      falseRefusals,
      falseRefusalRatePercent: Number(falseRefusalRate.toFixed(1)),
      passed: falseRefusalRate <= 10,
    },
    avgLatencyMs: Math.round(avgLatencyMs),
  };

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  fs.writeFileSync(
    "evidence/e5-18-refusal-rate.json",
    JSON.stringify({ summary, results }, null, 2),
  );

  console.log("\nFull results written to evidence/e5-18-refusal-rate.json");
  process.exit(0);
}

main();
