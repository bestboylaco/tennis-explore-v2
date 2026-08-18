import { randomUUID } from "node:crypto";

import { AUDIT_OUTCOMES } from "../../../shared/constants/audit.js";
import { persistAccessAuditRecord } from "./accessAuditStore.service.js";

/**
 * Pure shaping step, kept separate from the write so it can be tested without
 * a database -- same split as accessControl.js's grantsForRole/isPermitted.
 */
export function buildAccessAuditRecord({
  correlationId = null,
  roleId,
  queryKind,
  documents = [],
  denialReason = null,
}) {
  if (!roleId) {
    throw new Error("buildAccessAuditRecord requires a roleId.");
  }

  if (!queryKind) {
    throw new Error("buildAccessAuditRecord requires a queryKind.");
  }

  const outcome = documents.length > 0 ? AUDIT_OUTCOMES.GRANTED : AUDIT_OUTCOMES.DENIED;

  return {
    recordId: randomUUID(),
    correlationId,
    roleId,
    queryKind,
    outcome,
    denialReason: outcome === AUDIT_OUTCOMES.DENIED ? denialReason : null,
    documents: documents.map((doc, position) => ({
      docId: doc.docId ?? null,
      chunkId: doc.chunkId ?? null,
      title: doc.title ?? null,
      sourceType: doc.sourceType ?? null,
      dataDomain: doc.dataDomain ?? null,
      sensitivity: doc.sensitivity ?? null,
      program: doc.program ?? null,
      citationNumber: doc.citationNumber ?? position + 1,
    })),
  };
}

/**
 * Writes one audit row per document/chunk a role was actually shown for one
 * request. Call this with the evidence set as it stands right before it is
 * handed to the model -- after grading and access filtering, not the raw
 * retrieval hit list -- so the log matches what the model could see, which is
 * the thing E5-19's acceptance criterion needs proof of.
 *
 * Best effort, like telemetry: persistAccessAuditRecord never throws, so a
 * logging failure cannot fail the answer it is describing.
 */
export async function recordAccess(options) {
  return persistAccessAuditRecord(buildAccessAuditRecord(options));
}

/**
 * Convenience wrapper for a request that returned nothing because the role
 * could not see the matching material -- there is no document list to build,
 * but the refusal itself is the auditable event (it is the proof T-01/T-02's
 * mitigation fired rather than merely existing).
 */
export async function recordAccessDenial({ correlationId = null, roleId, queryKind, reason }) {
  return recordAccess({ correlationId, roleId, queryKind, documents: [], denialReason: reason });
}
