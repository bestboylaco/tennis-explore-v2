import { enrichTechnicalMetadata } from "./technicalMetadata.service.js";
import { enrichStructuralMetadata } from "./structuralMetadata.service.js";
import { enrichDomainMetadata } from "./domain/domainMetadata.service.js";
import { validateDomainMetadata } from "./domain/validation.service.js";

/**
 * Runs all metadata enrichment and validation stages.
 *
 * @param {import("./pipeline.types.js").IngestionPipeline} pipeline
 * @returns {import("./pipeline.types.js").IngestionPipeline}
 */
export function enrichMetadata(pipeline) {
  enrichTechnicalMetadata(pipeline);
  enrichStructuralMetadata(pipeline);
  enrichDomainMetadata(pipeline);
  validateDomainMetadata(pipeline);

  return pipeline;
}