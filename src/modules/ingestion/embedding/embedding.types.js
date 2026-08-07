/**
 * Canonical embedding attached to one chunk.
 *
 * @typedef {Object} ChunkEmbedding
 * @property {number[]} vector
 * @property {number} dimensions
 * @property {string} provider
 * @property {string} model
 * @property {Date|string} generatedAt
 */

/**
 * Summary of the embedding stage.
 *
 * @typedef {Object} EmbeddingSummary
 * @property {Date|string|null} completedAt
 * @property {string} provider
 * @property {string} model
 * @property {number|null} dimensions
 * @property {number} totalRequested
 * @property {number} totalEmbedded
 * @property {number} totalFailed
 * @property {Object[]} failures
 */

/**
 * Supported embedding providers.
 */
export const EMBEDDING_PROVIDERS = Object.freeze({
  OLLAMA: "ollama",
});

/**
 * Default provider configuration.
 */
export const EMBEDDING_PROVIDER =
  process.env.EMBEDDING_PROVIDER ||
  EMBEDDING_PROVIDERS.OLLAMA;

/**
 * Default embedding model.
 */
export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ||
  "nomic-embed-text";

/**
 * Ollama local API URL.
 */
export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ||
  "http://localhost:11434";