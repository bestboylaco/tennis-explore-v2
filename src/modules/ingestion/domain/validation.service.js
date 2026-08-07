import { getDomainValidator } from "./validationRegistry.js";

/**
 * Validates domain metadata already attached to the pipeline.
 *
 * @param {import("../pipeline.types.js").IngestionPipeline} pipeline
 * @returns {import("../pipeline.types.js").IngestionPipeline}
 */
export function validateDomainMetadata(pipeline) {
  const metadata =
    pipeline?.document?.domainMetadata;

  if (!metadata) {
    throw new Error(
      "Domain metadata is required before validation."
    );
  }

  const documentType =
    metadata.documentType ||
    pipeline.source?.sourceType ||
    null;

  const validator =
    getDomainValidator(documentType);

  if (!validator) {
    pipeline.document.domainValidation = {
      documentType,
      validatorAvailable: false,
      isValid: true,
      score: null,
      warnings: [
        "No validator is registered for this document type.",
      ],
      errors: [],
    };

    return pipeline;
  }

  pipeline.document.domainValidation = {
    documentType,
    validatorAvailable: true,
    ...validator(metadata),
  };

  return pipeline;
}