// Thin DynamoDB adapter, same shape as storage.service.js's S3 one:
// everything here speaks the DynamoDB API, not "real AWS" specifically --
// pointing DYNAMODB_ENDPOINT at DynamoDB Local (see docker-compose.yml)
// exercises the exact same code path the partner's real tennis-explore-g2
// table will use later. Handing this the partner's real credentials and
// unsetting DYNAMODB_ENDPOINT is then an env change, not a code change.
//
// TENISE-63: users/sessions/telemetry all go through this one client and one
// table (single-table design) -- see dynamoTable.service.js for the key
// helpers and docs/DYNAMODB-MIGRATION.md for the schema this assumes.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { dynamodbConfig } from "./dynamodb.config.js";

let rawClient = null;
let documentClient = null;

function buildClient() {
  return new DynamoDBClient({
    region: dynamodbConfig.region,
    endpoint: dynamodbConfig.endpoint || undefined,
    credentials:
      dynamodbConfig.accessKeyId && dynamodbConfig.secretAccessKey
        ? {
            accessKeyId: dynamodbConfig.accessKeyId,
            secretAccessKey: dynamodbConfig.secretAccessKey,
          }
        : undefined,
  });
}

export function getDynamoDocumentClient() {
  if (documentClient) return documentClient;

  rawClient = buildClient();

  // removeUndefinedValues: callers build records with plenty of optional
  // fields set to undefined (mirroring the Mongoose defaults they replace);
  // DynamoDB's Put/Update would otherwise reject them outright.
  documentClient = DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  return documentClient;
}

// Tests construct a fresh client per case (different endpoints/credentials),
// same reason resetS3ClientForTests() exists on the S3 adapter.
export function resetDynamoClientForTests() {
  rawClient = null;
  documentClient = null;
}
