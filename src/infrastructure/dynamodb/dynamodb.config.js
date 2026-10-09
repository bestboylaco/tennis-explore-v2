import dotenv from "dotenv";

dotenv.config();

// TENISE-63: read separately from src/config/env.js on purpose -- same rule
// telemetry.config.js and auth.config.js already follow. env.js throws at
// import time on a missing PORT/MONGODB_URI, and neither telemetry nor auth
// may fail to load just because something read a DynamoDB attribute name:
// a CI unit-test job that never sets PORT must still be able to import
// telemetryRecorder.service.js (it does today, for its no-database tests),
// and coupling this config to env.js would silently break that.
//
// Every value here has a working default already documented in .env.example,
// so a missing line is fine -- .env only exists to override.
export const dynamodbConfig = Object.freeze({
  tableName: process.env.DYNAMODB_TABLE_NAME || "tennis-explore-g2",
  // Defaults match the partner's real table (found by probing, since
  // DescribeTable is not granted -- see docs/DYNAMODB-MIGRATION.md), so
  // DynamoDB Local and the real table use identical key names.
  pkName: process.env.DYNAMODB_PK_NAME || "primary_key",
  skName: process.env.DYNAMODB_SK_NAME || "sort_key",

  // DynamoDB's native per-item expiry attribute (Unix epoch seconds). Used
  // for session expiry and for telemetry retention, replacing Mongo's TTL
  // index -- see telemetryRecord.model.js.
  ttlAttribute: process.env.DYNAMODB_TTL_ATTRIBUTE || "ttl",

  region: process.env.DYNAMODB_REGION || process.env.AWS_REGION || "ap-southeast-2",

  // Unset for real AWS (the SDK's default endpoint resolution is used).
  // Set to DynamoDB Local during development -- see docker-compose.yml.
  endpoint: process.env.DYNAMODB_ENDPOINT || "",

  accessKeyId: process.env.DYNAMODB_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.DYNAMODB_SECRET_ACCESS_KEY || "",

  // A named AWS profile used for DynamoDB ONLY (e.g. the one `aws login
  // --profile partner-corpus` writes). Deliberately not AWS_PROFILE: setting
  // that globally makes the SDK skip AWS_ACCESS_KEY_ID for every client,
  // which would silently move Textract (textract.client.js) onto the
  // partner's DynamoDB-only identity and break it.
  profile: process.env.DYNAMODB_PROFILE || "",
});
