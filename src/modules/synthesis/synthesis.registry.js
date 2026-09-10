const synthesisStrategies = new Map();

function normalizeMode(mode) {
  if (
    typeof mode !== "string" ||
    !mode.trim()
  ) {
    throw new TypeError(
      "synthesis mode must be a non-empty string",
    );
  }

  return mode.trim();
}

function validateStrategy(strategy) {
  if (
    !strategy ||
    typeof strategy !== "object"
  ) {
    throw new TypeError(
      "synthesis strategy must be an object",
    );
  }

  if (
    typeof strategy.synthesize !== "function"
  ) {
    throw new TypeError(
      "synthesis strategy must provide a synthesize function",
    );
  }
}

export function registerSynthesisStrategy({
  mode,
  strategy,
  replace = false,
} = {}) {
  const normalizedMode =
    normalizeMode(mode);

  validateStrategy(strategy);

  if (
    synthesisStrategies.has(normalizedMode) &&
    !replace
  ) {
    throw new Error(
      `Synthesis strategy already registered: ${normalizedMode}`,
    );
  }

  synthesisStrategies.set(
    normalizedMode,
    Object.freeze({
      ...strategy,
      mode: normalizedMode,
    }),
  );

  return synthesisStrategies.get(
    normalizedMode,
  );
}

export function getSynthesisStrategy(mode) {
  const normalizedMode =
    normalizeMode(mode);

  return (
    synthesisStrategies.get(
      normalizedMode,
    ) ?? null
  );
}

export function hasSynthesisStrategy(mode) {
  const normalizedMode =
    normalizeMode(mode);

  return synthesisStrategies.has(
    normalizedMode,
  );
}

export function listSynthesisStrategies() {
  return Object.freeze(
    [...synthesisStrategies.keys()],
  );
}

export function clearSynthesisStrategies() {
  synthesisStrategies.clear();
}