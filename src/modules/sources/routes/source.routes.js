import express from "express";

import {
  archiveSourceController,
  createSourceController,
  getAllSourcesController,
  getSourceByIdController,
  ingestSourceController,
  uploadSourceFileController,
} from "../controllers/source.controller.js";

import upload from "../../../middleware/upload.middleware.js";
import { validateCreateSource } from "../validators/source.validation.js";
import asyncHandler from "../../../middleware/asyncHandler.js";

const router = express.Router();

router.get(
  "/",
  asyncHandler(getAllSourcesController)
);

router.post(
  "/",
  validateCreateSource,
  asyncHandler(createSourceController)
);

router.post(
  "/:sourceId/upload",
  upload.single("file"),
  asyncHandler(uploadSourceFileController)
);

router.post(
  "/:sourceId/ingest",
  asyncHandler(ingestSourceController)
);

router.get(
  "/:sourceId",
  asyncHandler(getSourceByIdController)
);

router.delete(
  "/:sourceId",
  asyncHandler(archiveSourceController)
);

export default router;