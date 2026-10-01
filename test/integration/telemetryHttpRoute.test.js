import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import dotenv from "dotenv";
import mongoose from "mongoose";

// The route-prefix defect only exists in the Express request lifecycle: as an
// error unwinds out of a sub-router, req.baseUrl is reset to "" while
// req.route survives, and the telemetry callback runs after that. No unit
// test can reproduce it, because the tear-down is what does the damage. So
// this drives a real server and compares the recorded route of a request
// that succeeded with one that failed on the same endpoint.
//
// TENISE-63: telemetry records are DynamoDB now (findTelemetryRecords
// replaces TelemetryRecord.find), while Source stays on MongoDB -- this
// suite genuinely needs both reachable, so it is gated on both.

dotenv.config();

const mongoUri = process.env.MONGODB_URI;

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

let skipReason = false;

if (!mongoUri) {
  skipReason = "MONGODB_URI is not set";
} else if (!dynamoAvailable) {
  skipReason = `no DynamoDB-compatible server reachable at ${DYNAMODB_TEST_ENDPOINT}; run "docker compose up -d dynamodb-local dynamodb-local-init" to start DynamoDB Local.`;
}

const MISSING_ID = "000000000000000000000000";

let server;
let baseUrl;

// Records are written on res.on("finish"), i.e. after the response was sent,
// so they arrive shortly after fetch resolves.
async function waitForRecords(findTelemetryRecords, predicate, { attempts = 25, intervalMs = 200 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const records = (await findTelemetryRecords({ runType: "api_request", limit: 50 })).filter((record) =>
      /ingest$/.test(record.http?.route || ""),
    );

    const matched = predicate(records);

    if (matched) {
      return matched;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("telemetry records did not arrive in time");
}

describe("telemetry http.route", { skip: skipReason }, () => {
  const createdRecordIds = [];
  let sourceId;
  let findTelemetryRecords;
  let getTelemetryRecordByRecordId;
  let deleteItem;

  before(async () => {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

    // Imported here, not at module scope: src/app.js pulls in config/env.js,
    // which throws on a missing PORT while the module graph is still loading
    // — that kills the whole file before the skip above can apply.
    const { default: app } = await import("../../src/app.js");
    const { default: Source } = await import("../../src/modules/sources/models/source.model.js");
    const telemetryStore = await import("../../src/modules/telemetry/services/telemetryStore.service.js");
    const telemetryModel = await import("../../src/modules/telemetry/models/telemetryRecord.model.js");
    const dynamoTable = await import("../../src/infrastructure/dynamodb/dynamoTable.service.js");

    findTelemetryRecords = telemetryStore.findTelemetryRecords;
    getTelemetryRecordByRecordId = telemetryModel.getTelemetryRecordByRecordId;
    deleteItem = dynamoTable.deleteItem;

    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });

    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const source = await Source.create({
      title: "route resolution probe",
      sourceType: "research_paper",
    });

    sourceId = String(source._id);
  });

  after(async () => {
    const { default: Source } = await import("../../src/modules/sources/models/source.model.js");

    // Only the records this test positively identified are removed.
    await Promise.all(createdRecordIds.map((recordId) => deleteItem(`TELEMETRY#${recordId}`, "RECORD")));

    await Source.deleteOne({ _id: sourceId });

    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  });

  it("records one route pattern for an endpoint whether it succeeds or fails", async () => {
    const ok = await fetch(`${baseUrl}/api/sources/${sourceId}/ingest`, {
      method: "POST",
    });

    assert.equal(ok.status, 202);

    const failed = await fetch(`${baseUrl}/api/sources/${MISSING_ID}/ingest`, {
      method: "POST",
    });

    assert.equal(failed.status, 404);

    const [success, failure] = await waitForRecords(findTelemetryRecords, (records) => {
      const s = records.find((r) => r.http.statusCode === 202);
      const f = records.find((r) => r.http.statusCode === 404);

      return s && f ? [s, f] : null;
    });

    createdRecordIds.push(success.recordId, failure.recordId);

    // The defect recorded "/:sourceId/ingest" for the failure and
    // "/api/sources/:sourceId/ingest" for the success, so per-route
    // aggregation split one endpoint into two keys along exactly the line
    // that matters — every error in one bucket, every success in the other.
    assert.equal(success.http.route, "/api/sources/:sourceId/ingest");
    assert.equal(failure.http.route, "/api/sources/:sourceId/ingest");
    assert.equal(success.http.route, failure.http.route);
  });

  it("keeps the concrete path when no route matched", async () => {
    const response = await fetch(`${baseUrl}/api/definitely-not-a-route`);

    assert.equal(response.status, 404);

    const record = await (async () => {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const [found] = await findTelemetryRecords({ runType: "api_request", limit: 50 }).then((records) =>
          records.filter((r) => r.http?.route === "/api/definitely-not-a-route"),
        );

        if (found) {
          return found;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      throw new Error("unmatched-route record did not arrive in time");
    })();

    createdRecordIds.push(record.recordId);

    // req.route is never populated for a 404, so there is no pattern to
    // report and the concrete path is the honest answer.
    assert.equal(record.http.route, "/api/definitely-not-a-route");
    assert.equal(record.http.statusCode, 404);
  });

  it("does not record its own telemetry reads", async () => {
    await fetch(`${baseUrl}/api/telemetry?limit=1`);
    await fetch(`${baseUrl}/api/health`);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const recent = await findTelemetryRecords({ limit: 500 });
    const selfRecorded = recent.filter((record) => /^\/api\/(telemetry|health)/.test(record.http?.route || ""));

    assert.equal(selfRecorded.length, 0);
  });
});
