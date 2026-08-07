/**
 * Builds the canonical chunk object used throughout
 * the ingestion and retrieval pipelines.
 *
 * @param {Object} params
 * @param {import("../pipeline.types.js").IngestionPipeline} params.pipeline
 * @param {string} params.text
 * @param {number} params.index
 * @param {string|null} [params.sectionTitle]
 * @param {number|null} [params.pageNumber]
 * @param {string|null} [params.speaker]
 * @param {number|null} [params.timestampStart]
 * @param {number|null} [params.timestampEnd]
 * @returns {Object}
 */
export function buildChunk({
  pipeline,
  text,
  index,
  sectionTitle = null,
  pageNumber = null,
  speaker = null,
  timestampStart = null,
  timestampEnd = null,
}) {
  if (!pipeline?.source?.id) {
    throw new Error(
      "A valid pipeline source is required to build a chunk."
    );
  }

  const cleanedText = String(text || "").trim();

  return {
    id: `${pipeline.source.id}-chunk-${index}`,

    index,

    text: cleanedText,

    characterCount: cleanedText.length,

    metadata: {
      sourceId: pipeline.source.id,

      sourceType:
        pipeline.source.sourceType || "unknown",

      documentTitle:
        pipeline.source.title || "Untitled source",

      sectionTitle,

      pageNumber,

      speaker,

      timestampStart,

      timestampEnd,
    },

    embedding: null,
  };
}