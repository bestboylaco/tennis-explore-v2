import {
  getSynthesisStrategy,
} from "./synthesis.registry.js";

import {
  createSynthesisResult,
} from "./synthesis.types.js";

export async function synthesize({
  mode,
  input,
  context = {},
  signal = null,
} = {}) {
  if (
    typeof mode !== "string" ||
    !mode.trim()
  ) {
    throw new TypeError(
      "mode must be a non-empty string",
    );
  }

  const strategy =
    getSynthesisStrategy(mode);

  if (!strategy) {
    throw new Error(
      `No synthesis strategy registered for mode: ${mode}`,
    );
  }

  const result =
    await strategy.synthesize({
      input,
      context,
      signal,
    });

  if (
    !result ||
    typeof result !== "object"
  ) {
    throw new TypeError(
      `Synthesis strategy "${mode}" returned an invalid result`,
    );
  }

  return createSynthesisResult({
    answered: result.answered,
    mode: result.mode ?? mode,
    answer: result.answer ?? null,
    citations: result.citations ?? [],
    data: result.data ?? null,
    metadata: result.metadata ?? {},
  });
}