import { parseMatchReport } from "./parsers/matchReport.parser.js";

/**
 * Maps document types to their domain metadata parsers.
 */
const domainParserRegistry = {
  match_report: parseMatchReport,
};

/**
 * Returns a parser for the supplied document type.
 *
 * @param {string|null|undefined} documentType
 * @returns {Function|null}
 */
export function getDomainParser(documentType) {
  if (
    !documentType ||
    typeof documentType !== "string"
  ) {
    return null;
  }

  return domainParserRegistry[documentType] || null;
}

/**
 * Checks whether a parser exists for a document type.
 *
 * @param {string|null|undefined} documentType
 * @returns {boolean}
 */
export function hasDomainParser(documentType) {
  return Boolean(getDomainParser(documentType));
}
