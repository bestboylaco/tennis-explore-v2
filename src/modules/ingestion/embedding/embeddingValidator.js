/**
 * Validates an embedding vector.
 *
 * @param {unknown} vector
 * @param {number|null} expectedDimensions
 * @returns {{
 *   isValid: boolean,
 *   dimensions: number,
 *   warnings: string[],
 *   errors: string[]
 * }}
 */
export function validateEmbedding(
  vector,
  expectedDimensions = null
) {
  const warnings = [];
  const errors = [];

  // Must be an array
  if (!Array.isArray(vector)) {
    errors.push(
      "Embedding vector must be an array."
    );

    return {
      isValid: false,
      dimensions: 0,
      warnings,
      errors,
    };
  }

  // Cannot be empty
  if (vector.length === 0) {
    errors.push(
      "Embedding vector cannot be empty."
    );
  }

  // Every value must be a finite number
  const containsInvalidValue = vector.some(
    (value) =>
      typeof value !== "number" ||
      !Number.isFinite(value)
  );

  if (containsInvalidValue) {
    errors.push(
      "Embedding vector must contain only finite numbers."
    );
  }

  // Check dimensions if known
  if (
    expectedDimensions !== null &&
    vector.length !== expectedDimensions
  ) {
    errors.push(
      `Expected ${expectedDimensions} dimensions but received ${vector.length}.`
    );
  }

  // Warn if vector is all zeros
  const isZeroVector =
    vector.length > 0 &&
    vector.every((value) => value === 0);

  if (isZeroVector) {
    warnings.push(
      "Embedding vector contains only zero values."
    );
  }

  return {
    isValid: errors.length === 0,
    dimensions: vector.length,
    warnings,
    errors,
  };
}