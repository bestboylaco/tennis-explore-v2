import express from "express";

import {
  getTelemetryRecordController,
  getTelemetryRecordsController,
  getTelemetrySummaryController,
} from "../controllers/telemetry.controller.js";
import asyncHandler from "../../../middleware/asyncHandler.js";

const router = express.Router();

// Telemetry is Internal-classified data and these routes are unauthenticated,
// like every other route today (threat model T-01). They must go behind auth
// with the rest of the API in E5-17.

router.get("/", asyncHandler(getTelemetryRecordsController));

router.get("/summary", asyncHandler(getTelemetrySummaryController));

router.get("/:recordId", asyncHandler(getTelemetryRecordController));

export default router;
