import { test } from "node:test";
import assert from "node:assert/strict";

import { submitChatQuestion } from "../../src/modules/chat/services/chat.service.js";
import { startTelemetryRun } from "../../src/modules/telemetry/services/telemetryRecorder.service.js";
import {
  COMPUTE_RESOURCES,
  PIPELINE_STAGES,
  QUERY_CLASSES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
  TELEMETRY_SCHEMA_VERSION,
} from "../../src/shared/constants/telemetry.js";

// TENISE-30 acceptance criterion 5: a test query produces a complete record
// with every stage that currently exists filled in, and no empty field that
// should have been populated.
//
// The Ollama call is stubbed, so this runs with no model and no MongoDB. The
// recorder is injected so the finished record can be read without a store.

// The stub sleeps so the measured durations are non-zero. Without it the whole
// pipeline can finish inside one clock tick and the latency assertions below
// would pass or fail on timer resolution rather than on instrumentation.
const STUB_LATENCY_MS = 25;

function stubOllama({ promptEvalCount = 120, evalCount = 45 } = {}) {
  const original = globalThis.fetch;

  globalThis.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, STUB_LATENCY_MS));

    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "llama3.1:8b",
        message: { role: "assistant", content: "She has won 23 grand slam titles." },
        done: true,
        prompt_eval_count: promptEvalCount,
        eval_count: evalCount,
      }),
    };
  };

  return () => {
    globalThis.fetch = original;
  };
}

async function runTestQuery({ question, evidence = ["Grand slam titles: 23."] } = {}) {
  const restore = stubOllama();
  const run = startTelemetryRun({
    runType: TELEMETRY_RUN_TYPES.QUERY,
    correlationId: "query:test-correlation",
  });

  try {
    const result = await submitChatQuestion(question, { evidence, telemetryRun: run });

    return { result, record: run.snapshot() };
  } finally {
    restore();
  }
}

test("a test query fills in every stage that currently exists", async () => {
  const { record } = await runTestQuery({
    question: "How many grand slam titles has she won?",
  });

  // Routing and generation exist and must carry their own latency. A single
  // end-to-end figure does not satisfy this story.
  for (const name of [PIPELINE_STAGES.ROUTING, PIPELINE_STAGES.GENERATION]) {
    const stage = record.stages[name];

    assert.equal(stage.status, STAGE_STATUSES.SUCCESS, `${name} status`);
    assert.equal(typeof stage.durationMs, "number", `${name} durationMs`);
    assert.ok(stage.durationMs >= 0, `${name} durationMs is a real measurement`);
    assert.notEqual(stage.startedAt, null, `${name} startedAt`);
    assert.notEqual(stage.completedAt, null, `${name} completedAt`);
    assert.notEqual(stage.apiType, null, `${name} apiType`);
    assert.equal(stage.attempts, 1, `${name} attempts`);
  }

  // The three latencies are recorded separately, so they can be compared.
  assert.notEqual(
    record.stages[PIPELINE_STAGES.ROUTING].durationMs,
    record.totalDurationMs,
    "routing latency must not be the end-to-end figure",
  );

  // Retrieval does not exist yet (TENISE-15/17). It says so explicitly with a
  // reason rather than sitting silently at not_implemented.
  const retrieval = record.stages[PIPELINE_STAGES.RETRIEVAL];

  assert.equal(retrieval.status, STAGE_STATUSES.SKIPPED);
  assert.equal(retrieval.reason, "evidence_supplied_by_caller");

  // Rerank is TENISE-18 and emits into these same fields with no schema change.
  assert.equal(
    record.stages[PIPELINE_STAGES.RERANK].status,
    STAGE_STATUSES.NOT_IMPLEMENTED,
  );
});

test("input and output token counts are recorded per model call", async () => {
  const { record } = await runTestQuery({ question: "How many titles has she won?" });
  const generation = record.stages[PIPELINE_STAGES.GENERATION];

  assert.equal(generation.tokensIn, 120);
  assert.equal(generation.tokensOut, 45);
  assert.equal(generation.apiCalls, 1);

  // A token count is only comparable across weeks if it says which model
  // produced it.
  assert.equal(generation.attributes.model, "llama3.1:8b");
  assert.ok(generation.attributes.promptVersion);

  // Run level totals stay consistent with the per-stage split.
  assert.equal(record.tokens.input, 120);
  assert.equal(record.tokens.output, 45);
});

