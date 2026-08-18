// Access audit trail (E5-19, local-stack equivalent of AWS CloudTrail for
// Bedrock/OpenSearch -- see docs/data-threat-model-and-classification.md §8
// for why CloudTrail itself is not available: no AWS account access).
//
// This is a record of WHICH DOCUMENTS a role was shown and WHEN, kept
// separate from the telemetry collection on purpose: telemetry is
// operational/debugging data with a short useful life (30 days by default),
// audit is a compliance trail that has to outlive that and must never be
// bulk-deleted just because a dashboard doesn't need it anymore.

export const AUDIT_SCHEMA_VERSION = 1;

// Mirrors the two route outcomes in answer.service.js: a question is either
// answered from retrieved documents or from a structured table.
export const AUDIT_QUERY_KINDS = Object.freeze({
  DOCUMENT: "document",
  TABLE: "table",
});

// Why an access was (or was not) granted, for the case where the request was
// refused specifically because the role could not see the matching material
// -- this is the record that proves T-01/T-02 mitigations actually fire, not
// just that they exist in code.
export const AUDIT_OUTCOMES = Object.freeze({
  GRANTED: "granted",
  DENIED: "denied",
});
