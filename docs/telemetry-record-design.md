# TennisExplore V2 — Telemetry Record Design

**Ticket:** TENISE-26 / E6-20a — Telemetry scaffolding and record structure
**Epic:** Epic 6 — Measurement & Evaluation
**Status:** Implemented (Sprint 1)
**Related:** TENISE-30 (per-stage figures), TENISE-27 (cost/latency calculations),
E6-21 (extrapolation), TENISE-43 / E5-20 (threat model, component C14)

## 1. Purpose

Put the measurement mechanism in place before there is much to measure, so no
part of the project runs unrecorded. Instrumentation added in week 9 only
describes week 9; E6-21 needs a series that starts in Sprint 1.

This document defines the record structure, where it is stored, and how it maps
onto the calculations TENISE-27 will run.

## 2. Where telemetry lives

Telemetry is written to its own MongoDB collection, `telemetry_records`, through
the `TelemetryRecord` model — **not** to `console.log`. Application logs are
unstructured, unqueryable and already flagged as a data classification gap in
the threat model (C13). A separate collection means TENISE-27 can aggregate with
`$group`/`$percentile` instead of parsing text.

Writes are best effort. If the store is unreachable or `TELEMETRY_ENABLED=false`,
the recorder warns once and the measured run continues unaffected. Telemetry
must never be the reason an ingestion run fails.

## 3. Record structure

One record per **run**. A run is any measured unit of work: an ingestion run, a
query, an API request, or process startup. `runType` distinguishes them and is a
free string — a new run type needs no schema change.

```jsonc
{
  "schemaVersion": 1,
  "recordId": "uuid",
  "runType": "ingestion | query | api_request | startup",
  "correlationId": "ingestion:<sourceId>",
  "queryClass": "document | statistics | not_applicable",
  "status": "running | success | partial | failed",
  "environment": "development",
  "serviceVersion": "sprint-1",

  "startedAt": "…", "completedAt": "…", "totalDurationMs": 5279,

  "stages": {                       // ← generic map, see §4
    "routing":    { "status": "not_implemented", … },
    "retrieval":  { "status": "not_implemented", … },
    "rerank":     { "status": "not_implemented", … },
    "generation": { "status": "not_implemented", … }
  },

  "ingestion": {
    "sourceId": "…", "sourceType": "research_paper",
    "documentCount": 1, "pageCount": 14, "assetCount": 41,
    "byteCount": 84213, "chunkCount": 37,
    "byApi": {                      // ← split by billed API, see §6
      "textract":          { "apiCalls": 1, "pages": 14, "assets": 2, … },
      "bedrock_embedding": { "apiCalls": 3, "tokensIn": 9120, … },
      "opensearch":        { "apiCalls": 1, "assets": 37, … }
    }
  },

  "coldStart": {                    // ← see §7
    "detected": true, "count": 1, "totalRecoveryMs": 5206,
    "events": [{ "resource": "opensearch_serverless", "stage": "index",
                 "recoveryMs": 5206, "thresholdMs": 5000 }]
  },

  "tokens": { "input": 0, "output": 0 },
  "cost":   { "estimatedUsd": null, "currency": "USD", "breakdown": {} },
  "http":   { "method": "POST", "route": "/api/sources/:sourceId/ingest", "statusCode": 202 },
  "error":  { "code": null, "message": null },
  "attributes": {}
}
```

## 4. Why `stages` is a map, not four named fields

Two acceptance criteria pull in opposite directions:

- the record must **already have fields for all four pipeline stages**
  (routing, retrieval, rerank, generation) before any of them exist;
- **adding a new measured stage must require no change to the record structure**.

Named schema fields satisfy the first and break the second — a Guardrails stage,
or the five ingestion stages, would each need a schema edit.

The resolution: `stages` is a `Map<stageName, StageMetric>` that every new record
is **seeded** with, containing the four canonical stages at
`status: "not_implemented"`. So:

- the four fields are present in every record written today (AC 1);
- TENISE-30 fills them by calling `endStage("retrieval", …)` — no migration;
- `not_implemented` stays distinguishable from `skipped` and from
  "stage ran and returned nothing";
- a fifth stage is a new key, not a new field (AC 6). This is not theoretical:
  the five ingestion stages (`fetch_source`, `extract`, `chunk`, `embed`,
  `index`) already use it in Sprint 1.

Every stage carries the same shape: `status`, `startedAt`, `completedAt`,
`durationMs`, `attempts`, `apiType`, `apiCalls`, `itemsIn`, `itemsOut`,
`tokensIn`, `tokensOut`, `coldStart`, `errorCode`, `reason`, `attributes`.

## 5. Query class

