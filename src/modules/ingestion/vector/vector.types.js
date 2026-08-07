/**
 * ============================================================================
 * Vector Module Type Definitions
 * ============================================================================
 *
 * Shared type definitions and constants used throughout the
 * Vector Storage pipeline.
 *
 * This file contains:
 * - JSDoc typedefs
 * - Shared constants
 * - No business logic
 * ============================================================================
 */

/**
 * Supported vector storage providers.
 */
export const VECTOR_STORAGE_PROVIDER = Object.freeze({
    QDRANT: "qdrant"
});

/**
 * Default vector collection name.
 */
export const VECTOR_COLLECTION_NAME = "knowledge_chunks";

/**
 * Expected embedding dimensions.
 *
 * Keep this in one place so changing embedding models
 * requires updating only a single constant.
 */
export const EXPECTED_VECTOR_DIMENSIONS = 768;

/**
 * @typedef {Object} VectorPayload
 * @property {string} sourceId
 * @property {string} sourceType
 * @property {string} documentTitle
 * @property {string} sectionTitle
 * @property {number} chunkIndex
 * @property {string} text
 * @property {Object} metadata
 */

/**
 * @typedef {Object} VectorPoint
 * @property {string} id
 * @property {number[]} vector
 * @property {VectorPayload} payload
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} isValid
 * @property {number} dimensions
 * @property {string[]} warnings
 * @property {string[]} errors
 */

/**
 * @typedef {Object} StorageSummary
 * @property {number} totalRequested
 * @property {number} totalStored
 * @property {number} totalFailed
 * @property {Array<Object>} failures
 */

/**
 * @typedef {Object} VectorStoreResult
 * @property {boolean} success
 * @property {string} collection
 * @property {string} operation
 * @property {number} totalStored
 */

export {};