/**
 * Extracts player names from labelled fields and match-result phrases.
 *
 * Supported examples:
 * - **Player:** Emma Carter
 * - **Opponent:** Lucas Reed
 * - Emma Carter vs Lucas Reed
 * - Emma Carter defeated Lucas Reed
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractPlayers(text) {
  if (!text || typeof text !== "string") {
    return [];
  }

  const players = new Set();

  collectLabelledPlayer(
    text,
    "Player",
    players
  );

  collectLabelledPlayer(
    text,
    "Opponent",
    players
  );

  const versusPattern =
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:vs\.?|versus)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/gi;

  const resultPattern =
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:defeated|beat)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/gi;

  collectPlayerMatches(
    text,
    versusPattern,
    players
  );

  collectPlayerMatches(
    text,
    resultPattern,
    players
  );

  return [...players];
}

function collectLabelledPlayer(
  text,
  label,
  players
) {
  const pattern = new RegExp(
    `^\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`,
    "im"
  );

  const match = text.match(pattern);

  if (match?.[1]) {
    players.add(
      cleanMarkdown(match[1])
    );
  }
}

function collectPlayerMatches(
  text,
  pattern,
  players
) {
  let match;

  while ((match = pattern.exec(text)) !== null) {
    players.add(match[1].trim());
    players.add(match[2].trim());
  }
}

function cleanMarkdown(value) {
  return value
    .replace(/\*\*/g, "")
    .trim();
}