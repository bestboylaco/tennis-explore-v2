export { default as telemetryRoutes } from "./routes/telemetry.routes.js";
export {
  startTelemetryRun,
  withColdStartDetection,
} from "./services/telemetryRecorder.service.js";
export {
  findTelemetryRecords,
  findTelemetryRecordById,
  isTelemetryStoreReady,
  persistTelemetryRecord,
} from "./services/telemetryStore.service.js";
export {
  aggregateColdStarts,
  aggregateIngestionVolume,
  aggregateRunLatencyByQueryClass,
  aggregateStageCoverage,
  aggregateStageLatency,
  getTelemetrySummary,
} from "./services/telemetryAggregation.service.js";
export { telemetryConfig } from "./telemetry.config.js";
export { default as TelemetryRecord } from "./models/telemetryRecord.model.js";
