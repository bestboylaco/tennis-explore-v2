import mongoose from "mongoose";

import { AUDIT_SCHEMA_VERSION } from "../../../shared/constants/audit.js";
import { auditConfig } from "../audit.config.js";

// One row per document/chunk a role was shown in one query. A query that
// surfaces five chunks writes five rows, not one row with an array, so
// "which documents did role X see in window Y" (E5-19 acceptance criterion)
// is a plain query rather than an unwind on every read.
//
// Only identifiers and classification tags are stored here -- never chunk
// text, never the question, never the generated answer. Same rule as
// telemetry (threat model T-04): this collection answers "what was
// accessed", not "what was said".
const accessAuditRecordSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: AUDIT_SCHEMA_VERSION },
    recordId: { type: String, required: true, unique: true },

    // Joins back to the telemetry query record for the same request, so a
    // reviewer can go from "this document was accessed" to the full
    // routing/retrieval/generation trace without a second logging system.
    correlationId: { type: String, default: null },

    // Identity proxy until real per-user auth lands (E5-17 note: "in
    // production this would additionally be filtered to athlete_id ==
    // self"). Every access is attributable to a role today, not yet to an
    // individual account.
    roleId: { type: String, required: true },

    queryKind: { type: String, required: true },
    outcome: { type: String, required: true },

    // Present only for a denied outcome -- why nothing was returned, e.g.
    // "no tables are visible to the role X".
    denialReason: { type: String, default: null },

    documents: {
      type: [
        {
          _id: false,
          docId: { type: String, default: null },
          chunkId: { type: String, default: null },
          title: { type: String, default: null },
          sourceType: { type: String, default: null },
          dataDomain: { type: String, default: null },
          sensitivity: { type: String, default: null },
          program: { type: String, default: null },
          citationNumber: { type: Number, default: null },
        },
      ],
      default: [],
    },

    accessedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "access_audit_records",
    minimize: false,
  },
);

// The two questions E5-19 has to answer: "what did this role see" over a
// window, and "what happened on this request" by correlation id.
accessAuditRecordSchema.index({ roleId: 1, accessedAt: -1 });
accessAuditRecordSchema.index({ "documents.docId": 1, accessedAt: -1 });
accessAuditRecordSchema.index({ correlationId: 1 });

// Retention is deliberate, not MongoDB's default -- see audit.config.js for
// why 400 days. Same IndexOptionsConflict caveat as telemetry applies: raise
// or lower AUDIT_RETENTION_DAYS on a deployed database only after dropping
// accessedAt_1 first.
accessAuditRecordSchema.index(
  { accessedAt: 1 },
  { expireAfterSeconds: auditConfig.retentionDays * 24 * 60 * 60 },
);

const AccessAuditRecord =
  mongoose.models.AccessAuditRecord ||
  mongoose.model("AccessAuditRecord", accessAuditRecordSchema);

export default AccessAuditRecord;
