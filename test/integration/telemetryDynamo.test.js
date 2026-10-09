import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// TENISE-63: telemetryRecord.model.js / telemetryStore.service.js against a
// real DynamoDB-compatible server (DynamoDB Local), the same pattern
// test/integration/s3Upload.test.js uses for the S3 adapter. The aggregation
// math itself (percentiles, grouping, cold-start exclusion) is covered in
// detail by test/integration/telemetryAggregation.test.js; this file proves
// the write/read/scan/TTL plumbing underneath it.

const DYNAMODB_TEST_ENDPOINT = process.env.DYNAMODB_TEST_ENDPOINT || "http://localhost:8800";
const DYNAMODB_TEST_TABLE = process.env.DYNAMODB_TEST_TABLE || "tennis-explore-g2";

process.env.DYNAMODB_ENDPOINT = DYNAMODB_TEST_ENDPOINT;
process.env.DYNAMODB_TABLE_NAME = DYNAMODB_TEST_TABLE;
process.env.DYNAMODB_ACCESS_KEY_ID ||= "local";
process.env.DYNAMODB_SECRET_ACCESS_KEY ||= "local";

async function isDynamoDbReachable() {
  try {
    const response = await fetch(DYNAMODB_TEST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "X-Amz-Target": "DynamoDB_20120810.ListTables",
      },
      body: "{}",
    });

    const body = await response.json().catch(() => null);

    return typeof body?.__type === "string" && body.__type.includes("dynamodb");
  } catch {
    return false;
  }
}

const dynamoAvailable = await isDynamoDbReachable();
const skipReason = dynamoAvailable
  ? false
  : `no DynamoDB-compatible server reachable at ${DYNAMODB_TEST_ENDPOINT}; run "docker compose up -d dynamodb-local dynamodb-local-init" to start DynamoDB Local.`;

const {
  createTelemetryRecord,
  getTelemetryRecordByRecordId,
  scanAllTelemetryRecords,
} = await import("../../src/modules/telemetry/models/telemetryRecord.model.js");
const {
  countTelemetryRecords,
  findTelemetryRecordById,
  findTelemetryRecords,
  persistTelemetryRecord,
} = await import("../../src/modules/telemetry/services/telemetryStore.service.js");
const { getItem } = await import("../../src/infrastructure/dynamodb/dynamoTable.service.js");

function buildRecord(overrides = {}) {
  return {
    recordId: randomUUID(),
    runType: "api_request",
    correlationId: `itest:telemetry-dynamo:${randomUUID()}`,
    queryClass: "not_applicable",
    status: "success",
    startedAt: new Date(),
    completedAt: new Date(),
    totalDurationMs: 42,
    stages: { routing: { status: "success", durationMs: 1 } },
    tokens: { input: 0, output: 0 },
    compute: { ocuSeconds: 0, byResource: {} },
    attributes: {},
    ...overrides,
  };
}

describe("DynamoDB telemetry store", { skip: skipReason }, () => {
  const correlationIds = [];

  after(async () => {
    // No bulk-delete helper exists (telemetry relies on TTL, not manual
    // cleanup, in production) -- Scan+delete here only to keep this test's
    // own fixtures out of other suites' counts.
    const { deleteItem } = await import("../../src/infrastructure/dynamodb/dynamoTable.service.js");
    const all = await scanAllTelemetryRecords();

    for (const record of all) {
      if (correlationIds.includes(record.correlationId)) {
        await deleteItem(`TELEMETRY#${record.recordId}`, "RECORD");
      }
    }
  });

  it("writes a record and reads it back by recordId", async () => {
    const record = buildRecord();

    correlationIds.push(record.correlationId);

    await createTelemetryRecord(record);

    const found = await getTelemetryRecordByRecordId(record.recordId);

    assert.equal(found.recordId, record.recordId);
    assert.equal(found.runType, "api_request");
    assert.equal(found.totalDurationMs, 42);
    // Dates are normalised to ISO strings on write -- see
    // telemetryRecord.model.js's serialiseForStorage() comment.
    assert.equal(typeof found.startedAt, "string");
    assert.equal(new Date(found.startedAt).getTime(), record.startedAt.getTime());
  });

  it("sets DynamoDB's native per-item TTL attribute from startedAt + retentionDays", async () => {
    const record = buildRecord();

    correlationIds.push(record.correlationId);

    await createTelemetryRecord(record);

    // Reach past the public contract deliberately, to prove the TTL
    // attribute really is on the stored item (getTelemetryRecordByRecordId
    // strips it, same as it strips PK/SK/entityType).
    const raw = await getItem(`TELEMETRY#${record.recordId}`, "RECORD");

    assert.ok(raw.ttl, "the ttl attribute is present on the stored item");
    assert.ok(raw.ttl > Math.floor(record.startedAt.getTime() / 1000), "ttl is in the future relative to startedAt");
  });

  it("persistTelemetryRecord is best-effort: a write failure is swallowed, never thrown", async () => {
    // A record missing recordId cannot be keyed -- this exercises the
    // same try/catch persistTelemetryRecord has always had, now around a
    // DynamoDB PutItem instead of a Mongo .create().
    const result = await persistTelemetryRecord({ runType: "api_request" });

    assert.equal(result, null);
  });

  it("findTelemetryRecords filters by correlationId and sorts newest first", async () => {
    const correlationId = `itest:telemetry-dynamo:${randomUUID()}`;

    correlationIds.push(correlationId);

    const older = buildRecord({ correlationId, startedAt: new Date(Date.now() - 60_000) });
    const newer = buildRecord({ correlationId, startedAt: new Date() });

    await createTelemetryRecord(older);
    await createTelemetryRecord(newer);

    const found = await findTelemetryRecords({ correlationId });

    assert.equal(found.length, 2);
    assert.equal(found[0].recordId, newer.recordId, "newest record sorts first");
    assert.equal(found[1].recordId, older.recordId);

    const count = await countTelemetryRecords({ correlationId });

    assert.equal(count, 2);
  });

  it("findTelemetryRecordById delegates to the model's point lookup", async () => {
    const record = buildRecord();

    correlationIds.push(record.correlationId);

    await createTelemetryRecord(record);

    const found = await findTelemetryRecordById(record.recordId);

    assert.equal(found.recordId, record.recordId);
  });

  it("findTelemetryRecordById returns null for an unknown recordId, not a throw", async () => {
    assert.equal(await findTelemetryRecordById(randomUUID()), null);
  });

  it("preserves dynamic nested keys (stages/compute.byResource) with no schema change", async () => {
    const correlationId = `itest:telemetry-dynamo:${randomUUID()}`;

    correlationIds.push(correlationId);

    const record = buildRecord({
      correlationId,
      stages: {
        routing: { status: "success", durationMs: 1 },
        // A brand new stage name nobody declared ahead of time.
        a_future_stage_nobody_knows_about_yet: { status: "success", durationMs: 7 },
      },
      compute: {
        ocuSeconds: 1,
        byResource: { a_future_billed_resource: { seconds: 1, ocuSeconds: 1, calls: 1 } },
      },
    });

    await createTelemetryRecord(record);

    const found = await getTelemetryRecordByRecordId(record.recordId);

    assert.equal(found.stages.a_future_stage_nobody_knows_about_yet.durationMs, 7);
    assert.equal(found.compute.byResource.a_future_billed_resource.ocuSeconds, 1);
  });
});
