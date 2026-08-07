/**
 * Validates a generated chunk before it is added to the pipeline.
 *
 * @param {Object} chunk
 * @param {number} minimumCharacters
 * @returns {{
 *   isValid: boolean,
 *   warnings: string[],
 *   errors: string[]
 * }}
 */
export function validateChunk(
  chunk,
  minimumCharacters = 80
) {
  const warnings = [];
  const errors = [];

  if (!chunk) {
    errors.push("Chunk is required.");

    return {
      isValid: false,
      warnings,
      errors,
    };
  }

  if (typeof chunk.text !== "string") {
    errors.push("Chunk text must be a string.");
  }

  const cleanedText =
    typeof chunk.text === "string"
      ? chunk.text.trim()
      : "";

  if (!cleanedText) {
    errors.push("Chunk text cannot be empty.");
  }

  if (
    cleanedText.length > 0 &&
    cleanedText.length < minimumCharacters
  ) {
    warnings.push(
      `Chunk contains fewer than ${minimumCharacters} characters.`
    );
  }

  if (!Number.isInteger(chunk.index)) {
    errors.push("Chunk index must be an integer.");
  }

  if (!chunk.id) {
    errors.push("Chunk ID is required.");
  }

  if (!chunk.metadata?.sourceId) {
    errors.push(
      "Chunk metadata must contain a source ID."
    );
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}