Every record carries `queryClass`, even though routing (Epic 3) does not exist
and only one class is reachable. Values: `document`, `statistics`,
`not_applicable` (ingestion, startup, plain API requests).

It is a free string, not an enum, for the same reason as `runType`: when routing
adds a third class, no schema change and no backfill. Aggregation by class works
from the first record.

## 6. Ingestion volume, split by API type

Each API is billed on a different unit, so a single page count would not support
a cost model:

| API type | Billed unit | Field that carries it |
|---|---|---|
| `textract` | per page | `pages` |
| `bedrock_knowledge_base` | per page / per document | `pages`, `documents` |
| `bedrock_embedding` | per token | `tokensIn` |
| `s3` | per object + bytes | `assets`, `bytes` |
| `opensearch` | per indexed item / OCU-hours | `assets`, `apiCalls` |
| `local` | not billed | baseline document/asset count |

`recordApiUsage(apiType, usage)` accumulates into `ingestion.byApi[apiType]` and
keeps the run-level totals (`pageCount`, `assetCount`, …) consistent with the
split, so a report can use either without recomputing.

A stage with no handler yet still writes its API key with **zero** volume. That
makes "this API is wired but did nothing" visible, and never invents usage that
did not happen.

## 7. Cold starts

The OpenSearch Serverless NextGen collection recovers in roughly 10 seconds. If
those samples sit in the same distribution as warm requests, every latency figure
downstream is wrong — a handful of cold starts can move a p95 by seconds.

Cold starts are therefore flagged in two places:

- **run level** — `coldStart.detected/count/totalRecoveryMs/events[]`, so a whole
  record can be excluded from a distribution;
- **stage level** — `stages.<name>.coldStart`, so only the stage that actually
  paid the recovery is excluded, and the rest of the run stays usable.

Detection is `withColdStartDetection(recorder, { resource, stage }, fn)`: any
call slower than the resource's threshold is flagged with its measured recovery
time. Thresholds live in `src/shared/constants/telemetry.js`
(`opensearch_serverless` 5000ms, Bedrock 4000ms, MongoDB 2000ms) and the default
is overridable with `TELEMETRY_COLD_START_THRESHOLD_MS`.

`aggregateStageLatency` and `aggregateRunLatencyByQueryClass` **exclude cold
start affected samples by default** (`excludeColdStart: true`). Cold start cost
is reported separately by `aggregateColdStarts`, which gives the rate and the
average recovery — the two numbers E6-21 needs to model a real user's experience
rather than an idealised one.

## 8. Review against TENISE-27's calculations

Required by the definition of done: the structure is checked against the
calculations that will consume it, so gaps surface now rather than in week 11.

| TENISE-27 calculation | Fields it reads | Ready? |
|---|---|---|
| Latency per stage (p50/p95/p99) | `stages.*.durationMs`, `stages.*.coldStart` | Yes — `aggregateStageLatency` |
| End-to-end latency per query class | `totalDurationMs`, `queryClass` | Yes — `aggregateRunLatencyByQueryClass` |
| Cold start rate and its latency cost | `coldStart.*` | Yes — `aggregateColdStarts` |
| Cost per ingested page | `ingestion.byApi.<api>.pages` | Yes — `aggregateIngestionVolume` |
| Cost per ingested document / per asset | `ingestion.documentCount`, `assetCount`, `byApi` | Yes |
| Cost per query (token based) | `tokens.input/output`, `stages.*.tokensIn/tokensOut` | Structure ready; values arrive with Epic 4 |
| Retrieval efficiency (hits in vs. used) | `stages.retrieval.itemsIn/itemsOut` | Structure ready; values arrive with TENISE-30 |
| Failure rate per stage | `stages.*.status`, `stages.*.errorCode` | Yes — `failures` in stage aggregation |
| Throughput (pages per minute) | `ingestion.pageCount`, `totalDurationMs` | Yes — `msPerPage`, `msPerDocument` |
| Instrumentation coverage | `stages.*.status` | Yes — `aggregateStageCoverage` |

**Gaps found by this review, and how they were closed:**

1. Cost had nowhere to live. A `cost` object (`estimatedUsd`, `currency`,
   `breakdown`, `calculatedAt`) was added so TENISE-27 can write its result back
   onto the record it was computed from, instead of keeping the answer in a
   spreadsheet that drifts.
2. Retries were invisible. `stages.*.attempts` was added — a stage that
   succeeded on the third try has a different cost from one that succeeded
   immediately.
3. Run-level cold start alone was too coarse: excluding a whole ingestion run
   because one stage was cold throws away four usable measurements. Hence the
   stage-level flag as well.
4. `schemaVersion` was added so records from different weeks stay comparable
   when E6-21 extrapolates across the whole project.

