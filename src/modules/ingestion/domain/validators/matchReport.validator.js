/**
 * Validates deterministic match-report metadata.
 *
 * Validation checks whether extracted facts are internally consistent.
 * It does not extract new facts or generate coaching conclusions.
 *
 * @param {{
 *   documentType?: string|null,
 *   players?: string[],
 *   score?: string|null,
 *   winner?: string|null,
 *   tournament?: string|null,
 *   round?: string|null,
 *   matchDate?: string|null
 * }} metadata
 * @returns {{
 *   isValid: boolean,
 *   score: number,
 *   warnings: string[],
 *   errors: string[]
 * }}
 */
export function validateMatchReport(metadata) {
  const warnings = [];
  const errors = [];

  const players = Array.isArray(metadata?.players)
    ? metadata.players
    : [];

  validatePlayers(players, warnings, errors);
  validateWinner(metadata?.winner, players, warnings, errors);
  validateScore(metadata?.score, warnings, errors);
  validateOptionalFields(metadata, warnings);

  const validationScore = calculateValidationScore(
    warnings,
    errors
  );

  return {
    isValid: errors.length === 0,
    score: validationScore,
    warnings,
    errors,
  };
}

function validatePlayers(
  players,
  warnings,
  errors
) {
  if (players.length === 0) {
    errors.push("No players were extracted.");
    return;
  }

  if (players.length === 1) {
    warnings.push(
      "Only one player was extracted."
    );
    return;
  }

  if (players.length > 2) {
    warnings.push(
      "More than two players were extracted."
    );
  }

  const uniquePlayers = new Set(
    players.map((player) =>
      player.trim().toLowerCase()
    )
  );

  if (uniquePlayers.size !== players.length) {
    warnings.push(
      "Duplicate player names were extracted."
    );
  }
}

function validateWinner(
  winner,
  players,
  warnings,
  errors
) {
  if (!winner) {
    warnings.push(
      "A match winner was not extracted."
    );

    return;
  }

  const normalisedWinner = winner
    .trim()
    .toLowerCase();

  const normalisedPlayers = players.map(
    (player) =>
      player.trim().toLowerCase()
  );

  if (
    players.length > 0 &&
    !normalisedPlayers.includes(normalisedWinner)
  ) {
    errors.push(
      "The extracted winner is not one of the extracted players."
    );
  }
}

function validateScore(
  score,
  warnings,
  errors
) {
  if (!score) {
    warnings.push(
      "A match score was not extracted."
    );

    return;
  }

  const tennisScorePattern =
    /^(?:\d{1,2}-\d{1,2}(?:\(\d+\))?)(?:\s+\d{1,2}-\d{1,2}(?:\(\d+\))?){1,4}$/;

  if (!tennisScorePattern.test(score.trim())) {
    errors.push(
      "The extracted match score has an invalid format."
    );
  }
}

function validateOptionalFields(
  metadata,
  warnings
) {
  if (!metadata?.tournament) {
    warnings.push(
      "Tournament information was not extracted."
    );
  }

  if (!metadata?.round) {
    warnings.push(
      "Round information was not extracted."
    );
  }

  if (!metadata?.matchDate) {
    warnings.push(
      "Match date was not extracted."
    );
  }
}

function calculateValidationScore(
  warnings,
  errors
) {
  const warningPenalty = 5;
  const errorPenalty = 25;

  const score =
    100 -
    warnings.length * warningPenalty -
    errors.length * errorPenalty;

  return Math.max(0, score);
}