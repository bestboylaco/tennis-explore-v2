import {
  buildEmbeddingText,
  buildChunkEmbedding,
} from "./embeddingBuilder.js";

import {
  generateEmbeddings,
} from "./embeddingProvider.js";

import {
  validateEmbedding,
} from "./embeddingValidator.js";

/**
 * Generates embeddings for every chunk
 * in the ingestion pipeline.
 *
 * @param {Object} pipeline
 * @returns {Promise<Object>}
 */
export async function embedPipelineChunks(
  pipeline
) {
  if (!pipeline) {
    throw new Error(
      "Pipeline is required before embedding."
    );
  }

  if (
    !Array.isArray(pipeline.chunks) ||
    pipeline.chunks.length === 0
  ) {
    throw new Error(
      "Pipeline must contain chunks before embedding."
    );
  }

  console.log(
    `🧠 Generating embeddings for ${pipeline.chunks.length} chunk(s)...`
  );

  // Build semantic input for every chunk
  const embeddingTexts =
    pipeline.chunks.map((chunk) =>
      buildEmbeddingText(chunk)
    );

  // Generate embeddings in one batch
  const embeddingResult =
    await generateEmbeddings(
      embeddingTexts
    );

  const failures = [];

  let expectedDimensions = null;

  pipeline.chunks.forEach(
    (chunk, index) => {
      const vector =
        embeddingResult.vectors[index];

      if (
        expectedDimensions === null &&
        Array.isArray(vector)
      ) {
        expectedDimensions =
          vector.length;
      }

      const validation =
        validateEmbedding(
          vector,
          expectedDimensions
        );

      if (!validation.isValid) {
        failures.push({
          chunkId: chunk.id,
          chunkIndex: chunk.index,
          errors: validation.errors,
          warnings:
            validation.warnings,
        });

        return;
      }

      chunk.embedding =
        buildChunkEmbedding({
          vector,

          provider:
            embeddingResult.provider,

          model:
            embeddingResult.model,
        });

      if (
        validation.warnings.length > 0
      ) {
        chunk.metadata.embeddingWarnings =
          validation.warnings;
      }
    }
  );

  const totalEmbedded =
    pipeline.chunks.filter(
      (chunk) =>
        Array.isArray(
          chunk.embedding?.vector
        )
    ).length;

  pipeline.embedding = {
    completedAt: new Date(),

    provider:
      embeddingResult.provider,

    model:
      embeddingResult.model,

    dimensions:
      expectedDimensions,

    totalRequested:
      pipeline.chunks.length,

    totalEmbedded,

    totalFailed:
      failures.length,

    failures,
  };

  console.log(
    `✅ Embedded ${totalEmbedded}/${pipeline.chunks.length} chunk(s)`
  );

  if (failures.length > 0) {
    throw new Error(
      `Embedding failed for ${failures.length} chunk(s).`
    );
  }

  return pipeline;
}

/**
 * Generate one embedding for a search question.
 *
 * @param {string} text
 *
 * @returns {Promise<{
 *   vector: number[],
 *   provider: string,
 *   model: string,
 *   dimensions: number
 * }>}
 */
export async function embedText(text) {
  if (
    typeof text !== "string" ||
    text.trim().length === 0
  ) {
    throw new TypeError(
      "Embedding text must be a non-empty string."
    );
  }

  const embeddingResult =
    await generateEmbeddings([
      text.trim(),
    ]);

  const vector =
    embeddingResult.vectors?.[0];

  const validation =
    validateEmbedding(
      vector,
      Array.isArray(vector)
        ? vector.length
        : null
    );

  if (!validation.isValid) {
    throw new Error(
      `Question embedding validation failed: ${validation.errors.join(", ")}`
    );
  }

  return {
    vector,
    provider: embeddingResult.provider,
    model: embeddingResult.model,
    dimensions: vector.length,
  };
}