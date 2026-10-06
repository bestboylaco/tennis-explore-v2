import mongoose from "mongoose";

import {
  createTelemetryRecord,
  getTelemetryRecordByRecordId,
  scanAllTelemetryRecords,
} from "../models/telemetryRecord.model.js";
import { telemetryConfig } from "../telemetry.config.js";

// TENISE-63: telemetry now writes to DynamoDB, not MongoDB -- see
// telemetryRecord.model.js. Writes are still best effort: a telemetry
// failure must never fail the run being measured.
//
// `mongoose` is still imported here deliberately, for exactly one static
// utility (isValidObjectId): ingestion.sourceId really is a Mongo ObjectId,
// because Source (src/modules/sources/) stays on MongoDB -- out of scope for
// this migration. That one validation call needs no live Mongo connection.

export function isTelemetryStoreReady() {
  // DynamoDB has no persistent "connection" to introspect the way
  // mongoose.connection.readyState does -- there is a client, but whether a
  // given call will succeed is only known by making it. This now reports
  // whether telemetry is configured to write at all; a DynamoDB outage still
  // surfaces per-write via persistTelemetryRecord's own try/catch below,
  // same as it always has.
  return telemetryConfig.enabled;
}

export async function persistTelemetryRecord(record) {
  if (!telemetryConfig.enabled) {
    return null;
  }

  try {
    return await createTelemetryRecord(record);
  } catch (error) {
    console.warn(`Telemetry write failed (${record.recordId}):`, error.message);
    return null;
  }
}

function buildTimeRangeFilter({ from, to } = {}) {
  const range = {};

  if (from) {
    range.$gte = new Date(from);
  }

  if (to) {
    range.$lte = new Date(to);
  }

  return Object.keys(range).length > 0 ? { startedAt: range } : {};
}

// Unchanged from the Mongo-era version, deliberately: this produces a plain,
// DB-agnostic filter descriptor (test/unit/telemetryRecorder.test.js asserts
// its exact shape without any database running). recordMatchesFilter() below
// is what actually evaluates it, against records already fetched from
// DynamoDB, instead of a MongoDB query engine.
export function buildTelemetryFilter({
  runType,
  queryClass,
  status,
  correlationId,
  sourceId,
  coldStart,
  from,
  to,
} = {}) {
  const filter = { ...buildTimeRangeFilter({ from, to }) };

  if (runType) {
    filter.runType = runType;
  }

  if (queryClass) {
    filter.queryClass = queryClass;
  }

  if (status) {
    filter.status = status;
  }

  if (correlationId) {
    filter.correlationId = correlationId;
  }

  // A filter that cannot be applied is rejected, never dropped. Silently
  // ignoring a malformed sourceId would answer a narrow question with every
  // record in the collection.
  if (sourceId) {
    if (!mongoose.isValidObjectId(sourceId)) {
      const error = new Error("sourceId must be a valid ObjectId.");

      error.code = "INVALID_SOURCE_ID";
      error.statusCode = 400;

      throw error;
    }

    filter["ingestion.sourceId"] = sourceId;
  }

  if (coldStart === true) {
    filter["coldStart.detected"] = true;
  }

  if (coldStart === false) {
    filter["coldStart.detected"] = { $ne: true };
  }

  return filter;
}

function getPath(record, path) {
  return path.split(".").reduce((current, key) => (current == null ? undefined : current[key]), record);
}

// Evaluates a buildTelemetryFilter() descriptor against one record fetched
// from DynamoDB. Only the handful of shapes that function ever actually
// produces are supported ($gte/$lte on startedAt, $ne on coldStart.detected,
// plain equality on everything else) -- this is a small matcher for a known
// filter grammar, not a general Mongo-query emulator.
export function recordMatchesFilter(record, filter) {
  for (const [path, condition] of Object.entries(filter)) {
    const value = getPath(record, path);

    if (path === "startedAt" && condition && typeof condition === "object") {
      const valueMs = value ? new Date(value).getTime() : Number.NaN;

      if ("$gte" in condition && !(valueMs >= new Date(condition.$gte).getTime())) {
        return false;
      }

      if ("$lte" in condition && !(valueMs <= new Date(condition.$lte).getTime())) {
        return false;
      }

      continue;
    }

    if (condition && typeof condition === "object" && "$ne" in condition) {
      if (value === condition.$ne) {
        return false;
      }

      continue;
    }

    if (value !== condition) {
      return false;
    }
  }

  return true;
}

// The shared read path: every store query and every aggregation in
// telemetryAggregation.service.js goes through this. A full Scan of the
// telemetry entity type, filtered in memory -- see
// telemetryRecord.model.js's scanAllTelemetryRecords() for why, and
// docs/DYNAMODB-MIGRATION.md for the scaling note.
export async function fetchTelemetryRecords(options = {}) {
  const filter = buildTelemetryFilter(options);
  const records = await scanAllTelemetryRecords();

  return records.filter((record) => recordMatchesFilter(record, filter));
}

export async function findTelemetryRecords(options = {}) {
  const limit = Math.min(Number(options.limit) || telemetryConfig.queryLimit, 500);

  const records = await fetchTelemetryRecords(options);

  records.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  return records.slice(0, limit);
}

export async function findTelemetryRecordById(recordId) {
  return getTelemetryRecordByRecordId(recordId);
}

export async function countTelemetryRecords(options = {}) {
  const records = await fetchTelemetryRecords(options);

  return records.length;
}
