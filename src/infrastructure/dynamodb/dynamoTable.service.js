// Generic single-table helpers shared by every entity stored in the one
// DynamoDB table this project has (TENISE-63): user profiles, sessions and
// telemetry records. Nothing in here knows about any of those entities --
// it only knows the table name and the two key attribute names, both of
// which are configurable (env.dynamodb.pkName/skName) because the real
// partner table's actual key schema is not yet known. See
// docs/DYNAMODB-MIGRATION.md.
//
// Every item also carries a plain `entityType` attribute ("USER", "SESSION",
// "TELEMETRY"). That attribute's name is NOT configurable -- it is this
// project's own bookkeeping, unrelated to whatever key schema the real table
// turns out to have, and it is how a Scan can be filtered to one entity kind
// without parsing the (possibly differently-named) key attributes.

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import { dynamodbConfig } from "./dynamodb.config.js";
import { getDynamoDocumentClient } from "./dynamoClient.js";

export function pkName() {
  return dynamodbConfig.pkName;
}

export function skName() {
  return dynamodbConfig.skName;
}

export function ttlAttributeName() {
  return dynamodbConfig.ttlAttribute;
}

export function buildKey(pkValue, skValue) {
  return { [pkName()]: pkValue, [skName()]: skValue };
}

// Internal bookkeeping attributes every entity module strips before handing
// a record back to its own callers, so the DynamoDB-specific plumbing never
// leaks into an HTTP response.
export function stripInternalFields(item) {
  if (!item) return null;

  const { [pkName()]: _pk, [skName()]: _sk, entityType: _entityType, [ttlAttributeName()]: _ttl, ...rest } = item;

  return rest;
}

export async function getItem(pkValue, skValue, { consistentRead = false } = {}) {
  const result = await getDynamoDocumentClient().send(
    new GetCommand({
      TableName: dynamodbConfig.tableName,
      Key: buildKey(pkValue, skValue),
      ConsistentRead: consistentRead,
    }),
  );

  return result.Item ?? null;
}

export async function putItem(item, options = {}) {
  await getDynamoDocumentClient().send(
    new PutCommand({
      TableName: dynamodbConfig.tableName,
      Item: item,
      ConditionExpression: options.conditionExpression,
      ExpressionAttributeNames: options.expressionAttributeNames,
      ExpressionAttributeValues: options.expressionAttributeValues,
    }),
  );

  return item;
}

export async function deleteItem(pkValue, skValue) {
  await getDynamoDocumentClient().send(
    new DeleteCommand({
      TableName: dynamodbConfig.tableName,
      Key: buildKey(pkValue, skValue),
    }),
  );
}

// Scans the whole table, paginating on LastEvaluatedKey until it is
// exhausted. Fine at the record volumes a demo/local deployment produces;
// NOT a pattern to carry into a high-volume production table unchanged --
// see docs/DYNAMODB-MIGRATION.md's scaling note before relying on this at
// a size where a full Scan is expensive.
export async function scanAll({
  filterExpression,
  expressionAttributeNames,
  expressionAttributeValues,
  consistentRead = false,
} = {}) {
  const items = [];
  let exclusiveStartKey;

  do {
    const result = await getDynamoDocumentClient().send(
      new ScanCommand({
        TableName: dynamodbConfig.tableName,
        FilterExpression: filterExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ExclusiveStartKey: exclusiveStartKey,
        ConsistentRead: consistentRead,
      }),
    );

    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
}

export function epochSecondsFromMs(milliseconds) {
  return Math.floor(milliseconds / 1000);
}
