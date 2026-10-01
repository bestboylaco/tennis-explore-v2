#!/usr/bin/env node
// Creates (or confirms) the local single-table design this project expects,
// and enables per-item TTL on it -- the same role minio-init plays for S3
// (docker-compose.yml runs this automatically via the dynamodb-local-init
// service; `npm run dynamodb:init` runs it by hand against any endpoint).
//
// Deliberately reads DYNAMODB_* env vars directly rather than importing
// src/config/env.js: this script has nothing to do with the rest of the app
// booting (no PORT, no MONGODB_URI), and importing env.js would require
// faking those just to satisfy its unrelated required-variable check.
//
// Safe to run against an already-initialised table: if the table exists this
// is a no-op, not a retry.
//
// NEVER point this at the partner's real tennis-explore-g2 table expecting it
// to "set it up" -- that table is theirs to provision, and its real key
// schema is still unknown to us (see docs/DYNAMODB-MIGRATION.md). This script
// is for DynamoDB Local only.

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";

const tableName = process.env.DYNAMODB_TABLE_NAME || "tennis-explore-g2";
const pkName = process.env.DYNAMODB_PK_NAME || "PK";
const skName = process.env.DYNAMODB_SK_NAME || "SK";
const ttlAttribute = process.env.DYNAMODB_TTL_ATTRIBUTE || "ttl";
const endpoint = process.env.DYNAMODB_ENDPOINT || "http://localhost:8800";
const region = process.env.DYNAMODB_REGION || process.env.AWS_REGION || "ap-southeast-2";

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.DYNAMODB_ACCESS_KEY_ID || "local",
    secretAccessKey: process.env.DYNAMODB_SECRET_ACCESS_KEY || "local",
  },
});

async function tableExists() {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      return false;
    }

    throw error;
  }
}

async function main() {
  if (await tableExists()) {
    console.log(`DynamoDB table "${tableName}" already exists at ${endpoint}; nothing to do.`);
    return;
  }

  // Single-table design, key names only -- no GSIs. Every access pattern this
  // project needs (point lookups by email / session id / telemetry recordId,
  // plus two small Scan+filter paths for the admin dev-login lookup and
  // telemetry listing/aggregation) works off the base table alone, on
  // purpose: the real partner table's indexes, if any, are unknown right now
  // (DescribeTable is denied), so nothing here assumes one exists.
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: pkName, AttributeType: "S" },
        { AttributeName: skName, AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: pkName, KeyType: "HASH" },
        { AttributeName: skName, KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  console.log(`Created DynamoDB table "${tableName}" (${pkName}/${skName}) at ${endpoint}.`);

  // TTL can only be enabled once the table exists, so this always runs
  // second. DynamoDB Local accepts this call for API compatibility but --
  // unlike real AWS -- never actually sweeps expired items in the background.
  // See docs/DYNAMODB-MIGRATION.md for why that matters for local testing.
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { Enabled: true, AttributeName: ttlAttribute },
    }),
  );

  console.log(`Enabled TTL on "${ttlAttribute}".`);
}

main().catch((error) => {
  console.error("DynamoDB table initialisation failed:", error);
  process.exitCode = 1;
});