**Assumption to confirm with the TENISE-27 owner:** the cost model is assumed to
be per-page (Textract), per-token (embedding and generation) and per-object (S3),
with OpenSearch charged on OCU-hours rather than per request. If OCU-hours are
needed, that figure comes from AWS billing, not from this record — the record's
job is to supply the request/volume side of that ratio.

**Known rough edge:** `aggregateIngestionVolume().totals.msPerPage` includes cold
start affected runs. Pass `{ coldStart: false }` for the warm figure. Volume
totals deliberately do not exclude them by default, because a page was still
processed.

## 9. Usage

```js
import { startTelemetryRun, withColdStartDetection } from "../telemetry/index.js";

const run = startTelemetryRun({
  runType: "query",
  queryClass: "document",
  correlationId: `query:${queryId}`,
});

// Preferred: the stage cannot be left open if the call throws.
const hits = await withColdStartDetection(
  run,
  { resource: "opensearch_serverless", stage: "retrieval" },
  () => run.measureStage("retrieval", () => searchOpenSearch(query), {
    apiType: "opensearch",
    apiCalls: 1,
  }),
);

run.recordApiUsage("opensearch", { apiCalls: 1, assets: hits.length });

await run.finish();   // writes the record, once
```

Other methods: `startStage` / `endStage` / `skipStage` / `failStage`,
`flagColdStart`, `setQueryClass`, `setSource`, `note(key, value)`, `fail(error)`,
`snapshot()`.

## 10. Content safety (threat model T-04)

Telemetry is classified **Internal** and must stay content-free. Document text,
query strings and request bodies must never be written to a record.

Enforced by construction: there are no content fields. The only free-form field
is the `attributes` map, and `sanitizeAttributeValue` rejects objects, coerces
values to primitives and truncates strings to 200 characters. Errors store a
code and a truncated message, never a stack trace or a request body.

This is what makes threat model **Test C** ("telemetry records contain no
Personal/Biometric/Sensitive content") runnable against telemetry today.

## 11. What is instrumented in Sprint 1

| Surface | Run type | Notes |
|---|---|---|
| Process startup | `startup` | `mongodb_connect` stage, cold start detected |
| Every API request | `api_request` | Excludes `/api/health` and `/api/telemetry` (polled, would drown real runs) |
| Ingestion runs | `ingestion` | 5 stages; volume by API type; source lifecycle updated |

`runIngestion(sourceId, { handlers })` measures the pipeline without
implementing it. Stages with no handler are recorded as `skipped` with reason
`not_implemented`, so telemetry states which parts of the pipeline exist rather
than implying they ran. When an Epic 2 story lands, it registers a handler
returning `{ pages, assets, bytes, tokensIn, chunks, apiCalls }` and those counts
flow into telemetry with **no change to the record structure**.

## 12. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `TELEMETRY_ENABLED` | `true` | Master switch |
| `TELEMETRY_HTTP_ENABLED` | `true` | Per-request records |
| `TELEMETRY_COLD_START_THRESHOLD_MS` | `5000` | Default cold start threshold |
| `TELEMETRY_QUERY_LIMIT` | `100` | Default page size on read endpoints |
| `SERVICE_VERSION` | `sprint-1` | Stamped on every record |

Read in `src/modules/telemetry/telemetry.config.js`, deliberately separate from
`src/config/env.js`: env.js throws on missing required variables, and telemetry
must never prevent the process from starting.

## 13. Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/telemetry` | List records (`runType`, `queryClass`, `status`, `sourceId`, `coldStart`, `from`, `to`, `limit`) |
| GET | `/api/telemetry/summary` | All aggregations in §8 |
| GET | `/api/telemetry/:recordId` | One record |
| POST | `/api/sources/:sourceId/ingest` | Trigger an instrumented ingestion run |

These routes are unauthenticated, like every other route today (threat model
T-01). They expose Internal-classified operational data and must go behind auth
with the rest of the API in E5-17.

## 14. Definition of done

- [x] Record structure has fields for all four pipeline stages before they exist (§4)
- [x] Later stories emit into those fields without a schema change (§4, §11)
- [x] Every record carries a query class tag (§5)
- [x] Written to a queryable, aggregatable store, not application logs (§2)
- [x] Ingestion runs record page and asset counts split by API type (§6)
- [x] Cold start events flagged distinctly (§7)
- [x] A new measured stage requires no record structure change (§4)
- [x] An ingestion run produces a queryable telemetry record (verified end to end
      against MongoDB Atlas: `POST /api/sources/:id/ingest` → record readable at
      `GET /api/telemetry/:recordId`)
- [x] Structure reviewed against TENISE-27's calculations, gaps closed (§8)
