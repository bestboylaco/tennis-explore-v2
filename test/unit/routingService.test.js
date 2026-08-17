import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyQuery,
  routeQuery,
} from "../../src/modules/chat/services/routing.service.js";
import { startTelemetryRun } from "../../src/modules/telemetry/services/telemetryRecorder.service.js";
import {
  API_TYPES,
  PIPELINE_STAGES,
  QUERY_CLASSES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "../../src/shared/constants/telemetry.js";

// Routing is rule based, so these run with no model and no network.

const STATISTICS_QUESTIONS = [
  "How many grand slams has Federer won?",
  "What is Nadal's win rate on clay?",
  "What is the head to head between Djokovic and Murray?",
  "Who has the most aces this season?",
  "What percentage of break points did she save?",
  "What were his stats in 2019?",
];

const DOCUMENT_QUESTIONS = [
  "How should I grip the racquet for a topspin forehand?",
  "Explain the kick serve technique.",
  "What does the coaching manual say about footwork drills?",
  "Why is split stepping important?",
];

test("statistics questions classify as the statistics class", () => {
  for (const question of STATISTICS_QUESTIONS) {
    const { queryClass } = classifyQuery(question);

    assert.equal(
      queryClass,
      QUERY_CLASSES.STATISTICS,
      `expected statistics for: ${question}`,
    );
  }
});

test("technique and explanation questions classify as the document class", () => {
  for (const question of DOCUMENT_QUESTIONS) {
    const { queryClass } = classifyQuery(question);

    assert.equal(
      queryClass,
      QUERY_CLASSES.DOCUMENT,
      `expected document for: ${question}`,
    );
  }
});

test("an empty question is not applicable rather than silently a document", () => {
  assert.equal(classifyQuery("").queryClass, QUERY_CLASSES.NOT_APPLICABLE);
  assert.equal(classifyQuery("   ").queryClass, QUERY_CLASSES.NOT_APPLICABLE);
  assert.equal(classifyQuery(undefined).queryClass, QUERY_CLASSES.NOT_APPLICABLE);
});

test("routing measures its own stage and tags the record with the class it decided", async () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  const result = await routeQuery({
    question: "How many titles has she won?",
    recorder: run,
  });

  const record = run.snapshot();
  const stage = record.stages[PIPELINE_STAGES.ROUTING];

  assert.equal(result.queryClass, QUERY_CLASSES.STATISTICS);
  assert.equal(stage.status, STAGE_STATUSES.SUCCESS);
  assert.equal(stage.apiType, API_TYPES.LOCAL);
  assert.equal(typeof stage.durationMs, "number");
  assert.ok(stage.startedAt !== null && stage.completedAt !== null);

  // The tag on the record is the decision, not the schema default.
  assert.equal(record.queryClass, QUERY_CLASSES.STATISTICS);
});

test("the record shows which rule fired and never the question text", async () => {
  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });
  const question = "What is the head to head between Djokovic and Murray?";

  await routeQuery({ question, recorder: run });

  const stage = run.snapshot().stages[PIPELINE_STAGES.ROUTING];

  assert.equal(stage.attributes.rule, "head_to_head");

  // Threat model T-04: telemetry stores metadata, never content.
  const serialised = JSON.stringify(run.snapshot());

  assert.ok(!serialised.includes("Djokovic"));
  assert.ok(!serialised.includes(question));
});

test("routing works without a recorder", async () => {
  const result = await routeQuery({ question: "Explain the slice backhand." });

  assert.equal(result.queryClass, QUERY_CLASSES.DOCUMENT);
});
