import {
  runAgent,
} from "./agentOrchestrator.service.js";

import {
  randomUUID,
} from "node:crypto";


export async function askAgentController(
  req,
  res,
  next
) {
  try {
    const question =
      req.body?.question;


    if (
      typeof question !== "string" ||
      question.trim().length === 0
    ) {
      return res
        .status(400)
        .json({
          success: false,

          error: {
            message:
              "Question is required.",
          },
        });
    }


    const correlationId =
      `agent:${randomUUID()}`;

    req.telemetry?.setCorrelationId(
      correlationId
    );


    const result =
      await runAgent({
        question:
          question.trim(),

        context: {
          roleId:
            req.user.roleId,

          correlationId,
        },
      });


    return res
      .status(200)
      .json({
        success: true,

        data:
          result,
      });
  } catch (error) {
    next(error);
  }
}