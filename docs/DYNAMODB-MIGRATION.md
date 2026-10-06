# DynamoDB migration for users, sessions and telemetry

**TENISE-63.** Moves user accounts, sessions and telemetry off the MongoDB
Atlas cluster the team set up on its own, onto DynamoDB under the partner's
own AWS account.

---

## The problem

MongoDB Atlas's free (M0) tier had already caused a real bug, not a
theoretical one: `src/app.js`'s `ResilientMongoStore` was a hand-written
retry-on-read wrapper working around Atlas occasionally serving a session
read as "not found" for ~75ms right after login wrote it. Separately,
`accessAuditStore.service.js` silently drops audit records whenever Mongo is
disconnected. And the Atlas connection string -- including a plaintext
password -- sat in `.env`.

The partner wants credential storage under its own governed AWS account, not
a third-party database the team spun up itself. The decision was DynamoDB,
not RDS: the partner explicitly asked to avoid RDS's always-on cost.
`conversations`, `sources` and `audit` stay on MongoDB -- out of scope for
this pass, and `src/modules/conversations/`, `src/modules/sources/`,
`src/modules/audit/` and `src/config/database.js`'s Mongo connection are
untouched.

---

## The constraint everything else here is designed around

The partner has granted access to **exactly one** DynamoDB table,
`tennis-explore-g2`. As of this writing, **every call against it returns
`AccessDeniedException`**, including `DescribeTable` -- so the table's real
key schema (attribute names, any GSIs) is unknown, and the team is following
up with the partner. This is a real open risk, not a formality: see
[What to confirm once real access lands](#what-to-confirm-once-real-access-lands)
below.

Three design choices follow directly from that:

1. **Single-table design.** One table, multiple entity types, told apart by a
   key prefix. There was never a question of "one table per entity" -- the
   partner granted one table.
2. **Configurable key attribute names.** `DYNAMODB_PK_NAME` / `DYNAMODB_SK_NAME`
   (default `PK`/`SK`) are read at call time, not hardcoded. If the partner's
   table turns out to use different attribute names, that is an env change.
3. **No secondary indexes assumed.** Every access pattern below works off the
   base table's primary key alone -- a point `GetItem`/`PutItem` by a known
   key, or a `Scan` with a filter for the two patterns that need one. Nothing
   here queries a GSI, because nothing is known about whether the real table
   has any.

---

## Single-table design

One physical table (`DYNAMODB_TABLE_NAME`, default `tennis-explore-g2` --
deliberately the partner's real table name, so pointing this at the real
account needs no table-name change, only `DYNAMODB_ENDPOINT` and
credentials). Every item carries:

| key | value |
|---|---|
| `PK` (configurable name) | entity-and-id prefix |
| `SK` (configurable name) | entity marker |
| `entityType` | `"USER"` / `"SESSION"` / `"TELEMETRY"` -- this project's own bookkeeping attribute, unrelated to whatever the real table's key *names* turn out to be, used to filter a `Scan` to one entity kind |

| Entity | PK | SK | Read pattern |
|---|---|---|---|
| User | `USER#<email>` | `PROFILE` | `GetItem` by email (point lookup) |
| Session | `SESSION#<sid>` | `SESSION` | `GetItem` by session id (point lookup) |
| Telemetry record | `TELEMETRY#<recordId>` | `RECORD` | `GetItem` by recordId; `Scan`+filter for everything else |

Two access patterns deliberately use `Scan` rather than a `Query`:

- **The dev auto-login admin lookup** (`findActiveAdminUser()`,
  `ENABLE_DEV_AUTO_LOGIN=true` only) -- filters on `entityType`, `roleId`,
  `isActive`. Only ever runs against a handful of seeded demo accounts, so a
  full scan costs nothing.
- **Telemetry listing, filtering and aggregation** (`fetchTelemetryRecords()`
  in `telemetryStore.service.js`) -- filters on `entityType`, then applies
  `buildTelemetryFilter()`'s descriptor (runType, queryClass, status,
  correlationId, `ingestion.sourceId`, cold start, time window) in memory.
  This is the one genuine scaling concern in this design -- see
  [Scaling note](#scaling-note-telemetry-is-a-full-scan-today) below.

### Why the User/Session key shapes deviate slightly from the ticket's example

The ticket's own example used `TELEMETRY#<recordId>#<timestamp>` for the
telemetry key. That was not carried through literally: a timestamp-qualified
partition key cannot be looked up by `findTelemetryRecordById(recordId)`
alone (the caller never knows the timestamp in advance), which is a real
contract `telemetryStore.service.js`'s callers depend on. `TELEMETRY#<recordId>`
alone is the key that actually satisfies that contract; `startedAt` is still
present as a plain attribute, filtered on in `buildTelemetryFilter()`.

### id compatibility with the data that stayed on Mongo

`conversation.model.js` (left on MongoDB) stores `userId` as a real Mongo
`ObjectId` and validates it with `mongoose.isValidObjectId()`
(`conversation.service.js`'s `normaliseUserId`). If a DynamoDB user's `id`
were anything else, every conversation lookup for that user would silently
return nothing (`normaliseUserId` returns `null` on an invalid id, which
every call site treats as "no conversations"). So `user.model.js` mints `id`
as `new mongoose.Types.ObjectId().toString()` -- importing `Types` from
`mongoose` here does **not** reconnect this module to MongoDB, it is used
purely as an id generator, kept for exactly this backward-compatibility
reason. This is called out in `user.model.js`'s own module comment and is
the one place the DynamoDB and MongoDB halves of this app still have to
agree on a shape.

---

## Session store

`connect-dynamodb` (the closest off-the-shelf equivalent to `connect-mongo`)
was checked and rejected: its last release targets the `aws-sdk` v2
callback-style client, not the v3 `DocumentClient` everything else in this
migration uses, and it has had no meaningful maintenance in years. A
~100-line store against the SDK this project already depends on
(`src/infrastructure/sessionStore/dynamoSessionStore.js`) was less risk than
wiring in an unmaintained dependency underneath login.

### Is the Atlas M0 retry workaround still needed? Verified, not assumed.

`app.js` used to carry a `ResilientMongoStore` subclass that retried a
session read once, 75ms later, because Atlas's free tier occasionally served
a read right after `session.regenerate()` wrote it as "not found" -- a
replica read-lag bug, specific to a multi-node replica set serving reads from
a secondary that had not caught up.

DynamoDB has no equivalent failure mode for a single table in a single
region: `GetItem` supports `ConsistentRead: true`, which reads from the
leader storage replica and is guaranteed to reflect every write that has
already returned successfully. `DynamoSessionStore.get()` always sets it.
This was **verified, not assumed** -- the ticket asked for exactly that --
in `test/integration/dynamoSessionStore.test.js`, which regenerates and reads
back 200 sessions in a tight loop with no delay and no retry, against a real
DynamoDB Local instance, and asserts zero misses. It passes. The retry
wrapper is not carried over.

The trade-off: `ConsistentRead: true` costs 2x the RCU of an eventually
consistent read and is marginally slower. Negligible for a single small item
read on every request.

### What DynamoDB's native TTL does *not* give you for free

AWS documents TTL deletion as happening "usually within 48 hours" of expiry,
not immediately. A session read must not trust the background sweep alone --
`DynamoSessionStore.get()` also checks the stored `expiresAtMs` itself and
treats a logically-expired-but-not-yet-swept item as absent. The `ttl`
attribute (name configurable via `DYNAMODB_TTL_ATTRIBUTE`) exists so DynamoDB
eventually reclaims the storage, not as the only expiry check.

**DynamoDB Local specifically never runs the TTL sweep at all** -- it accepts
`UpdateTimeToLive` for API compatibility, but items with an expired `ttl`
attribute just sit there. `test/integration/dynamoSessionStore.test.js`'s
"already expired" case exists because of this: it proves the application-level
expiry check works without depending on a sweep that Local will never run.

---

## Telemetry: dynamic nested fields and retention

The Mongoose schema's `Map` fields (`stages`, `ingestion.byApi`,
`compute.byResource`, `cost.breakdown`, `attributes`) existed so a new
pipeline stage or billed API is "a new key, not a schema edit." DynamoDB's
schemaless nested attributes make this natural: they are stored and read as
plain nested JS objects, with no schema to violate either way. Verified in
`test/integration/telemetryDynamo.test.js` by writing a stage name and a
billed-resource name that this codebase has never declared, and reading them
straight back.

**Dates** go in as `Date` instances, the same as `telemetryRecorder.service.js`
has always built them, and are normalised to ISO-8601 strings on write (a
plain `JSON.parse(JSON.stringify(record))`, since DynamoDB has no native Date
type). Records read back therefore carry ISO strings rather than real `Date`
objects the way Mongoose's `.lean()` used to. This is deliberate and
harmless: every caller either serialises straight to a JSON HTTP response
(identical either way) or sorts/filters `startedAt` as a value, and ISO-8601
UTC strings sort lexicographically in the same order the Dates they came from
would.

**Retention** is DynamoDB's native per-item TTL (`dynamodbConfig.ttlAttribute`,
default `ttl`), computed from `startedAt + telemetryConfig.retentionDays`,
replacing the old `expireAfterSeconds` index on `startedAt`. Verified with no
database in `test/unit/telemetryRecord.model.test.js`, and that the attribute
is actually present on a stored item in
`test/integration/telemetryDynamo.test.js`.

