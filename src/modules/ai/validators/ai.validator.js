import {
  DEFAULT_AI_OPTIONS,
} from "../types/ai.types.js";

export function validateKnowledgeQuestionRequest(
  req,
  res,
  next
) {
  const {
    question,
    limit,
    temperature,
  } = req.body;

  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    return res.status(400).json({
      success: false,
      message:
        "A valid question is required.",
    });
  }

  const parsedLimit =
    limit === undefined
      ? DEFAULT_AI_OPTIONS.retrievalLimit
      : Number(limit);

  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 20
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Limit must be an integer between 1 and 20.",
    });
  }

  const parsedTemperature =
    temperature === undefined
      ? DEFAULT_AI_OPTIONS.temperature
      : Number(temperature);

  if (
    Number.isNaN(parsedTemperature) ||
    parsedTemperature < 0 ||
    parsedTemperature > 2
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Temperature must be between 0 and 2.",
    });
  }

  req.body.question =
    question.trim();

  req.body.limit =
    parsedLimit;

  req.body.temperature =
    parsedTemperature;

  next();
}