import express from "express";

import {
  archiveSourceController,
  createSourceController,
  getAllSourcesController,
  getSourceByIdController,
  ingestSourceController,
} from "../controllers/source.controller.js";

import { validateCreateSource } from "../validators/source.validation.js";
import asyncHandler from "../../../middleware/asyncHandler.js";

const router = express.Router();

router.get("/", asyncHandler(getAllSourcesController));

router.get("/:sourceId", asyncHandler(getSourceByIdController));

router.post(
  "/",
  validateCreateSource,
  asyncHandler(createSourceController)
);

router.post(
  "/:sourceId/ingest",
  asyncHandler(ingestSourceController)
);

router.delete(
  "/:sourceId",
  asyncHandler(archiveSourceController)
);

export default router;