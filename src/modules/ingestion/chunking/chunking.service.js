import {
  DEFAULT_CHUNK_OPTIONS,
} from "./chunk.types.js";

import {
  getChunkingStrategy,
} from "./chunkStrategies.js";

import {
  buildChunk,
} from "./chunkBuilder.js";

import {
  validateChunk,
} from "./chunkValidator.js";

/**
 * Converts the extracted document into validated chunks.
 *
 * @param {import("../pipeline.types.js").IngestionPipeline} pipeline
 * @param {Object} [options]
 * @returns {import("../pipeline.types.js").IngestionPipeline}
 */
export function chunkDocument(
  pipeline,
  options = DEFAULT_CHUNK_OPTIONS
) {
  if (!pipeline?.document) {
    throw new Error(
      "Pipeline document is required before chunking."
    );
  }

  if (!pipeline.document.text?.trim()) {
    throw new Error(
      "Extracted document text is required before chunking."
    );
  }

  const strategy = getChunkingStrategy(
    pipeline.source.sourceType
  );

  const rawChunks = strategy(
    pipeline.document.text,
    options
  );

  const validChunks = [];
  const rejectedChunks = [];

  rawChunks.forEach((rawChunk, index) => {
    const chunk = buildChunk({
      pipeline,
      text: rawChunk.text,
      index,
      sectionTitle:
        rawChunk.sectionTitle || null,
    });

    const validation = validateChunk(
      chunk,
      options.minimumCharacters
    );

    if (!validation.isValid) {
      rejectedChunks.push({
        index,
        validation,
      });

      return;
    }

    chunk.metadata.validationWarnings =
      validation.warnings;

    validChunks.push(chunk);
  });

  if (validChunks.length === 0) {
    throw new Error(
      "Chunking completed without producing any valid chunks."
    );
  }

  pipeline.chunks = validChunks;

  pipeline.chunking = {
    completedAt: new Date(),
    strategy:
      strategy.name || "chunkDocumentText",
    totalGenerated: rawChunks.length,
    totalAccepted: validChunks.length,
    totalRejected: rejectedChunks.length,
    rejectedChunks,
  };

  return pipeline;
}