### Aggregation: MongoDB pipelines became JS reductions

`telemetryAggregation.service.js`'s six aggregations (stage latency with
percentiles, run latency by query class, compute by resource, ingestion
volume by API, cold start rates, stage coverage) were MongoDB aggregation
pipelines -- `$objectToArray`, `$unwind`, grouped `$percentile`. DynamoDB has
no aggregation framework of its own, so every function now fetches the
matching records once (`fetchTelemetryRecords()`, a filtered `Scan`) and
reduces them with plain JS `Map`/`reduce` grouping -- the same grouping and
arithmetic the pipelines did, just not expressed as pipeline stages.
`test/integration/telemetryAggregation.test.js` is the same 17-case suite
this project already had for the Mongo version, seeded through DynamoDB
instead, with every numeric assertion unchanged and passing -- the
reimplementation is a faithful port, not a redesign.

One behaviour did change on purpose: Mongo's `$percentile` had a fallback
path for a cluster below MongoDB 7.0 that returned counts/averages with
percentiles left `null`. There is no MongoDB underneath this any more, so
percentiles are always computed (a plain linear-interpolation percentile over
the fetched samples) and `percentilesSupported` is always `true`. The field
is kept only because the telemetry dashboard and its tests read it.

### Scaling note: telemetry is a full Scan today

