import express from "express";

import {
  getAccessAuditRecordsController,
  getDocumentsAccessedController,
} from "../controllers/audit.controller.js";
import asyncHandler from "../../../middleware/asyncHandler.js";

const router = express.Router();

// Access audit records are themselves Sensitive-adjacent (they say who saw
// what). Gated behind requireAuth + requireRole("admin") in app.js
// (threat model T-01) -- only the admin role can reach these routes.

router.get("/", asyncHandler(getAccessAuditRecordsController));

router.get("/documents-accessed", asyncHandler(getDocumentsAccessedController));

export default router;
