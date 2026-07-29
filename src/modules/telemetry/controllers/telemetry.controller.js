import {
  findTelemetryRecordById,
  findTelemetryRecords,
  countTelemetryRecords,
} from "../services/telemetryStore.service.js";
import { getTelemetrySummary } from "../services/telemetryAggregation.service.js";

function readQueryOptions(query) {
  return {
    runType: query.runType,
    queryClass: query.queryClass,
    status: query.status,
    correlationId: query.correlationId,
    sourceId: query.sourceId,
    from: query.from,
    to: query.to,
    limit: query.limit,
    coldStart:
      query.coldStart === undefined ? undefined : query.coldStart === "true",
  };
}

export async function getTelemetryRecordsController(req, res) {
  const options = readQueryOptions(req.query);

  const [records, total] = await Promise.all([
    findTelemetryRecords(options),
    countTelemetryRecords(options),
  ]);

  return res.status(200).json({
    success: true,
    data: records,
    meta: {
      count: records.length,
      total,
    },
  });
}

export async function getTelemetryRecordController(req, res) {
  const record = await findTelemetryRecordById(req.params.recordId);

  if (!record) {
    return res.status(404).json({
      success: false,
      error: {
        code: "TELEMETRY_RECORD_NOT_FOUND",
        message: "Telemetry record not found.",
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: record,
  });
}

export async function getTelemetrySummaryController(req, res) {
  const summary = await getTelemetrySummary(readQueryOptions(req.query));

  return res.status(200).json({
    success: true,
    data: summary,
  });
}
