import Source from "../models/source.model.js";

import {
  uploadFile,
  generateStorageKey,
} from "../../../infrastructure/storage/index.js";

import {
  ingestUploadedSource,
} from "../../ingestion/ingestion.service.js";

import {
  PROCESSING_STATUSES,
} from "../../../shared/constants/processingStatuses.js";

/**
 * Upload a source file.
 *
 * Workflow:
 *
 * 1. Find source
 * 2. Generate storage key
 * 3. Upload to S3
 * 4. Update MongoDB
 * 5. Start ingestion
 * 6. Return updated source
 */
export async function uploadSourceFile({
  sourceId,
  file,
} = {}) {

    if (
    typeof sourceId !== "string" ||
    sourceId.trim().length === 0
  ) {
    throw new TypeError(
      "A valid source ID is required."
    );
  }

  if (!file) {
    throw new TypeError(
      "An uploaded file is required."
    );
  }

  const source =
    await Source.findById(
      sourceId.trim()
    );

  if (!source) {
    throw new Error(
      "Source not found."
    );  
  }


  const storageKey =
  generateStorageKey({
    sourceType:
      source.sourceType,

    originalFilename:
      file.originalname,
  });



  const storageResult =
  await uploadFile({
    fileBuffer:
      file.buffer,

    storageKey,

    mimeType:
      file.mimetype,
  });



  source.file = {
  originalName:
    file.originalname,

  mimeType:
    file.mimetype,

  size:
    file.size,

  uploadedAt:
    new Date(),

  storageProvider:
    "s3",

  bucket:
    storageResult.bucket,

  key:
    storageResult.key,

  etag:
    storageResult.etag,
};

source.processingStatus =
  PROCESSING_STATUSES.UPLOADED;

await source.save();


const ingestionResult =
  await ingestUploadedSource(
    source
  );

return {
  source,
  storage:
    storageResult,
  ingestion:
    ingestionResult,
};



}