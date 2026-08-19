import express from "express";

import {
  getTelemetryRecordController,
  getTelemetryRecordsController,
  getTelemetrySummaryController,
} from "../controllers/telemetry.controller.js";
import asyncHandler from "../../../middleware/asyncHandler.js";

const router = express.Router();

// Telemetry is Internal-classified data. Gated behind requireAuth in app.js
// (E5-17, threat model T-01) -- not a role-specific restriction, any signed-in
// account can read it, but an anonymous caller can no longer reach it.

router.get("/", asyncHandler(getTelemetryRecordsController));

router.get("/summary", asyncHandler(getTelemetrySummaryController));

router.get("/:recordId", asyncHandler(getTelemetryRecordController));

export default router;
