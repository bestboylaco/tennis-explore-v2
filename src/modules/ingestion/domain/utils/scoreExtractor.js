/**
 * Extracts and normalises a tennis match score.
 *
 * Supported formats:
 * - **Score:** 6-4, 3-6, 6-3
 * - Score: 6-4 3-6 6-3
 * - 7-6(5), 6-4
 *
 * @param {string} text
 * @returns {string|null}
 */
export function extractScore(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const labelledScorePattern =
    /^\s*(?:\*\*)?Score(?:\*\*)?\s*:\s*(.*?)\s*$/im;

  const labelledMatch = text.match(
    labelledScorePattern
  );

  if (labelledMatch?.[1]) {
    const labelledScore = normaliseScore(
      labelledMatch[1]
    );

    if (isValidTennisScore(labelledScore)) {
      return labelledScore;
    }
  }

  const inlineScorePattern =
    /\b\d{1,2}-\d{1,2}(?:\(\d+\))?(?:(?:\s*,\s*|\s+)\d{1,2}-\d{1,2}(?:\(\d+\))?){1,4}\b/;

  const inlineMatch = text.match(
    inlineScorePattern
  );

  if (!inlineMatch) {
    return null;
  }

  const inlineScore = normaliseScore(
    inlineMatch[0]
  );

  return isValidTennisScore(inlineScore)
    ? inlineScore
    : null;
}

function normaliseScore(score) {
  return score
    .replace(/\*\*/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s*,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidTennisScore(score) {
  const tennisScorePattern =
    /^(?:\d{1,2}-\d{1,2}(?:\(\d+\))?)(?:\s+\d{1,2}-\d{1,2}(?:\(\d+\))?){1,4}$/;

  return tennisScorePattern.test(score);
}