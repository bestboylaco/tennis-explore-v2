import { test } from "node:test";
import assert from "node:assert/strict";

// The browser path (no supplied evidence) must open a `query` run and record
// its stages -- before this, only the supplied-evidence test path did, so the
// telemetry page showed nothing but api_request and startup records for real
// use.
//
// Persistence is switched off before anything telemetry-related is imported:
// telemetryConfig is frozen at import time, and a unit test writing records
// into whatever store .env points at is exactly how fake rows end up on the
// telemetry page.
process.env.TELEMETRY_ENABLED = "false";

const { submitChatQuestion } = await import("../../src/modules/chat/services/chat.service.js");
const { startTelemetryRun } = await import("../../src/modules/telemetry/services/telemetryRecorder.service.js");
const {
  PIPELINE_STAGES,
  QUERY_CLASSES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_RUN_TYPES,
} = await import("../../src/shared/constants/telemetry.js");

function openRun() {
  return startTelemetryRun({ runType: TELEMETRY_RUN_TYPES.QUERY, correlationId: "query:test" });
}

test("the browser path records a finished query run", async () => {
  const run = openRun();

  const result = await submitChatQuestion("Hi!", { roleId: "admin", telemetryRun: run });
  const record = run.snapshot();

  assert.equal(record.runType, TELEMETRY_RUN_TYPES.QUERY);
  assert.equal(record.correlationId, "query:test");
  assert.equal(record.status, RUN_STATUSES.SUCCESS);
  assert.equal(typeof record.totalDurationMs, "number");
  assert.equal(record.attributes.answered, true);
  assert.equal(result.telemetry.recordId, run.recordId);
});

test("chitchat is filed as not_applicable with every stage skipped, not left unimplemented", async () => {
  const run = openRun();

  await submitChatQuestion("thanks!", { roleId: "admin", telemetryRun: run });
  const record = run.snapshot();

  assert.equal(record.queryClass, QUERY_CLASSES.NOT_APPLICABLE);

  for (const stage of Object.values(PIPELINE_STAGES)) {
    assert.equal(record.stages[stage].status, STAGE_STATUSES.SKIPPED, `${stage} status`);
    assert.equal(record.stages[stage].reason, "chitchat", `${stage} reason`);
    assert.equal(record.stages[stage].durationMs, null, `${stage} contributes no latency sample`);
  }
});

test("a failed question finishes the run as failed instead of leaving it open", async () => {
  const run = openRun();

  // A whitespace-only question passes submitChatQuestion's role check and
  // is rejected by answerQuestion -- a real error from inside the try.
  await assert.rejects(submitChatQuestion("   ", { roleId: "admin", telemetryRun: run }));

  const record = run.snapshot();

  assert.equal(record.status, RUN_STATUSES.FAILED);
  assert.notEqual(record.completedAt, null);
  assert.match(record.error.message, /non-empty question/);
});
