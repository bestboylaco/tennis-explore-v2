import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateAnswer,
  GenerationError,
} from "../../src/modules/chat/services/generation.service.js";
import { startTelemetryRun } from "../../src/modules/telemetry/services/telemetryRecorder.service.js";
import {
  API_TYPES,
  PIPELINE_STAGES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
} from "../../src/shared/constants/telemetry.js";

// No real Ollama call in this file -- global.fetch is stubbed so these run
// without a network connection, per the unit test convention.

function stubFetchOnce(handler) {
  const original = globalThis.fetch;

  globalThis.fetch = async (...args) => handler(...args);

  return () => {
    globalThis.fetch = original;
  };
}

function ollamaResponse({ content, promptEvalCount = 10, evalCount = 4 }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: "llama3.1:8b",
      message: { role: "assistant", content },
      done: true,
      prompt_eval_count: promptEvalCount,
      eval_count: evalCount,
    }),
  };
}

test("generateAnswer returns the model's answer text and token counts", async () => {
  const restore = stubFetchOnce(async () =>
    ollamaResponse({ content: "The break point save rate was 55%.", promptEvalCount: 42, evalCount: 9 }),
  );

  try {
    const result = await generateAnswer({
      question: "What was the break point save rate?",
      evidence: ["Break points saved: 55%."],
    });

    assert.equal(result.answer, "The break point save rate was 55%.");
    assert.equal(result.tokensIn, 42);
    assert.equal(result.tokensOut, 9);
    assert.equal(typeof result.durationMs, "number");
  } finally {
    restore();
  }
});

test("a request without a question is rejected before any network call", async () => {
  let called = false;
  const restore = stubFetchOnce(async () => {
    called = true;
    return ollamaResponse({ content: "irrelevant" });
  });

  try {
    await assert.rejects(() => generateAnswer({ question: "" }));
    assert.equal(called, false);
  } finally {
    restore();
  }
});

test("an unreachable Ollama server surfaces as a GenerationError", async () => {
  const restore = stubFetchOnce(async () => {
    throw new Error("ECONNREFUSED");
  });

  try {
    await assert.rejects(
      () => generateAnswer({ question: "Any question", evidence: [] }),
      (error) => {
        assert.ok(error instanceof GenerationError);
        assert.equal(error.code, "GENERATION_FAILED");
        assert.equal(error.statusCode, 502);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("a non-OK response from Ollama surfaces as a GenerationError", async () => {
  const restore = stubFetchOnce(async () => ({
    ok: false,
    status: 500,
    text: async () => "model not found",
  }));

  try {
    await assert.rejects(
      () => generateAnswer({ question: "Any question" }),
      (error) => {
        assert.ok(error instanceof GenerationError);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("when given a telemetry recorder, token counts land on the generation stage", async () => {
  const restore = stubFetchOnce(async () =>
    ollamaResponse({ content: "answer", promptEvalCount: 20, evalCount: 5 }),
  );

  try {
    const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

    await generateAnswer({ question: "Q", evidence: ["one", "two"], recorder: run });

    const record = run.snapshot();
    const stage = record.stages[PIPELINE_STAGES.GENERATION];

    assert.equal(stage.status, STAGE_STATUSES.SUCCESS);
    assert.equal(stage.apiType, API_TYPES.OLLAMA_GENERATION);
    assert.equal(stage.tokensIn, 20);
    assert.equal(stage.tokensOut, 5);
    assert.equal(stage.itemsIn, 2);
    assert.equal(record.tokens.input, 20);
    assert.equal(record.tokens.output, 5);
  } finally {
    restore();
  }
});

test("a failed generation call fails the generation stage rather than leaving it open", async () => {
  const restore = stubFetchOnce(async () => {
    throw new Error("network down");
  });

  try {
    const run = startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY });

    await assert.rejects(() =>
      generateAnswer({ question: "Q", evidence: [], recorder: run }),
    );

    const record = run.snapshot();

    assert.equal(record.stages[PIPELINE_STAGES.GENERATION].status, STAGE_STATUSES.FAILED);
  } finally {
    restore();
  }
});
