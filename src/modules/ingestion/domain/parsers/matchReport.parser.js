import { extractPlayers } from "../utils/playerExtractor.js";
import { extractScore } from "../utils/scoreExtractor.js";
import { extractWinner } from "../utils/winnerExtractor.js";
import { extractLabelValue } from "../utils/labelExtractor.js";

/**
 * Extracts deterministic match-report metadata.
 *
 * This parser only coordinates factual extraction.
 * It does not generate coaching insights or AI conclusions.
 *
 * @param {string} text
 * @returns {{
 *   documentType: "match_report",
 *   players: string[],
 *   score: string|null,
 *   winner: string|null,
 *   tournament: string|null,
 *   round: string|null,
 *   matchDate: string|null
 * }}
 */
export function parseMatchReport(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Match report text is required.");
  }

  const players = extractPlayers(text);

  return {
    documentType: "match_report",
    players,
    score: extractScore(text),
    winner: extractWinner(text, players),
    tournament: extractLabelValue(text, "Tournament"),
    round: extractLabelValue(text, "Round"),
    matchDate: extractLabelValue(text, "Date"),
  };
}