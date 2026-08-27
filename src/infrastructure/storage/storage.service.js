// Thin S3 adapter. Everything here speaks the S3 API, not AWS specifically --
// pointing S3_ENDPOINT at a local MinIO/LocalStack container (see
// docker-compose.yml) exercises the exact same code path a real AWS bucket
// will use later. Handing the partner their own bucket is then an env
// change (S3_ENDPOINT, S3_BUCKET, credentials), not a code change.
//
// Only used when STORAGE_PROVIDER=s3 (env.storage.provider) -- asset.routes.js
// decides which adapter to call, this module doesn't know or care.

import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { env } from "../../config/env.js";

let client = null;

function getClient() {
  if (client) return client;

  if (!env.storage.s3.bucket) {
    throw new Error(
      "S3_BUCKET is not set. STORAGE_PROVIDER=s3 requires it (env.js should have " +
        "caught this at startup -- getClient() being reached without it means env " +
        "validation was bypassed).",
    );
  }

  client = new S3Client({
    region: env.storage.s3.region,
    endpoint: env.storage.s3.endpoint || undefined,
    forcePathStyle: env.storage.s3.forcePathStyle,
    credentials:
      env.storage.s3.accessKeyId && env.storage.s3.secretAccessKey
        ? {
            accessKeyId: env.storage.s3.accessKeyId,
            secretAccessKey: env.storage.s3.secretAccessKey,
          }
        : undefined,
  });

  return client;
}

export async function objectExists(key) {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: env.storage.s3.bucket, Key: key }),
    );

    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) {
      return false;
    }

    throw error;
  }
}

/**
 * Fetches an object, optionally as a byte range -- a video citation seeking
 * to a timestamp requests a range, not the whole file, and S3 supports that
 * natively.
 *
 * Returns what asset.routes.js needs to mirror S3's response back to the
 * browser: the body stream, content type/length, and -- only when a range
 * was requested -- the 206 status and Content-Range header.
 */
export async function getObject(key, { range } = {}) {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: env.storage.s3.bucket,
      Key: key,
      Range: range || undefined,
    }),
  );

  return {
    body: response.Body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
    statusCode: range ? 206 : 200,
  };
}

// Tests construct a fresh client per case (different endpoints/credentials)
// rather than reusing whatever the first test happened to configure.
export function resetS3ClientForTests() {
  client = null;
}
