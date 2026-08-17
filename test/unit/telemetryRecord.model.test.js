import { test } from "node:test";
import assert from "node:assert/strict";

import TelemetryRecord from "../../src/modules/telemetry/models/telemetryRecord.model.js";
import { telemetryConfig } from "../../src/modules/telemetry/telemetry.config.js";

// Declaring a Mongoose index needs no connection, so the retention policy is
// checkable without a database.

test("records expire, so the collection cannot grow without bound", () => {
  const ttlIndexes = TelemetryRecord.schema
    .indexes()
    .filter(([, options]) => options?.expireAfterSeconds !== undefined);

  assert.equal(ttlIndexes.length, 1);

  const [fields, options] = ttlIndexes[0];

  // TTL indexes are single field and must sit on a date. startedAt is required
  // on every record; createdAt is not part of the query surface.
  assert.deepEqual(fields, { startedAt: 1 });
  assert.equal(
    options.expireAfterSeconds,
    telemetryConfig.retentionDays * 24 * 60 * 60,
  );
});

test("retention defaults to something finite when unconfigured", () => {
  assert.ok(Number.isInteger(telemetryConfig.retentionDays));
  assert.ok(telemetryConfig.retentionDays > 0);
});
