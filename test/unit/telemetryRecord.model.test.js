import { test } from "node:test";
import assert from "node:assert/strict";

import { computeTtlEpochSeconds } from "../../src/modules/telemetry/models/telemetryRecord.model.js";
import { telemetryConfig } from "../../src/modules/telemetry/telemetry.config.js";

// TENISE-63: records expire via DynamoDB's native per-item TTL attribute now,
// not a Mongo TTL index -- see telemetryRecord.model.js. Computing the expiry
// epoch needs no database, so the retention policy is checkable the same way
// it always was (the Mongo version of this file checked a schema-level index
// declaration, which also needed no connection).

test("records expire, so the table cannot grow without bound", () => {
  const startedAt = new Date("2026-01-01T00:00:00.000Z");
  const ttlSeconds = computeTtlEpochSeconds(startedAt);

  const expectedSeconds =
    Math.floor(startedAt.getTime() / 1000) + telemetryConfig.retentionDays * 24 * 60 * 60;

  assert.equal(ttlSeconds, expectedSeconds);
});

test("retention defaults to something finite when unconfigured", () => {
  assert.ok(Number.isInteger(telemetryConfig.retentionDays));
  assert.ok(telemetryConfig.retentionDays > 0);
});

test("accepts an ISO string the same as a Date instance", () => {
  // createTelemetryRecord() is handed record.startedAt before it has been
  // round-tripped through JSON, so it is always a real Date in practice --
  // but a record re-persisted from an already-serialised source (a replay, a
  // migration script) would hand this a string instead, and both must land
  // on the same epoch.
  const iso = "2026-06-15T08:30:00.000Z";

  assert.equal(computeTtlEpochSeconds(iso), computeTtlEpochSeconds(new Date(iso)));
});

test("a later startedAt produces a later expiry", () => {
  const earlier = computeTtlEpochSeconds(new Date("2026-01-01T00:00:00.000Z"));
  const later = computeTtlEpochSeconds(new Date("2026-01-02T00:00:00.000Z"));

  assert.equal(later - earlier, 24 * 60 * 60);
});
