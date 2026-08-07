import { validateMatchReport } from "./validators/matchReport.validator.js";

/**
 * Maps document types to metadata validators.
 */
const validationRegistry = {
  match_report: validateMatchReport,
};

/**
 * Returns the validator registered for a document type.
 *
 * @param {string|null|undefined} documentType
 * @returns {Function|null}
 */
export function getDomainValidator(documentType) {
  if (
    !documentType ||
    typeof documentType !== "string"
  ) {
    return null;
  }

  return validationRegistry[documentType] || null;
}

/**
 * Checks whether a validator exists for a document type.
 *
 * @param {string|null|undefined} documentType
 * @returns {boolean}
 */
export function hasDomainValidator(documentType) {
  return Boolean(
    getDomainValidator(documentType)
  );
}