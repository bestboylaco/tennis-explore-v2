import express from "express";

import {
  askAgentController,
} from "./agent.controller.js";


const router =
  express.Router();


router.post(
  "/ask",
  askAgentController
);


export default router;