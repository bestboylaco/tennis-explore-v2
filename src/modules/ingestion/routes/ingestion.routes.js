import {
  Router,
} from "express";

import {
  uploadMatchReportController,
} from "../controllers/upload.controller.js";

import {
  uploadSinglePdf,
} from "../middleware/uploadPdf.middleware.js";

const router =
  Router();

/*
 * POST /api/ingestion/upload
 *
 * requireAuth is applied in src/app.js before this router.
 */
router.post(
  "/upload",
  uploadSinglePdf,
  uploadMatchReportController,
);

export default router;