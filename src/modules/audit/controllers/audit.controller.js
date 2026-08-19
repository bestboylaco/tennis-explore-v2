import {
  countAccessAuditRecords,
  findAccessAuditRecords,
  reconstructDocumentsAccessed,
} from "../services/accessAuditStore.service.js";

function readQueryOptions(query) {
  return {
    roleId: query.roleId,
    docId: query.docId,
    correlationId: query.correlationId,
    outcome: query.outcome,
    from: query.from,
    to: query.to,
    limit: query.limit,
  };
}

export async function getAccessAuditRecordsController(req, res) {
  const options = readQueryOptions(req.query);

  const [records, total] = await Promise.all([
    findAccessAuditRecords(options),
    countAccessAuditRecords(options),
  ]);

  return res.status(200).json({
    success: true,
    data: records,
    meta: { count: records.length, total },
  });
}

// The endpoint E5-19's acceptance criterion actually asks for: given a role
// and a time window, which documents did it see.
export async function getDocumentsAccessedController(req, res) {
  if (!req.query.roleId) {
    return res.status(400).json({
      success: false,
      error: {
        code: "ROLE_ID_REQUIRED",
        message: "roleId is required to reconstruct document access.",
      },
    });
  }

  const documents = await reconstructDocumentsAccessed({
    roleId: req.query.roleId,
    from: req.query.from,
    to: req.query.to,
  });

  return res.status(200).json({
    success: true,
    data: documents,
    meta: { count: documents.length },
  });
}
