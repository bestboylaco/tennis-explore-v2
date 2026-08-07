

import {
  s3Client,
  S3_BUCKET_NAME,
} from "../../config/s3.client.js";

import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Upload a file to S3.
 *
 * @param {Object} options
 * @param {Buffer} options.fileBuffer
 * @param {string} options.storageKey
 * @param {string} options.mimeType
 *
 * @returns {Promise<{
 *   bucket: string,
 *   key: string,
 *   etag: string | null
 * }>}
 */
export async function uploadFile({
  fileBuffer,
  storageKey,
  mimeType,
} = {}) {
  if (!Buffer.isBuffer(fileBuffer)) {
    throw new TypeError(
      "A valid file buffer is required."
    );
  }

  if (
    typeof storageKey !== "string" ||
    storageKey.trim().length === 0
  ) {
    throw new TypeError(
      "A valid storage key is required."
    );
  }

  if (
    typeof mimeType !== "string" ||
    mimeType.trim().length === 0
  ) {
    throw new TypeError(
      "A valid MIME type is required."
    );
  }

  const command =
    new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: storageKey.trim(),
      Body: fileBuffer,
      ContentType: mimeType.trim(),
    });

  const response =
    await s3Client.send(command);

  return {
    bucket: S3_BUCKET_NAME,
    key: storageKey.trim(),
    etag:
      response.ETag?.replaceAll(
        "\"",
        ""
      ) || null,
  };
}

/**
 * Download a file from S3 as a Buffer.
 *
 * @param {Object} options
 * @param {string} options.storageKey
 *
 * @returns {Promise<{
 *   bucket: string,
 *   key: string,
 *   fileBuffer: Buffer,
 *   contentType: string | null,
 *   contentLength: number | null,
 *   etag: string | null
 * }>}
 */
export async function downloadFile({
  storageKey,
} = {}) {
  if (
    typeof storageKey !== "string" ||
    storageKey.trim().length === 0
  ) {
    throw new TypeError(
      "A valid storage key is required."
    );
  }

  const normalisedStorageKey =
    storageKey.trim();

  const command =
    new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: normalisedStorageKey,
    });

  let response;

  try {
    response =
      await s3Client.send(command);
  } catch (error) {
    throw new Error(
      `Failed to download "${normalisedStorageKey}" from S3: ${
        error instanceof Error
          ? error.message
          : "Unknown S3 error."
      }`,
      {
        cause: error,
      }
    );
  }

  if (!response.Body) {
    throw new Error(
      `S3 object "${normalisedStorageKey}" did not contain a readable body.`
    );
  }

  const byteArray =
    await response.Body.transformToByteArray();

  const fileBuffer =
    Buffer.from(byteArray);

  return {
    bucket:
      S3_BUCKET_NAME,

    key:
      normalisedStorageKey,

    fileBuffer,

    contentType:
      response.ContentType ||
      null,

    contentLength:
      typeof response.ContentLength === "number"
        ? response.ContentLength
        : null,

    etag:
      response.ETag?.replaceAll(
        "\"",
        ""
      ) || null,
  };
}

/**
 * Delete a file from S3.
 *
 * @param {Object} options
 * @param {string} options.storageKey
 *
 * @returns {Promise<{
 *   bucket: string,
 *   key: string
 * }>}
 */
export async function deleteFile({
  storageKey,
} = {}) {
  if (
    typeof storageKey !== "string" ||
    storageKey.trim().length === 0
  ) {
    throw new TypeError(
      "A valid storage key is required."
    );
  }

  const normalisedStorageKey =
    storageKey.trim();

  const command =
    new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: normalisedStorageKey,
    });

  try {
    await s3Client.send(command);
  } catch (error) {
    throw new Error(
      `Failed to delete "${normalisedStorageKey}" from S3: ${
        error instanceof Error
          ? error.message
          : "Unknown S3 error."
      }`,
      {
        cause: error,
      }
    );
  }

  return {
    bucket:
      S3_BUCKET_NAME,

    key:
      normalisedStorageKey,
  };
}

/**
 * Retrieve metadata for a file stored in S3.
 *
 * @param {Object} options
 * @param {string} options.storageKey
 *
 * @returns {Promise<{
 *   bucket: string,
 *   key: string,
 *   size: number | null,
 *   mimeType: string | null,
 *   etag: string | null,
 *   lastModified: Date | null
 * }>}
 */
export async function getFileMetadata({
  storageKey,
} = {}) {
  if (
    typeof storageKey !== "string" ||
    storageKey.trim().length === 0
  ) {
    throw new TypeError(
      "A valid storage key is required."
    );
  }

  const normalisedStorageKey =
    storageKey.trim();

  const command =
    new HeadObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: normalisedStorageKey,
    });

  let response;

  try {
    response =
      await s3Client.send(command);
  } catch (error) {
    throw new Error(
      `Failed to retrieve metadata for "${normalisedStorageKey}": ${
        error instanceof Error
          ? error.message
          : "Unknown S3 error."
      }`,
      {
        cause: error,
      }
    );
  }

  return {
    bucket:
      S3_BUCKET_NAME,

    key:
      normalisedStorageKey,

    size:
      typeof response.ContentLength ===
      "number"
        ? response.ContentLength
        : null,

    mimeType:
      response.ContentType || null,

    etag:
      response.ETag?.replaceAll(
        "\"",
        ""
      ) || null,

    lastModified:
      response.LastModified || null,
  };
}