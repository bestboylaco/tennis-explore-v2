/**
 * Builds the text that will be sent to the embedding model.
 *
 * Instead of embedding only the raw chunk,
 * we prepend useful document context so the
 * embedding model better understands the content.
 *
 * @param {Object} chunk
 * @returns {string}
 */
export function buildEmbeddingText(chunk) {
  if (!chunk?.text?.trim()) {
    throw new Error(
      "Chunk text is required to build embedding text."
    );
  }

  const parts = [];

  if (chunk.metadata?.documentTitle) {
    parts.push(
      `Document: ${chunk.metadata.documentTitle}`
    );
  }

  if (chunk.metadata?.sourceType) {
    parts.push(
      `Source Type: ${chunk.metadata.sourceType}`
    );
  }

  if (chunk.metadata?.sectionTitle) {
    parts.push(
      `Section: ${chunk.metadata.sectionTitle}`
    );
  }

  parts.push(chunk.text.trim());

  return parts.join("\n\n");
}

/**
 * Builds the canonical embedding object
 * attached to each chunk.
 *
 * @param {Object} params
 * @param {number[]} params.vector
 * @param {string} params.provider
 * @param {string} params.model
 * @returns {Object}
 */
export function buildChunkEmbedding({
  vector,
  provider,
  model,
}) {
  return {
    vector,

    dimensions: vector.length,

    provider,

    model,

    generatedAt: new Date(),
  };
}