import express from "express";

import asyncHandler from "../../../middleware/asyncHandler.js";
import {
  getCurrentUserController,
  loginController,
  logoutController,
} from "../controllers/auth.controller.js";

const router = express.Router();

router.post("/login", asyncHandler(loginController));
router.post("/logout", asyncHandler(logoutController));
router.get("/me", getCurrentUserController);

export default router;