test("OCU-seconds consumed by the query are recorded and split by resource", async () => {
  const { record } = await runTestQuery({ question: "How many titles has she won?" });

  assert.ok(record.compute.ocuSeconds > 0, "run level OCU-seconds");
  assert.equal(record.compute.basis, "estimated");

  const ollama = record.compute.byResource[COMPUTE_RESOURCES.OLLAMA];

  assert.ok(ollama, "generation compute is attributed to the model host");
  assert.ok(ollama.seconds > 0);
  assert.ok(ollama.ocu > 0);
  assert.equal(ollama.calls, 1);
  assert.equal(ollama.ocuSeconds, ollama.seconds * ollama.ocu);

  // The total agrees with the split, so a report can use either.
  assert.equal(record.compute.ocuSeconds, ollama.ocuSeconds);

  // The figure comes from the stage it was charged to, not from a second timer.
  assert.equal(
    ollama.seconds,
    record.stages[PIPELINE_STAGES.GENERATION].durationMs / 1000,
  );
});

test("the query class tag carries the real class, not a single default value", async () => {
  const statistics = await runTestQuery({
    question: "How many aces did he serve in 2019?",
  });
  const document = await runTestQuery({
    question: "Explain how to hit a topspin backhand.",
  });

  assert.equal(statistics.record.queryClass, QUERY_CLASSES.STATISTICS);
  assert.equal(document.record.queryClass, QUERY_CLASSES.DOCUMENT);

  // The point of the criterion: two different questions do not collapse onto
  // one tag.
  assert.notEqual(statistics.record.queryClass, document.record.queryClass);

  // And the caller can see the decision too.
  assert.equal(statistics.result.response.queryClass, QUERY_CLASSES.STATISTICS);
});

test("no field that should have been populated is left empty", async () => {
  const { record, result } = await runTestQuery({
    question: "How many grand slam titles has she won?",
  });

  function read(path) {
    return path
      .split(".")
      .reduce((current, key) => (current === undefined ? undefined : current?.[key]), record);
  }

  // Read as: TENISE-27 asks for this field, and it cannot be recovered later,
  // because the measurements would have to be regenerated on a system that has
  // already changed.
  const mustBePresent = [
    "schemaVersion",
    "recordId",
    "runType",
    "correlationId",
    "queryClass",
    "status",
    "environment",
    "serviceVersion",
    "startedAt",
    "completedAt",
    "totalDurationMs",
    "tokens.input",
    "tokens.output",
    "compute.ocuSeconds",
    "compute.basis",
    "stages.routing.status",
    "stages.routing.durationMs",
    "stages.routing.startedAt",
    "stages.routing.completedAt",
    "stages.routing.apiType",
    "stages.routing.attributes.rule",
    "stages.retrieval.status",
    "stages.retrieval.reason",
    "stages.generation.status",
    "stages.generation.durationMs",
    "stages.generation.startedAt",
    "stages.generation.completedAt",
    "stages.generation.apiType",
    "stages.generation.apiCalls",
    "stages.generation.tokensIn",
    "stages.generation.tokensOut",
    "stages.generation.attributes.model",
  ];

  for (const path of mustBePresent) {
    const value = read(path);

    assert.notEqual(value, undefined, `${path} is missing`);
    assert.notEqual(value, null, `${path} is null`);
    assert.notEqual(value, "", `${path} is empty`);
  }

  // Separately: fields where zero would mean nothing was recorded. Stage
  // durations are deliberately not in this list -- routing is genuinely
  // sub-millisecond, so a small figure there is a measurement, not a gap.
  const mustBeNonZero = [
    "totalDurationMs",
    "tokens.input",
    "tokens.output",
    "compute.ocuSeconds",
    "stages.generation.durationMs",
    "stages.generation.apiCalls",
    "stages.generation.tokensIn",
    "stages.generation.tokensOut",
  ];

  for (const path of mustBeNonZero) {
    assert.ok(read(path) > 0, `${path} was never populated`);
  }

  assert.equal(record.schemaVersion, TELEMETRY_SCHEMA_VERSION);
  assert.equal(record.status, RUN_STATUSES.SUCCESS);
  assert.equal(record.error.code, null);

  // The record is reachable from the response, so the measurements can be read
  // back at GET /api/telemetry/:recordId.
  assert.equal(result.telemetry.recordId, record.recordId);
});

test("a failed query still records the stages that ran before the failure", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

  try {
    // Evidence must be explicit ([], not omitted) to take this instrumented
    // path at all -- omitted evidence now means "run real retrieval"
    // (answerQuestion, E5-17), which this test is not exercising.
    await assert.rejects(() =>
      submitChatQuestion("How many titles has she won?", { evidence: [], telemetryRun: run }),
    );

    const record = run.snapshot();

    // Routing succeeded and its measurement survives the failure downstream.
    assert.equal(record.stages[PIPELINE_STAGES.ROUTING].status, STAGE_STATUSES.SUCCESS);
    assert.equal(record.queryClass, QUERY_CLASSES.STATISTICS);
    assert.equal(record.stages[PIPELINE_STAGES.GENERATION].status, STAGE_STATUSES.FAILED);
    assert.equal(record.status, RUN_STATUSES.FAILED);
    assert.notEqual(record.error.code, null);
  } finally {
    globalThis.fetch = original;
  }
});
