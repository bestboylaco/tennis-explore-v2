/**
 * @typedef {Object} ChunkMetadata
 * @property {string} sourceId
 * @property {string} sourceType
 * @property {string} documentTitle
 * @property {string|null} sectionTitle
 * @property {number|null} pageNumber
 * @property {string|null} speaker
 * @property {number|null} timestampStart
 * @property {number|null} timestampEnd
 */

/**
 * @typedef {Object} DocumentChunk
 * @property {string} id
 * @property {number} index
 * @property {string} text
 * @property {number} characterCount
 * @property {ChunkMetadata} metadata
 * @property {number[]|null} embedding
 */

export const DEFAULT_CHUNK_OPTIONS = Object.freeze({
  maxCharacters: 1800,
  overlapCharacters: 200,
  minimumCharacters: 80,
});