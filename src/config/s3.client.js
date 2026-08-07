import {
  S3Client,
} from "@aws-sdk/client-s3";

const {
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET,
} = process.env;

if (
  typeof AWS_REGION !== "string" ||
  AWS_REGION.trim().length === 0
) {
  throw new Error(
    "AWS_REGION is required."
  );
}

if (
  typeof AWS_ACCESS_KEY_ID !== "string" ||
  AWS_ACCESS_KEY_ID.trim().length === 0
) {
  throw new Error(
    "AWS_ACCESS_KEY_ID is required."
  );
}

if (
  typeof AWS_SECRET_ACCESS_KEY !== "string" ||
  AWS_SECRET_ACCESS_KEY.trim().length === 0
) {
  throw new Error(
    "AWS_SECRET_ACCESS_KEY is required."
  );
}

if (
  typeof AWS_S3_BUCKET !== "string" ||
  AWS_S3_BUCKET.trim().length === 0
) {
  throw new Error(
    "AWS_S3_BUCKET is required."
  );
}

export const s3Client =
  new S3Client({
    region:
      AWS_REGION.trim(),

    credentials: {
      accessKeyId:
        AWS_ACCESS_KEY_ID.trim(),

      secretAccessKey:
        AWS_SECRET_ACCESS_KEY.trim(),
    },
  });

export const S3_BUCKET_NAME =
  AWS_S3_BUCKET.trim();