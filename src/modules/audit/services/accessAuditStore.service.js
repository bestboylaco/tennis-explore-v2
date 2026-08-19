import mongoose from "mongoose";

import AccessAuditRecord from "../models/accessAuditRecord.model.js";
import { auditConfig } from "../audit.config.js";

// Same rule as telemetry: an audit write must never fail the request it is
// describing. Losing one row to a transient Mongo blip is recoverable; a
// user-facing 500 caused by the logging system is not.

let storeUnavailableWarned = false;

function warnStoreUnavailable(reason) {
  if (storeUnavailableWarned) {
    return;
  }

  storeUnavailableWarned = true;
  console.warn(`Access audit not persisted: ${reason}. Further warnings suppressed.`);
}

export function isAuditStoreReady() {
  return auditConfig.enabled && mongoose.connection.readyState === 1;
}

export async function persistAccessAuditRecord(record) {
  if (!auditConfig.enabled) {
    return null;
  }

  if (mongoose.connection.readyState !== 1) {
    warnStoreUnavailable("no MongoDB connection");
    return null;
  }

  try {
    return await AccessAuditRecord.create(record);
  } catch (error) {
    console.warn(`Access audit write failed (${record.recordId}):`, error.message);
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

  return Object.keys(range).length > 0 ? { accessedAt: range } : {};
}

export function buildAccessAuditFilter({
  roleId,
  docId,
  correlationId,
  outcome,
  from,
  to,
} = {}) {
  const filter = { ...buildTimeRangeFilter({ from, to }) };

  if (roleId) {
    filter.roleId = roleId;
  }

  if (docId) {
    filter["documents.docId"] = docId;
  }

  if (correlationId) {
    filter.correlationId = correlationId;
  }

  if (outcome) {
    filter.outcome = outcome;
  }

  return filter;
}

export async function findAccessAuditRecords(options = {}) {
  const limit = Math.min(Number(options.limit) || auditConfig.queryLimit, 500);

  return AccessAuditRecord.find(buildAccessAuditFilter(options))
    .sort({ accessedAt: -1 })
    .limit(limit)
    .lean();
}

export async function countAccessAuditRecords(options = {}) {
  return AccessAuditRecord.countDocuments(buildAccessAuditFilter(options));
}

/**
 * Reconstructs the distinct set of documents a role was shown in a time
 * window -- the exact shape E5-19's acceptance criterion asks for ("given a
 * user and a time window, the documents they accessed can be reconstructed
 * from the logs").
 */
export async function reconstructDocumentsAccessed({ roleId, from, to } = {}) {
  if (!roleId) {
    throw new Error("reconstructDocumentsAccessed requires a roleId.");
  }

  const records = await AccessAuditRecord.find({
    ...buildAccessAuditFilter({ roleId, from, to, outcome: "granted" }),
  })
    .select("documents accessedAt correlationId")
    .sort({ accessedAt: -1 })
    .lean();

  const byDocId = new Map();

  for (const record of records) {
    for (const doc of record.documents) {
      if (!doc.docId) continue;

      const existing = byDocId.get(doc.docId);
      const seenAt = record.accessedAt;

      if (!existing || seenAt > existing.lastAccessedAt) {
        byDocId.set(doc.docId, {
          docId: doc.docId,
          title: doc.title,
          sourceType: doc.sourceType,
          sensitivity: doc.sensitivity,
          lastAccessedAt: seenAt,
          lastCorrelationId: record.correlationId,
        });
      }
    }
  }

  return [...byDocId.values()].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
}
