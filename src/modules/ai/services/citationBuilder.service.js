/**
 * Build standardized document-level citations
 * while preserving chunk-level evidence references.
 *
 * @param {Object} options
 * @param {Object[]} [options.evidence=[]]
 *
 * @returns {{
 *   totalSources: number,
 *   citations: Object[]
 * }}
 */
export function buildCitations({
  evidence = [],
} = {}) {
  if (!Array.isArray(evidence)) {
    throw new TypeError(
      "Evidence must be an array."
    );
  }

  const citationsBySource =
    new Map();

  evidence.forEach((item, index) => {
    const sourceId =
      item?.sourceId ||
      null;

    if (!sourceId) {
      return;
    }

    const evidenceReference = {
        reference:
            `Source ${index + 1}`,

        pointId:
            item.pointId ||
            null,

        chunkIndex:
            item.chunkIndex ??
            null,

        score:
            typeof item.score === "number"
            ? item.score
            : null,

        confidence:
            item?.confidence &&
            typeof item.confidence === "object"
            ? {
                overall:
                    typeof item.confidence.overall === "number"
                    ? item.confidence.overall
                    : null,

                similarity:
                    typeof item.confidence.similarity === "number"
                    ? item.confidence.similarity
                    : null,

                metadataQuality:
                    typeof item.confidence.metadataQuality === "number"
                    ? item.confidence.metadataQuality
                    : null,

                sourceQuality:
                    typeof item.confidence.sourceQuality === "number"
                    ? item.confidence.sourceQuality
                    : null,

                warningQuality:
                    typeof item.confidence.warningQuality === "number"
                    ? item.confidence.warningQuality
                    : null,

                warnings:
                    Array.isArray(item.confidence.warnings)
                    ? item.confidence.warnings
                    : [],
                }
            : null,
        };

    if (!citationsBySource.has(sourceId)) {
      citationsBySource.set(
        sourceId,
        {
          reference:
            `Source ${index + 1}`,

          title:
            item.documentTitle ||
            "Unknown source",

          sourceType:
            item.sourceType ||
            "unknown",

          moduleId:
            item.moduleId ||
            "unknown",

          sourceId,

          evidenceReferences: [
            evidenceReference,
          ],
        }
      );

      return;
    }

    citationsBySource
      .get(sourceId)
      .evidenceReferences
      .push(evidenceReference);
  });

  const citations =
    Array.from(
      citationsBySource.values()
    );

  return {
    totalSources:
      citations.length,

    citations,
  };
}