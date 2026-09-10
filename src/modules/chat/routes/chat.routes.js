import express from "express";

import asyncHandler from "../../../middleware/asyncHandler.js";

import {
    deliberatelyFailChatController,
    submitAgentChatQuestionController,
    submitChatQuestionController,
} from "../controllers/chat.controller.js";

import { validateChatQuestion } from "../validators/chat.validation.js";

const router = express.Router();

/**
 * POST /api/chat
 *
 * Request body:
 * {
 *   "question": "Natural-language coaching question"
 * }
 */
router.post(
    "/",
    validateChatQuestion,
    asyncHandler(submitChatQuestionController),
);


/**
 * POST /api/chat/v2
 *
 * New Agent-based intelligence pipeline.
 */
router.post(
    "/v2",
    validateChatQuestion,
    asyncHandler(
        submitAgentChatQuestionController,
    ),
);


/**
 * POST /api/chat/fail
 *
 * Used only to verify the frontend error state.
 */
router.post("/fail", deliberatelyFailChatController);

export default router;