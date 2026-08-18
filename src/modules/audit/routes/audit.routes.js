import express from "express";

import {
  getAccessAuditRecordsController,
  getDocumentsAccessedController,
} from "../controllers/audit.controller.js";
import asyncHandler from "../../../middleware/asyncHandler.js";

const router = express.Router();

// Access audit records are themselves Sensitive-adjacent (they say who saw
// what) and these routes are unauthenticated today, like every other route
// (threat model T-01). They must go behind auth with the rest of the API,
// restricted to an administrator role, before any non-synthetic data is
// loaded (§7 Data Gate).

router.get("/", asyncHandler(getAccessAuditRecordsController));

router.get("/documents-accessed", asyncHandler(getDocumentsAccessedController));

export default router;
