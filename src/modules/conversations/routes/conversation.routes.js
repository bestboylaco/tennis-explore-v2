import express from "express";

import asyncHandler from "../../../middleware/asyncHandler.js";
import {
  appendConversationMessageController,
  createConversationController,
  getConversationController,
  listConversationsController,
} from "../controllers/conversation.controller.js";

const router = express.Router();

router.get("/", asyncHandler(listConversationsController));
router.post("/", asyncHandler(createConversationController));
router.get("/:conversationId", asyncHandler(getConversationController));
router.post(
  "/:conversationId/messages",
  asyncHandler(appendConversationMessageController),
);

export default router;
