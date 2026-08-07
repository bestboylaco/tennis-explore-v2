import express from "express";

import {
  handleKnowledgeQuestion,
  handleKnowledgeQuestionStream,
} from "../controllers/ai.controller.js";

import {
  validateKnowledgeQuestionRequest,
} from "../validators/ai.validator.js";

const router =
  express.Router();

router.post(
  "/chat",
  validateKnowledgeQuestionRequest,
  handleKnowledgeQuestion
);

router.post(
  "/chat/stream",
  validateKnowledgeQuestionRequest,
  handleKnowledgeQuestionStream
);

export default router;