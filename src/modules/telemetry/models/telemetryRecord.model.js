import mongoose from "mongoose";

import {
  DEFAULT_QUERY_CLASS,
  PIPELINE_STAGE_NAMES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TELEMETRY_SCHEMA_VERSION,
} from "../../../shared/constants/telemetry.js";
import { telemetryConfig } from "../telemetry.config.js";

// One measured stage. The same shape is used by every stage, so adding a new
// measured stage means writing a new key into the stage map, never editing this
// file (E6-20a acceptance criteria).
const stageMetricSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      default: STAGE_STATUSES.NOT_IMPLEMENTED,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    durationMs: {
      type: Number,
      default: null,
    },

    attempts: {
      type: Number,
      default: 0,
    },

    // Which billed API this stage called, so latency and cost join on one key.
    apiType: {
      type: String,
      default: null,
    },

    apiCalls: {
      type: Number,
      default: 0,
    },

    itemsIn: {
      type: Number,
      default: 0,
    },

    itemsOut: {
      type: Number,
      default: 0,
    },

    tokensIn: {
      type: Number,
      default: 0,
    },

    tokensOut: {
      type: Number,
      default: 0,
    },

    // Set when this stage was the one that paid a cold start, so a stage
    // latency distribution can exclude it without dropping the whole record.
    coldStart: {
      type: Boolean,
      default: false,
    },

    errorCode: {
      type: String,
      default: null,
    },

    reason: {
      type: String,
      default: null,
    },

    attributes: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: () => new Map(),
    },
  },
  { _id: false },
);

// Volume for one API type within a run. Ingestion is billed per page (Textract),
// per token (embeddings) and per object (S3), so the split has to be stored,
// not derived later.
const apiUsageSchema = new mongoose.Schema(
  {
    apiCalls: { type: Number, default: 0 },
    documents: { type: Number, default: 0 },
    pages: { type: Number, default: 0 },
    assets: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    chunks: { type: Number, default: 0 },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
  },
  { _id: false },
);

const coldStartEventSchema = new mongoose.Schema(
  {
    resource: { type: String, required: true },
    stage: { type: String, default: null },
    detectedAt: { type: Date, default: Date.now },
    recoveryMs: { type: Number, default: null },
    thresholdMs: { type: Number, default: null },
  },
  { _id: false },
);

function createDefaultStages() {
  const stages = new Map();

  // Every record carries the four pipeline stages from day one. They read as
  // not_implemented until the stories that build them land, which keeps
  // "stage never ran" distinguishable from "stage does not exist yet".
  for (const stage of PIPELINE_STAGE_NAMES) {
    stages.set(stage, { status: STAGE_STATUSES.NOT_IMPLEMENTED });
  }

  return stages;
}

const telemetryRecordSchema = new mongoose.Schema(
  {
    schemaVersion: {
      type: Number,
      default: TELEMETRY_SCHEMA_VERSION,
    },

    recordId: {
      type: String,
      required: true,
      unique: true,
    },

    // Free string, not an enum: a new kind of measured run must not require a
    // schema change either.
    runType: {
      type: String,
      required: true,
    },

    // Ties records that belong to the same logical unit of work together.
    correlationId: {
      type: String,
      default: null,
    },

    queryClass: {
      type: String,
      default: DEFAULT_QUERY_CLASS,
    },

    status: {
      type: String,
      enum: Object.values(RUN_STATUSES),
      default: RUN_STATUSES.RUNNING,
    },

    environment: {
      type: String,
      default: "development",
    },

    serviceVersion: {
      type: String,
      default: null,
    },

    startedAt: {
      type: Date,
      required: true,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    totalDurationMs: {
      type: Number,
      default: null,
    },

    stages: {
      type: Map,
      of: stageMetricSchema,
      default: createDefaultStages,
    },

    ingestion: {
      sourceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Source",
        default: null,
      },
      sourceType: { type: String, default: null },
      documentCount: { type: Number, default: 0 },
      pageCount: { type: Number, default: 0 },
      assetCount: { type: Number, default: 0 },
      byteCount: { type: Number, default: 0 },
      chunkCount: { type: Number, default: 0 },
      byApi: {
        type: Map,
        of: apiUsageSchema,
        default: () => new Map(),
      },
    },

    coldStart: {
      detected: { type: Boolean, default: false },
      count: { type: Number, default: 0 },
      totalRecoveryMs: { type: Number, default: 0 },
      events: {
        type: [coldStartEventSchema],
        default: () => [],
      },
    },

    tokens: {
      input: { type: Number, default: 0 },
      output: { type: Number, default: 0 },
    },

    // Written by TENISE-27's cost calculation, which reads the volume fields
    // above and writes its result back onto the same record.
    cost: {
      estimatedUsd: { type: Number, default: null },
      currency: { type: String, default: "USD" },
      calculatedAt: { type: Date, default: null },
      breakdown: {
        type: Map,
        of: Number,
        default: () => new Map(),
      },
    },

    http: {
      method: { type: String, default: null },
      route: { type: String, default: null },
      statusCode: { type: Number, default: null },
    },

    // Codes and short messages only. Raw request bodies, document text and
    // query strings must never be written here (threat model T-04).
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null },
    },

    attributes: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: () => new Map(),
    },
  },
  {
    timestamps: true,
    collection: "telemetry_records",
    minimize: false,
  },
);

// Indexes for the aggregations TENISE-27 runs: latency over a time window,
// split by class, with cold starts separable.
telemetryRecordSchema.index({ runType: 1, startedAt: -1 });
telemetryRecordSchema.index({ queryClass: 1, startedAt: -1 });
telemetryRecordSchema.index({ "coldStart.detected": 1, startedAt: -1 });
telemetryRecordSchema.index({ correlationId: 1 });
telemetryRecordSchema.index({ "ingestion.sourceId": 1, startedAt: -1 });

// Retention. Telemetry is operational data with a useful life measured in
// weeks, and the api_request run type writes a record per request, so the
// collection has to expire or it grows without bound.
//
// MongoDB will not change expireAfterSeconds on an existing index: raising or
// lowering TELEMETRY_RETENTION_DAYS on a deployed database means dropping
// startedAt_1 first, otherwise index creation fails with IndexOptionsConflict
// and the old window silently stays in force.
telemetryRecordSchema.index(
  { startedAt: 1 },
  { expireAfterSeconds: telemetryConfig.retentionDays * 24 * 60 * 60 },
);

const TelemetryRecord =
  mongoose.models.TelemetryRecord ||
  mongoose.model("TelemetryRecord", telemetryRecordSchema);

export { createDefaultStages };

export default TelemetryRecord;
