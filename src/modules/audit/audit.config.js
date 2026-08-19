import dotenv from "dotenv";

dotenv.config();

// Config is read separately from src/config/env.js on purpose, same reason as
// telemetry.config.js: a missing audit variable must never be the reason the
// process fails to start.

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

export const auditConfig = Object.freeze({
  enabled: readBoolean(process.env.AUDIT_ENABLED, true),

  // Deliberately NOT the telemetry default (30 days). E5-19's acceptance
  // criteria requires the retention period to be a documented choice, not
  // whatever the last collection happened to use.
  //
  // 400 days: long enough to cover a full academic/reporting year plus
  // margin (so "who accessed what last semester" survives a slow review
  // cycle), short enough that the collection does not grow without bound on
  // a free-tier cluster. Revisit once there is a real retention policy from
  // the partner (threat model T-07); until then this is the team's own
  // deliberate choice, not MongoDB's default.
  retentionDays: readInteger(process.env.AUDIT_RETENTION_DAYS, 400),

  queryLimit: readInteger(process.env.AUDIT_QUERY_LIMIT, 100),
});
