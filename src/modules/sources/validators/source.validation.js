import { SOURCE_TYPES } from "../../../shared/constants/sourceTypes.js";

export function validateCreateSource(req, res, next) {
  const { title, description, sourceType } = req.body;

  const errors = [];

  if (!title || typeof title !== "string" || title.trim() === "") {
    errors.push({
      field: "title",
      message: "Title is required and must be a non-empty string.",
    });
  }

  if (
    description !== undefined &&
    typeof description !== "string"
  ) {
    errors.push({
      field: "description",
      message: "Description must be a string.",
    });
  }

  if (!sourceType) {
    errors.push({
      field: "sourceType",
      message: "Source type is required.",
    });
  } else if (!SOURCE_TYPES.includes(sourceType)) {
    errors.push({
      field: "sourceType",
      message: `Source type must be one of: ${SOURCE_TYPES.join(", ")}.`,
    });
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "The request contains invalid source data.",
        details: errors,
      },
    });
  }

  req.body.title = title.trim();

  if (typeof description === "string") {
    req.body.description = description.trim();
  }

  return next();
}