`fetchTelemetryRecords()` scans every `TELEMETRY` item in the table, every
call, and filters in memory. This is fine at the demo/local record volumes
this project produces today, and genuinely wrong to carry unchanged into a
production-volume table -- a `Scan` is O(table size) and reads (and pays for)
every item whether or not it matches, including every `USER`/`SESSION` item
sharing the table. The fix, once real usage patterns and the real table's
indexes (if any) are known, is a GSI keyed by something like
`entityType`+`startedAt` or `runType`+`startedAt` so the common queries become
a bounded `Query` instead of a table-wide `Scan`. Deliberately not built yet:
building an index against a key schema this project cannot confirm
(`DescribeTable` is denied on the real table) would be guessing twice.

---

## What's tested, and how

Everything in this migration is **tested against DynamoDB Local only**. Real
`tennis-explore-g2` access is still pending (`AccessDeniedException` on every
call as of this writing) -- nothing here has ever been run against the real
partner table.

- `test/unit/telemetryRecord.model.test.js` -- TTL epoch computation, no
  database needed (mirrors how the old Mongoose TTL index declaration needed
  none either).
- `test/unit/telemetryRecorder.test.js` -- unchanged; `buildTelemetryFilter()`
  kept its exact pre-migration shape and is still checked with no database.
- `test/integration/dynamoUserModel.test.js` -- create/find/duplicate-reject/
  role-validate/admin-lookup/upsert/delete against real DynamoDB Local.
- `test/integration/dynamoSessionStore.test.js` -- the read-after-write
  verification described above, plus destroy/touch/already-expired handling.
- `test/integration/telemetryDynamo.test.js` -- write/read/scan/TTL-attribute
  plumbing underneath the store.
- `test/integration/telemetryAggregation.test.js` -- the 17-case aggregation
  parity suite described above.
- `test/integration/auth.test.js` -- the full login/session/logout HTTP flow,
  end to end, against a real server and real DynamoDB Local, with **no**
  MongoDB involved at all (gated on DynamoDB reachability, not
  `MONGODB_URI`, since login no longer touches Mongo).
- `test/integration/telemetryHttpRoute.test.js` and
  `test/integration/conversationHistory.test.js` -- genuinely need **both**
  MongoDB (Source/Conversation) and DynamoDB (telemetry/auth) reachable, so
  they are gated on both and skip cleanly when either is missing.

All of the above pass against DynamoDB Local (and, for the last two, also
against a real MongoDB connection) -- see the final report for actual command
output.

---

## Running it yourself

