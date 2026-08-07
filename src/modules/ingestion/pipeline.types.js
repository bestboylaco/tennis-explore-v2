/**
 * @typedef {Object} PipelineSource
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} sourceType
 * @property {string} processingStatus
 */

/**
 * @typedef {Object} PipelineFile
 * @property {string} originalName
 * @property {string} mimeType
 * @property {number} size
 * @property {Date|string|null} uploadedAt
 * @property {string} storageProvider
 * @property {string} bucket
 * @property {string} key
 * @property {string|null} etag
 */

/**
 * @typedef {Object} TechnicalMetadata
 * @property {string|null} language
 * @property {number} characterCount
 * @property {number} wordCount
 * @property {number} estimatedReadingTimeMinutes
 * @property {Date|string|null} extractedAt
 * @property {Date|string|null} metadataGeneratedAt
 */

/**
 * @typedef {Object} SemanticMetadata
 * @property {string|null} documentType
 * @property {string[]} mentionedPlayers
 * @property {string[]} detectedTopics
 * @property {number|null} confidence
 */

/**
 * @typedef {Object} PipelineDocument
 * @property {string} text
 * @property {number} characterCount
 * @property {TechnicalMetadata|null} technicalMetadata
 * @property {StructuralMetadata|null} structuralMetadata
 * @property {DomainMetadata|null} domainMetadata
 * @property {DomainValidation|null} domainValidation
 * @property {SemanticMetadata|null} semanticMetadata
 */

/**
 * @typedef {Object} PipelineChunkMetadata
 * @property {string} sourceId
 * @property {string} sourceType
 * @property {string} documentTitle
 * @property {string|null} sectionTitle
 * @property {number|null} pageNumber
 * @property {string|null} speaker
 * @property {number|null} timestampStart
 * @property {number|null} timestampEnd
 * @property {string[]} [validationWarnings]
 */

/**
 * @typedef {Object} PipelineChunk
 * @property {string} id
 * @property {number} index
 * @property {string} text
 * @property {number} characterCount
 * @property {PipelineChunkMetadata} metadata
 * @property {PipelineChunkEmbedding|null} embedding
 */

/**
 * @typedef {Object} PipelineChunkEmbedding
 * @property {number[]} vector
 * @property {number} dimensions
 * @property {string} provider
 * @property {string} model
 * @property {Date|string} generatedAt
 */

/**
 * @typedef {Object} PipelineEmbeddingResult
 * @property {Date|string|null} completedAt
 * @property {string} provider
 * @property {string} model
 * @property {number|null} dimensions
 * @property {number} totalRequested
 * @property {number} totalEmbedded
 * @property {number} totalFailed
 * @property {Object[]} failures
 */


/**
 * @typedef {Object} PipelineChunkingResult
 * @property {Date|string|null} completedAt
 * @property {string} strategy
 * @property {number} totalGenerated
 * @property {number} totalAccepted
 * @property {number} totalRejected
 * @property {Object[]} rejectedChunks
 */

/**
 * @typedef {Object} IngestionPipeline
 * @property {PipelineSource} source
 * @property {PipelineFile} file
 * @property {PipelineDocument|null} document
 * @property {PipelineChunk[]} chunks
 * @property {PipelineChunkingResult|null} chunking
 * @property {PipelineEmbeddingResult|null} embedding
 */


/**
 * @typedef {Object} StructuralMetadata
 * @property {number} headingCount
 * @property {string[]} headings
 * @property {number} paragraphCount
 * @property {number} sectionCount
 * @property {number} blankLineCount
 * @property {number} bulletListCount
 * @property {number} numberedListCount
 */

/**
 * @typedef {Object} DomainMetadata
 * @property {string|null} documentType
 * @property {string[]} [players]
 * @property {string|null} [score]
 * @property {string|null} [winner]
 * @property {string|null} [tournament]
 * @property {string|null} [round]
 * @property {string|null} [matchDate]
 */

/**
 * @typedef {Object} DomainValidation
 * @property {string|null} documentType
 * @property {boolean} validatorAvailable
 * @property {boolean} isValid
 * @property {number|null} score
 * @property {string[]} warnings
 * @property {string[]} errors
 */


/**
 * Creates the initial canonical ingestion pipeline object.
 *
 * @param {Object} source
 * @returns {IngestionPipeline}
 */
export function createPipelineDocument(
  source
) {
  if (!source) {
    throw new Error(
      "Source is required to create the ingestion pipeline."
    );
  }

  if (
    typeof source?.file?.key !==
      "string" ||
    source.file.key.trim().length === 0
  ) {
    throw new Error(
      "Source does not contain a valid uploaded S3 file."
    );
  }

  if (
    typeof source?.file?.originalName !==
      "string" ||
    source.file.originalName.trim().length === 0
  ) {
    throw new Error(
      "Source does not contain an original file name."
    );
  }

  return {
    source: {
      id:
        source._id.toString(),

      title:
        source.title,

      description:
        source.description || "",

      sourceType:
        source.sourceType,

      processingStatus:
        source.processingStatus,
    },

    file: {
      originalName:
        source.file.originalName,

      mimeType:
        source.file.mimeType,

      size:
        source.file.size,

      uploadedAt:
        source.file.uploadedAt || null,

      storageProvider:
        source.file.storageProvider ||
        "s3",

      bucket:
        source.file.bucket,

      key:
        source.file.key,

      etag:
        source.file.etag || null,
    },

    document:
      null,

    chunks:
      [],

    chunking:
      null,

    embedding:
      null,
  };
}