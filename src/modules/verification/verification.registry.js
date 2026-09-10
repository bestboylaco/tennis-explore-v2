const verificationStrategies = new Map();

function normalizeId(id) {
  if (
    typeof id !== "string" ||
    !id.trim()
  ) {
    throw new TypeError(
      "verification strategy id must be a non-empty string",
    );
  }

  return id.trim();
}

function validateStrategy(strategy) {
  if (
    !strategy ||
    typeof strategy !== "object"
  ) {
    throw new TypeError(
      "verification strategy must be an object",
    );
  }

  if (
    typeof strategy.verify !== "function"
  ) {
    throw new TypeError(
      "verification strategy must provide a verify function",
    );
  }
}

export function registerVerificationStrategy({
  id,
  strategy,
  replace = false,
} = {}) {
  const normalizedId =
    normalizeId(id);

  validateStrategy(strategy);

  if (
    verificationStrategies.has(normalizedId) &&
    !replace
  ) {
    throw new Error(
      `Verification strategy already registered: ${normalizedId}`,
    );
  }

  verificationStrategies.set(
    normalizedId,
    Object.freeze({
      ...strategy,
      id: normalizedId,
    }),
  );

  return verificationStrategies.get(
    normalizedId,
  );
}

export function getVerificationStrategy(id) {
  const normalizedId =
    normalizeId(id);

  return (
    verificationStrategies.get(
      normalizedId,
    ) ?? null
  );
}

export function hasVerificationStrategy(id) {
  return verificationStrategies.has(
    normalizeId(id),
  );
}

export function listVerificationStrategies() {
  return Object.freeze(
    [...verificationStrategies.keys()],
  );
}

export function clearVerificationStrategies() {
  verificationStrategies.clear();
}