```bash
# Start DynamoDB Local and create the table (idempotent -- safe to re-run):
docker compose up -d dynamodb-local dynamodb-local-init

# Everything else the app needs, unit tests:
npm run test:unit

# Integration tests (needs DynamoDB Local; MongoDB-dependent suites skip
# cleanly if MONGODB_URI is unset):
npm run test:integration

# Seed demo accounts (now talks to DynamoDB, not Mongo):
npm run seed:users
```

`DYNAMODB_ENDPOINT` defaults to `http://localhost:8800` in `.env.example` --
**not** DynamoDB Local's usual `8000`. On this development machine, something
else (an unrelated local dev server) already owned host port 8000, and Docker's
`0.0.0.0:8000` forward silently lost to it for IPv4 `localhost` connections --
the container was healthy, but requests from outside the compose network hit
the wrong server with no error. `docker-compose.yml`'s comment on the port
mapping explains this; change it back to `8000:8000` freely on a machine where
nothing else holds that port.

---

## What was verified against the real table (2026-10-01)

Access landed, but scoped to data operations only. Probed action by action
with deliberately invalid keys (a `ValidationException` means "authorised,
then rejected before any write"; `AccessDenied` means not granted), and the
table's item count confirmed at 0 before and after:

| Granted on `tennis-explore-g2` (ap-southeast-2 only) | Not granted |
|---|---|
| `GetItem`, `Query`, `Scan`, `BatchGetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem` | `DescribeTable`, `DescribeTimeToLive`, `ListTables`, every `iam:*` read |

**Key schema, found without `DescribeTable`:** a `PutItem` missing its key
fails validation with the missing attribute's name ("Missing the key
primary_key in the item"); repeating with only the partition key (guarded by
an always-false `attribute_exists` condition so nothing could be written)
named the sort key. A full-key `GetItem` then succeeded:

- partition key **`primary_key`** (String), sort key **`sort_key`** (String)

These are now the code and docker-compose defaults, so DynamoDB Local and the
real table use identical names. The table was empty, so item 3 below is
resolved: there is nothing to collide with.

**Credentials:** this project has no static key for the partner account --
only temporary `aws login --profile partner-corpus` sessions. Set
`DYNAMODB_PROFILE=partner-corpus` (resolved via `fromIni`, which reads only
`~/.aws` and never env vars). Do **not** set `AWS_PROFILE` instead: that makes
the SDK ignore `AWS_ACCESS_KEY_ID` for every client, silently moving Textract
onto this DynamoDB-only identity. Verified end to end: the real
`getDynamoDocumentClient()` read the real table with a full `.env` (other
account's `AWS_ACCESS_KEY_ID` present) loaded.

## What to confirm once real access lands

This is a real open risk. Listed plainly, not papered over:

1. ~~**The real table's actual partition/sort key attribute names.**~~
   Resolved 2026-10-01 -- `primary_key`/`sort_key`, see above.
2. **Whether the real table has any GSIs**, and if so, what they're keyed on.
   This design assumes none and uses `Scan`+filter for the two patterns that
   need one (admin lookup, telemetry queries). If a GSI already exists for
   either access pattern, using it instead would be a meaningful performance
   win, not just a style change.
3. ~~**Whether the partition key space collides with existing data.**~~
   Resolved 2026-10-01 -- a `Scan` returned zero items; the table was empty.
4. **Whether PAY_PER_REQUEST billing (used by `bin/dynamodb-init.js` for
   DynamoDB Local) is what the real table is provisioned with**, or whether
   it's a fixed-capacity table this project's write patterns need to respect.
5. ~~**The actual IAM policy**~~ -- resolved 2026-10-01, every data action
   this design uses (including `Scan`) is granted; see the table above.
5a. **Whether TTL is enabled on the real table, and on which attribute.**
   Still open. Sessions and telemetry rely on native TTL (`ttl`, epoch
   seconds) to expire; `DescribeTimeToLive` is denied so it can't be checked,
   and `UpdateTimeToLive` was deliberately not attempted since it would change
   the partner's table. If TTL is off, nothing breaks -- old sessions and
   telemetry just accumulate instead of expiring. Needs the partner to enable
   TTL on `ttl` (or say which attribute they already use, then set
   `DYNAMODB_TTL_ATTRIBUTE`).
6. **Credentials and endpoint are the only things that should need to
   change** to point this at the real table (`DYNAMODB_ENDPOINT` unset,
   `DYNAMODB_ACCESS_KEY_ID`/`DYNAMODB_SECRET_ACCESS_KEY` set, or rely on the
   SDK's default credential provider chain in an environment with an IAM
   role). If getting the real table working ends up needing a code change
   beyond that, something above was assumed wrong.
