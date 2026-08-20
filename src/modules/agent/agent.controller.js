import {
  runAgent,
} from "./agentOrchestrator.service.js";


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


    const result =
      await runAgent({
        question:
          question.trim(),
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