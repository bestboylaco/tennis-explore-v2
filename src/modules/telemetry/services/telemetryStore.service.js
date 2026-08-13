import mongoose from "mongoose";

import TelemetryRecord from "../models/telemetryRecord.model.js";
import { telemetryConfig } from "../telemetry.config.js";

// Telemetry goes to its own queryable collection, not to console output, so
// TENISE-27 can aggregate it. Writes are best effort: a telemetry failure must
// never fail the run being measured.

let storeUnavailableWarned = false;

function warnStoreUnavailable(reason) {
  if (storeUnavailableWarned) {
    return;
  }

  storeUnavailableWarned = true;
  console.warn(`Telemetry not persisted: ${reason}. Further warnings suppressed.`);
}

export function isTelemetryStoreReady() {
  return telemetryConfig.enabled && mongoose.connection.readyState === 1;
}

export async function persistTelemetryRecord(record) {
  if (!telemetryConfig.enabled) {
    return null;
  }

  if (mongoose.connection.readyState !== 1) {
    warnStoreUnavailable("no MongoDB connection");
    return null;
  }

  try {
    return await TelemetryRecord.create(record);
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

export async function findTelemetryRecords(options = {}) {
  const limit = Math.min(
    Number(options.limit) || telemetryConfig.queryLimit,
    500,
  );

  return TelemetryRecord.find(buildTelemetryFilter(options))
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();
}

export async function findTelemetryRecordById(recordId) {
  return TelemetryRecord.findOne({ recordId }).lean();
}

export async function countTelemetryRecords(options = {}) {
  return TelemetryRecord.countDocuments(buildTelemetryFilter(options));
}
