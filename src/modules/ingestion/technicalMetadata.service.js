const WORDS_PER_MINUTE = 200;

/**
 * Adds deterministic technical metadata to the pipeline document.
 *
 * @param {import("./pipeline.types.js").IngestionPipeline} pipeline
 * @returns {import("./pipeline.types.js").IngestionPipeline}
 */
export function enrichTechnicalMetadata(pipeline) {
  if (!pipeline?.document?.text) {
    throw new Error(
      "Extracted document text is required before metadata enrichment."
    );
  }

  const text = pipeline.document.text.trim();

  const words = text
    .split(/\s+/)
    .filter(Boolean);

  const wordCount = words.length;

  pipeline.document.technicalMetadata = {
    language: detectLanguage(text),
    characterCount: text.length,
    wordCount,
    estimatedReadingTimeMinutes:
      wordCount === 0
        ? 0
        : Math.max(
            1,
            Math.ceil(wordCount / WORDS_PER_MINUTE)
          ),
    extractedAt:
      pipeline.document.technicalMetadata?.extractedAt ||
      new Date(),
    metadataGeneratedAt: new Date(),
  };

  return pipeline;
}

function detectLanguage(text) {
  if (!text) {
    return null;
  }

  // Temporary deterministic default.
  // A proper language detector can replace this later.
  return "en";
}