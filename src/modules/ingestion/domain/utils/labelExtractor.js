/**
 * Extracts a value from a labelled line.
 *
 * Supported examples:
 * - Tournament: Queensland Open
 * - **Tournament:** Queensland Open
 *
 * @param {string} text
 * @param {string} label
 * @returns {string|null}
 */
export function extractLabelValue(
  text,
  label
) {
  if (
    !text ||
    typeof text !== "string" ||
    !label ||
    typeof label !== "string"
  ) {
    return null;
  }

  const escapedLabel =
    escapeRegularExpression(label);

  const pattern = new RegExp(
    `^\\s*(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`,
    "im"
  );

  const match = text.match(pattern);

  return match
    ? cleanMarkdown(match[1])
    : null;
}

function cleanMarkdown(value) {
  return value
    .replace(/\*\*/g, "")
    .trim();
}

function escapeRegularExpression(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}