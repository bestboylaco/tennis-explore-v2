import {
  EMBEDDING_MODEL,
  OLLAMA_BASE_URL,
} from "./embedding.types.js";

/**
 * Generates embeddings using Ollama.
 *
 * Accepts either one string or multiple strings.
 *
 * @param {string|string[]} input
 * @param {Object} [options]
 * @param {string} [options.model]
 * @returns {Promise<{
 *   provider: string,
 *   model: string,
 *   vectors: number[][]
 * }>}
 */
export async function generateEmbeddings(
  input,
  {
    model = EMBEDDING_MODEL,
  } = {}
) {
  const inputs = Array.isArray(input)
    ? input
    : [input];

  if (inputs.length === 0) {
    throw new Error(
      "At least one embedding input is required."
    );
  }

  const hasInvalidInput = inputs.some(
    (value) =>
      typeof value !== "string" ||
      !value.trim()
  );

  if (hasInvalidInput) {
    throw new Error(
      "Every embedding input must be a non-empty string."
    );
  }

  let response;

  try {
    response = await fetch(
      `${OLLAMA_BASE_URL}/api/embed`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model,
          input: inputs,
          truncate: true,
        }),
      }
    );
  } catch (error) {
    throw new Error(
      `Unable to connect to Ollama at ${OLLAMA_BASE_URL}: ${error.message}`
    );
  }

  if (!response.ok) {
    const responseText =
      await response.text();

    throw new Error(
      `Ollama embedding request failed with status ${response.status}: ${responseText}`
    );
  }

  const data = await response.json();

  if (!Array.isArray(data.embeddings)) {
    throw new Error(
      "Ollama did not return an embeddings array."
    );
  }

  if (
    data.embeddings.length !== inputs.length
  ) {
    throw new Error(
      `Expected ${inputs.length} embeddings but received ${data.embeddings.length}.`
    );
  }

  return {
    provider: "ollama",
    model: data.model || model,
    vectors: data.embeddings,
  };
}