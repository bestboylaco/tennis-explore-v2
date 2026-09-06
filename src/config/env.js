import dotenv from "dotenv";

dotenv.config();

const requiredVariables = [
  "PORT",
  "MONGODB_URI",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `Missing required environment variable: ${variable}`
    );
  }
}

const port =
  Number(process.env.PORT);

if (
  !Number.isInteger(port) ||
  port <= 0
) {
  throw new Error(
    "PORT must be a positive integer."
  );
}

const structuredSourceDirs = (process.env.STRUCTURED_SOURCE_DIRS || "")
  .split(";")
  .map((directory) => directory.trim())
  .filter(Boolean);

// "s3" is opt-in and validated eagerly so a half-configured deployment fails
// at startup, not on the first citation someone clicks. Left at "local" (the
// default) nothing below needs to be set at all.
const storageProvider = process.env.STORAGE_PROVIDER === "s3" ? "s3" : "local";

if (storageProvider === "s3" && !process.env.S3_BUCKET) {
  throw new Error(
    "STORAGE_PROVIDER=s3 requires S3_BUCKET to be set."
  );
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port,
  mongodbUri: process.env.MONGODB_URI,

  // T-08: cors() was previously called with no origin at all, allowing any
  // page in any browser to call this API. The frontend is same-origin (it is
  // served by this same Express app), so the only legitimate caller is this
  // origin unless a deployment explicitly names another one.
  allowedOrigin: process.env.ALLOWED_ORIGIN || `http://localhost:${port}`,

  structuredSourceDirs,

  storage: Object.freeze({
    provider: storageProvider,

    // Local source paths recorded by the current index (sourceUri) are
    // absolute paths under this root. Stripping it is how a local path is
    // turned into the S3 key the same file would use once uploaded -- see
    // storageKey.service.js. Only needed in "s3" mode.
    assetSourceRoot: process.env.ASSET_SOURCE_ROOT || "",

    s3: Object.freeze({
      bucket: process.env.S3_BUCKET || "",
      region: process.env.S3_REGION || "us-east-1",

      // Unset for real AWS. Set to a local MinIO/LocalStack container during
      // development -- see docker-compose.yml -- so this code path is
      // exercised against something S3-compatible without needing the
      // partner's AWS credentials.
      endpoint: process.env.S3_ENDPOINT || "",

      // MinIO and most self-hosted S3-compatible servers need path-style
      // requests (bucket in the URL path, not a subdomain). Real AWS accepts
      // either, so this only matters for local dev.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",

      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    }),
  }),
});
