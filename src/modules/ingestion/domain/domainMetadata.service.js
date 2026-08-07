import { getDomainParser } from "./domainParserRegistry.js";

/**
 * Adds document-type-specific domain metadata.
 *
 * @param {import("../pipeline.types.js").IngestionPipeline} pipeline
 * @returns {import("../pipeline.types.js").IngestionPipeline}
 */
export function enrichDomainMetadata(pipeline) {
  if (!pipeline?.document?.text) {
    throw new Error(
      "Document text is required before domain metadata enrichment."
    );
  }

  const documentType =
    pipeline.source?.sourceType ||
    pipeline.document.semanticMetadata
      ?.documentType ||
    null;

  const parser = getDomainParser(documentType);

  if (!parser) {
    pipeline.document.domainMetadata = {
      documentType,
      parserAvailable: false,
    };

    return pipeline;
  }

  pipeline.document.domainMetadata = parser(
    pipeline.document.text
  );

  return pipeline;
}