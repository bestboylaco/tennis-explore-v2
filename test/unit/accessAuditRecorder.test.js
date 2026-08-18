// E5-19: the audit trail is the evidence that E5-17's access filter actually
// fired, not just that it exists. These tests are written the same way as
// accessControl.test.js -- proving the denial case is recorded, not just the
// happy path -- because a filter that works but is never logged is
// unreviewable, which is the whole point of an audit trail.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAccessAuditRecord } from "../../src/modules/audit/services/accessAuditRecorder.service.js";
import { AUDIT_OUTCOMES, AUDIT_QUERY_KINDS } from "../../src/shared/constants/audit.js";

describe("access audit record", () => {
  it("records a granted outcome with the documents that were shown", () => {
    const record = buildAccessAuditRecord({
      correlationId: "query:test-1",
      roleId: "analyst",
      queryKind: AUDIT_QUERY_KINDS.DOCUMENT,
      documents: [
        {
          docId: "paper#01",
          chunkId: "paper#01#p1",
          title: "A published study",
          sourceType: "research_paper",
          dataDomain: "research",
          sensitivity: "public",
          program: "*",
          citationNumber: 1,
        },
      ],
    });

    assert.equal(record.outcome, AUDIT_OUTCOMES.GRANTED);
    assert.equal(record.denialReason, null);
    assert.equal(record.documents.length, 1);
    assert.equal(record.documents[0].docId, "paper#01");
    assert.equal(record.roleId, "analyst");
    assert.equal(record.correlationId, "query:test-1");
    assert.ok(record.recordId, "a record id is generated");
  });

  it("records a denied outcome with no documents and a reason, never silently", () => {
    // this is the negative-proof case: a role that could not see anything
    // must still produce a row, otherwise "nothing happened" and "access was
    // refused" are indistinguishable in the log, and the audit trail cannot
    // prove the filter ran at all.
    const record = buildAccessAuditRecord({
      roleId: "analyst",
      queryKind: AUDIT_QUERY_KINDS.DOCUMENT,
      documents: [],
      denialReason: 'nothing in the knowledge base is both relevant and visible to the role "analyst"',
    });

    assert.equal(record.outcome, AUDIT_OUTCOMES.DENIED);
    assert.equal(record.documents.length, 0);
    assert.match(record.denialReason, /visible to the role "analyst"/);
  });

  it("drops the denial reason when the outcome is granted, so a stale reason cannot be misread as a refusal", () => {
    const record = buildAccessAuditRecord({
      roleId: "admin",
      queryKind: AUDIT_QUERY_KINDS.TABLE,
      documents: [{ docId: "match_results", title: "Match Results", sourceType: "table" }],
      denialReason: "should never surface",
    });

    assert.equal(record.outcome, AUDIT_OUTCOMES.GRANTED);
    assert.equal(record.denialReason, null);
  });

  it("never records raw chunk text -- only identifiers and classification tags", () => {
    const record = buildAccessAuditRecord({
      roleId: "athlete",
      queryKind: AUDIT_QUERY_KINDS.DOCUMENT,
      documents: [
        {
          docId: "notes#01",
          chunkId: "notes#01#p1",
          title: "Coach notes",
          text: "the athlete's resting heart rate is 47bpm",
          sourceType: "coach_notes",
        },
      ],
    });

    assert.equal(record.documents[0].text, undefined);
    assert.deepEqual(Object.keys(record.documents[0]).sort(), [
      "chunkId",
      "citationNumber",
      "dataDomain",
      "docId",
      "program",
      "sensitivity",
      "sourceType",
      "title",
    ]);
  });

  it("requires a roleId and a queryKind, refusing to build an unattributed record", () => {
    assert.throws(() => buildAccessAuditRecord({ queryKind: AUDIT_QUERY_KINDS.DOCUMENT, documents: [] }));
    assert.throws(() => buildAccessAuditRecord({ roleId: "admin", documents: [] }));
  });
});
