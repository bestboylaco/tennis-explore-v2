import express from "express";

import asyncHandler from
    "../../../middleware/asyncHandler.js";

import {
    getQuickQuestionsController,
    updateQuickQuestionsController,
} from "../controllers/quickQuestion.controller.js";

const router = express.Router();

/**
 * GET /api/quickquestions
 *
 * Returns the authenticated user's Quick Questions.
 */
router.get(
    "/",
    asyncHandler(
        getQuickQuestionsController,
    ),
);

/**
 * PUT /api/quickquestions
 *
 * Replaces the authenticated user's Quick Questions.
 */
router.put(
    "/",
    asyncHandler(
        updateQuickQuestionsController,
    ),
);

export default router;