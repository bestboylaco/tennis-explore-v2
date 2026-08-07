import path from "path";
import crypto from "crypto";

/**
 * Generate a unique storage key for S3.
 *
 * @param {Object} options
 * @param {string} options.sourceType
 * @param {string} options.originalFilename
 *
 * @returns {string}
 */
export function generateStorageKey({
  sourceType,
  originalFilename,
} = {}) {
  if (
    typeof sourceType !== "string" ||
    sourceType.trim().length === 0
  ) {
    throw new TypeError(
      "A valid source type is required."
    );
  }

  if (
    typeof originalFilename !== "string" ||
    originalFilename.trim().length === 0
  ) {
    throw new TypeError(
      "A valid original filename is required."
    );
  }

  const extension =
    path.extname(originalFilename);

  const uniqueId =
    crypto.randomUUID();

  const year =
    new Date().getFullYear();

  return [
    sourceType.trim(),
    year,
    `${uniqueId}${extension}`,
  ].join("/");
}