import {
  PIPELINE_STAGE_NAMES,
  STAGE_STATUSES,
} from "../../../shared/constants/telemetry.js";
import {
  buildKey,
  epochSecondsFromMs,
  getItem,
  putItem,
  scanAll,
  stripInternalFields,
  ttlAttributeName,
} from "../../../infrastructure/dynamodb/dynamoTable.service.js";
import { telemetryConfig } from "../telemetry.config.js";

/*
 * TENISE-63: one telemetry record per run, now stored in the one DynamoDB
 * table this project has instead of its own MongoDB collection.
 *
 * Single-table design: PK = `TELEMETRY#<recordId>`, SK = `RECORD`. recordId
 * (a UUID, minted by telemetryRecorder.service.js) is already globally
 * unique and is the only thing findTelemetryRecordById() is ever asked to
 * look up by, so it is the partition key directly -- no second index is
 * needed for that path.
 *
 * The dynamic Map fields (stages, ingestion.byApi, compute.byResource,
 * cost.breakdown, attributes) carry over as plain nested JS objects rather
 * than Mongoose Maps. DynamoDB has no schema to violate either way: a new
 * pipeline stage or billed API is still just a new key in a nested document
 * attribute, written and read with no migration, which is exactly the
 * property this file existed to protect.
 *
 * Retention: this project's one TTL index on `startedAt` becomes DynamoDB's
 * native per-item TTL attribute (dynamodbConfig.ttlAttribute, default `ttl`),
 * computed below from the same telemetryConfig.retentionDays window. Real
 * AWS DynamoDB sweeps expired items in the background (usually within 48
 * hours of expiry, same caveat as the session store); DynamoDB Local accepts
 * the TTL configuration for API compatibility but never actually deletes
 * anything on its own -- see docs/DYNAMODB-MIGRATION.md.
 */

const ENTITY_TYPE = "TELEMETRY";
const RECORD_SK = "RECORD";

function telemetryPk(recordId) {
  return `TELEMETRY#${recordId}`;
}

// Kept for parity with the previous module's export. Nothing in this
// codebase currently imports it (telemetryRecorder.service.js builds its own
// stages object inline), but it documents the same "every record carries all
// four pipeline stages from day one" invariant the Mongoose schema's default
// used to encode structurally.
export function createDefaultStages() {
  const stages = {};

  for (const stage of PIPELINE_STAGE_NAMES) {
    stages[stage] = { status: STAGE_STATUSES.NOT_IMPLEMENTED };
  }

  return stages;
}

// Exported so the retention policy is checkable with no database, the same
// way test/unit/telemetryRecord.model.test.js checked it when this was a
// Mongoose TTL index declaration (which also needed no connection).
export function computeTtlEpochSeconds(startedAt) {
  const startedAtMs = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  const retentionMs = telemetryConfig.retentionDays * 24 * 60 * 60 * 1000;

  return epochSecondsFromMs(startedAtMs + retentionMs);
}

/*
 * Dates (startedAt, completedAt, stage timestamps, coldStart event
 * timestamps, cost.calculatedAt) go in as JS Date instances, the same as
 * telemetryRecorder.service.js has always built them. DynamoDB has no native
 * Date type, so a plain JSON round trip is used to normalise every Date into
 * an ISO-8601 string (and drop `undefined` values, mirroring
 * removeUndefinedValues on the document client) before the item is written.
 *
 * Records read back therefore carry ISO strings rather than Date objects
 * where Mongoose's `.lean()` used to hand back real Dates. This is a
 * deliberate, harmless difference: every caller either serialises the record
 * straight to a JSON HTTP response (identical either way) or compares/sorts
 * startedAt as a value, and ISO-8601 UTC strings sort lexicographically in
 * the same order the Dates they came from would.
 */
function serialiseForStorage(record) {
  return JSON.parse(JSON.stringify(record));
}

export async function createTelemetryRecord(record) {
  const stored = serialiseForStorage(record);

  const item = {
    ...buildKey(telemetryPk(stored.recordId), RECORD_SK),
    entityType: ENTITY_TYPE,
    ...stored,
    [ttlAttributeName()]: computeTtlEpochSeconds(record.startedAt),
  };

  await putItem(item);

  return stored;
}

export async function getTelemetryRecordByRecordId(recordId) {
  if (!recordId) return null;

  const item = await getItem(telemetryPk(recordId), RECORD_SK);

  return stripInternalFields(item);
}

/*
 * Every telemetry item in the table, entity-filtered but otherwise
 * unfiltered -- telemetryStore.service.js applies the actual query filter
 * (runType, queryClass, time window, ...) in memory afterwards, the same way
 * buildTelemetryFilter's output always has. A Scan, not a Query: this project
 * defines no secondary index for telemetry access patterns, on purpose (the
 * real partner table's indexes, if any, are unknown). Fine at demo/local
 * scale; see docs/DYNAMODB-MIGRATION.md's scaling note.
 */
export async function scanAllTelemetryRecords() {
  const items = await scanAll({
    filterExpression: "entityType = :entityType",
    expressionAttributeValues: { ":entityType": ENTITY_TYPE },
  });

  return items.map(stripInternalFields);
}
