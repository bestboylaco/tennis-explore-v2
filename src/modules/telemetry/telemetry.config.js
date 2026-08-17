import dotenv from "dotenv";

import {
  DEFAULT_COLD_START_THRESHOLD_MS,
  COLD_START_THRESHOLDS_MS,
  DEFAULT_OCU_RATE,
  DEFAULT_OCU_RATES,
  OCU_BASES,
} from "../../shared/constants/telemetry.js";

dotenv.config();

// Telemetry config is read separately from src/config/env.js on purpose: env.js
// throws on missing required variables, and telemetry must never be the reason
// a process fails to start. Every value here has a working default.

function readBoolean(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return value !== "false" && value !== "0";
}

function readInteger(value, fallback) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// OCU rates are fractional (a resource can hold half an OCU), so readInteger
// would reject every realistic value.
function readNumber(value, fallback) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const defaultColdStartThresholdMs = readInteger(
  process.env.TELEMETRY_COLD_START_THRESHOLD_MS,
  DEFAULT_COLD_START_THRESHOLD_MS,
);

export const telemetryConfig = Object.freeze({
  enabled: readBoolean(process.env.TELEMETRY_ENABLED, true),
  httpEnabled: readBoolean(process.env.TELEMETRY_HTTP_ENABLED, true),
  environment: process.env.NODE_ENV || "development",
  serviceVersion: process.env.SERVICE_VERSION || "sprint-1",
  defaultColdStartThresholdMs,
  queryLimit: readInteger(process.env.TELEMETRY_QUERY_LIMIT, 100),

  // One record per HTTP request with no expiry fills a free tier cluster.
  // Records older than this are removed by a TTL index; see the note on that
  // index before changing the value on a deployed database.
  retentionDays: readInteger(process.env.TELEMETRY_RETENTION_DAYS, 30),

  // Stamped onto every record's compute block so a reader can tell a measured
  // estimate from a figure taken off an invoice. Only "billing" is a claim
  // about money; anything else is this project's own arithmetic.
  ocuBasis:
    process.env.TELEMETRY_OCU_BASIS === OCU_BASES.BILLING
      ? OCU_BASES.BILLING
      : OCU_BASES.ESTIMATED,
});

export function getColdStartThresholdMs(resource) {
  return (
    COLD_START_THRESHOLDS_MS[resource] || telemetryConfig.defaultColdStartThresholdMs
  );
}

// OCU-equivalents held by a resource, overridable per resource with
// TELEMETRY_OCU_<RESOURCE>, e.g. TELEMETRY_OCU_OPENSEARCH=4.
//
// Read on every call rather than frozen into telemetryConfig above: the set of
// resources is open (COMPUTE_RESOURCES is a convention, not an enum), so there
// is no fixed list to build the object from at import time.
export function getOcuRate(resource) {
  if (!resource) {
    return DEFAULT_OCU_RATE;
  }

  const envKey = `TELEMETRY_OCU_${String(resource).toUpperCase()}`;

  return readNumber(
    process.env[envKey],
    DEFAULT_OCU_RATES[resource] ?? DEFAULT_OCU_RATE,
  );
}
