import { Router } from "express";

import {
  retrieveChunksController,
} from "./retrieval.controller.js";

import asyncHandler from "../../middleware/asyncHandler.js";

const router = Router();

router.post(
  "/search",
  asyncHandler(retrieveChunksController)
);

export default router;