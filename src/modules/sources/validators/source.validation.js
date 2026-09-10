import { SOURCE_TYPES } from "../../../shared/constants/sourceTypes.js";

export function validateCreateSource(req, res, next) {
  const {
    title,
    description,
    sourceType,
    storageType,
    storageBucket,
    storageKey,
  } = req.body;

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

  if (
    storageType !== undefined &&
    storageType !== null &&
    !["local", "s3"].includes(storageType)
  ) {
    errors.push({
      field: "storageType",
      message: "Storage type must be either local or s3.",
    });
  }

  if (storageType === "s3") {
    if (
      !storageBucket ||
      typeof storageBucket !== "string" ||
      storageBucket.trim() === ""
    ) {
      errors.push({
        field: "storageBucket",
        message: "Storage bucket is required for S3 sources.",
      });
    }

    if (
      !storageKey ||
      typeof storageKey !== "string" ||
      storageKey.trim() === ""
    ) {
      errors.push({
        field: "storageKey",
        message: "Storage key is required for S3 sources.",
      });
    }
  }

  if (
    storageType === "local" &&
    storageKey !== undefined &&
    typeof storageKey !== "string"
  ) {
    errors.push({
      field: "storageKey",
      message: "Storage key must be a string.",
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

  if (typeof storageType === "string") {
    req.body.storageType = storageType.trim();
  }

  if (typeof storageBucket === "string") {
    req.body.storageBucket = storageBucket.trim();
  }

  if (typeof storageKey === "string") {
    req.body.storageKey = storageKey.trim();
  }

  return next();
}