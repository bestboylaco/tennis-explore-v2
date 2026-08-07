/**
 * Extracts the winner from direct result statements
 * or labelled match-result fields.
 *
 * @param {string} text
 * @param {string[]} players
 * @returns {string|null}
 */
export function extractWinner(
  text,
  players = []
) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const directWinnerPattern =
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:defeated|beat)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/i;

  const directWinnerMatch =
    text.match(directWinnerPattern);

  if (directWinnerMatch) {
    return directWinnerMatch[1].trim();
  }

  const player = extractLabelValue(
    text,
    "Player"
  );

  const opponent = extractLabelValue(
    text,
    "Opponent"
  );

  const matchResult = extractLabelValue(
    text,
    "Match Result"
  );

  if (!matchResult) {
    return null;
  }

  const normalisedResult =
    matchResult.toLowerCase();

  if (
    normalisedResult === "win" ||
    normalisedResult === "won" ||
    normalisedResult === "victory"
  ) {
    return player;
  }

  if (
    normalisedResult === "loss" ||
    normalisedResult === "lost" ||
    normalisedResult === "defeat"
  ) {
    return opponent;
  }

  return players.length === 1
    ? players[0]
    : null;
}

function extractLabelValue(
  text,
  label
) {
  const escapedLabel =
    escapeRegularExpression(label);

  const pattern = new RegExp(
    `^\\s*(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`,
    "im"
  );

  const match = text.match(pattern);

  return match
    ? match[1].replace(/\*\*/g, "").trim()
    : null;
}

function escapeRegularExpression(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}