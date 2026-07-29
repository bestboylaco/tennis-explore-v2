import dotenv from "dotenv";

import {
  DEFAULT_COLD_START_THRESHOLD_MS,
  COLD_START_THRESHOLDS_MS,
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
});

export function getColdStartThresholdMs(resource) {
  return (
    COLD_START_THRESHOLDS_MS[resource] || telemetryConfig.defaultColdStartThresholdMs
  );
}
