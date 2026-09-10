# Textract OCR and table extraction

**TENISE-12 / E2-06.** Reads the scanned documents that the rest of the pipeline
cannot open, and gets their statistical tables into the search index.

---

## The problem

`data/index/build-report.json` records **144 PDFs skipped with
`no usable text extracted`**. Those are files where pdf-parse found no text
layer and poppler's `pdftotext` could not recover one either — they are page
images, not documents. Everything in them, including their tables, was invisible
to search.

`runIngestion()` has had an `extract` stage bound to `API_TYPES.TEXTRACT` since
it was written ([ingestion.service.js:28](../src/modules/ingestion/ingestion.service.js#L28)),
with no handler behind it. Every run recorded `skipStage("not_implemented")`.
This story fills that in.

---

## Why the synchronous API

The natural fit for a multi-page scanned PDF is the asynchronous
`StartDocumentAnalysis`. We cannot use it.

`StartDocumentAnalysis` accepts **only** an `S3Object` — it has no `Bytes`
parameter — so it requires writing the document to a bucket first. That was
tested directly:

```bash
aws s3 cp preflight.txt s3://tennis-explore-resources/textract-preflight/preflight.txt --region ap-southeast-2
# AccessDenied
```

The credentials can **read** `tennis-explore-resources` (the corpus syncs down
fine) but cannot **write** to it. No `s3:PutObject`, no async path.

So: synchronous `AnalyzeDocument` with `Bytes`. One permission,
`textract:AnalyzeDocument`, and S3 is never touched. The cost is that the
synchronous API will not accept a multi-page PDF, which is why every page is
rasterised to a PNG and sent on its own.

| | async (`StartDocumentAnalysis`) | sync (`AnalyzeDocument`) — what we use |
|---|---|---|
| input | `S3Object` only | `Bytes`, ≤ 5 MB |
| pages per call | whole document | exactly one |
| needs S3 write | yes — **denied** | no |
| permissions | `textract:*` + `s3:PutObject` + `s3:GetObject` | `textract:AnalyzeDocument` |

Rasterisation needs no new tool. `pdf-parse` was already a dependency and ships
`@napi-rs/canvas`, so the whole path is Node — no Python, no poppler
(`pdftoppm` is not even on PATH here, only `pdftotext`), no ImageMagick. The
story added exactly one dependency: `@aws-sdk/client-textract`.

---

## The budget, and why so much code is about it

The free tier is **100 pages of table analysis per month**. It cannot be topped
up, and a page spent by mistake is gone. Three guards sit between a command and
the network:

1. **`TEXTRACT_ENABLED` must be `true`.** Off by default, so no npm script can
   spend anything by accident.
2. **The cache.** A document already extracted is never sent again. Keyed on the
   sha256 of the file's **bytes** — not its path or mtime, because the corpus
   lives outside the repo and is re-synced from S3, which rewrites both.
3. **`assertBudget()`.** Refuses — does not warn — if the run would take the
   month past `TEXTRACT_MONTHLY_PAGE_BUDGET`, or past
   `TEXTRACT_MAX_PAGES_PER_RUN` in one go. The per-run cap is the guard against
   one mistyped command with a 400-page PDF emptying a fresh month.

The running total lives in `data/textract-cache/usage.json`, keyed by calendar
month.

### Only complete documents are cached

`writeCache()` refuses a result with any page missing. This matters more than it
looks. Sending twenty pages one at a time, "page 3 threw and the rest worked" is
an ordinary event. Caching that would be the worst outcome available: every
later run reports a hit, the missing page never comes back, and because the run
now costs nothing there is no pressure to notice. Incomplete results are left
uncached so the next run retries them, and the CLI names the pages that failed.

Same instinct as `ocr_scanned.py` refusing to keep a sidecar when the yield
looks too low ([ocr_scanned.py:320](../tools/ocr/ocr_scanned.py#L320)) — a
partial result indistinguishable from a good one is worse than no result.

### Why `data/textract-cache/` is committed

`data/ocr-cache/` is in `.gitignore`; `data/textract-cache/` is not. The
difference is that re-running local OCR is free and re-running Textract is not.
A teammate who clones this repo must inherit the pages we already paid for
rather than spending their own monthly allowance re-extracting the same files.
Same reasoning as committing `data/index/`, only stronger.

`data/scanned/` — the source PDFs — **is** ignored, under the same rule as
`data/raw/`: partner scans are not ours to publish.

---

## Two design decisions that are visible in the output

### Merged cells are repeated across their span

A header reading `Serve speed` across columns 2 and 3 is written into **both**
columns of the flattened grid. The alternative leaves column 3 headed by an
empty string, and nothing reading the serialised table — a person or the
embedding model — can then tell what that column holds.

The unrepeated truth is kept: each entry in `table.cells` records its real
`rowSpan`/`columnSpan` and appears exactly once. Only the flat `grid` rendering
is redundant. Pinned by tests in
[textractBlocks.test.js](../test/unit/textractBlocks.test.js).

### Table chunks use `modality: "document"`, not `"table"`

`MODALITIES` is `["document", "record", "media"]`
([metadata.service.js:71](../src/modules/ingestion/metadata.service.js#L71)).
Adding `"table"` would be backwards compatible in itself — but `SCHEMA_VERSION`
is part of `configFingerprint()`, so bumping it declares the existing
**99,496-chunk index invalid** and forces a multi-hour full rebuild.

`section: "table"` carries the same information for free, and the retrieval
layer already filters on `section`. Zero schema change.

### Tables never go through `splitText()`

`splitText()` joins on `\s+` and then hard-cuts by character count when a
"sentence" exceeds the target
([chunking.service.js:81](../src/modules/ingestion/chunking.service.js#L81)).
A table put through it comes out as one flat run of numbers with the rows and
columns gone and no signal that anything was lost. `chunkTables()` cuts on row
boundaries instead, and repeats the header row into every part.

### The page number comes from the caller, never from the response

Each request carries a single PNG, so the response describes one image. Its
blocks carry `Page: 1` or no `Page` at all, regardless of which page of the
document the image came from. `blocksToPage(blocks, pageNumber)` takes the real
number as an argument and never reads `block.Page`. Getting this wrong would
file page 7's tables under page 1 and point every citation drawn from them at
the wrong page.

---

## Running it

```bash
# 0. one-time: which scanned files are worth the budget?  (costs nothing)
npm run textract:pick -- "C:/IFN736-project/document-sources"
#    then copy the two you want into data/scanned/

# 1. prove the API works.  costs at most ONE page.
npm run textract:preflight -- data/scanned/your-scan.pdf

# 2. see what a real run would cost.  costs nothing.
npm run textract -- --dry-run

# 3. the real run.  needs TEXTRACT_ENABLED=true in .env
npm run textract

# 4. index the tables, WITHOUT rebuilding the whole corpus
npm run build:index -- --append data/scanned

# 5. evidence
npm run textract:checklist              # writes the blank cell checklist
#    ...fill in the correct? column by hand against the PDF...
npm run textract:checklist -- --score   # scores it
npm run textract:eval                   # retrieval questions
npm run textract:cloudtrail -- --redact-identity
```

### What `--append` does, and what it costs

`buildIndex({ append: true })` continues after the existing shards instead of
building a new index. It exists because a finished build deletes its checkpoint,
so re-running to add two documents re-embeds all 2,599 files over several hours.

What it touches:

| | |
|---|---|
| `chunks-00N.jsonl` / `vectors-00N.i8` | appended to the last shard, rolling to a new one at the size limit |
| `bm25-*` (6 files) | **fully rebuilt** — the second pass re-reads every chunk from disk, which is what makes the old chunks stay covered |
| `manifest.json` | `chunkCount` and `fileCount` accumulate, `sourceDirs` becomes the union |
| `build-report.json` | **merged**, not replaced — it is the list `textract-pick` reads, and overwriting it with a two-file run would delete the record of the other 142 scanned documents |

Three things to know before using it:

- **A document already in the index is skipped, and a run with nothing new is
  refused.** The shards are append-only, so a document's old chunks cannot be
  removed — re-appending the same folder would write a *second copy* of every
  chunk. The index would still load and still search; the only symptoms would be
  an inflated chunk count, skewed BM25 document frequencies, and the same
  passage retrieved twice. If a document has genuinely **changed**, `--append`
  cannot help: rebuild from scratch.
- **It is not checkpointed.** A crash mid-append leaves the shard files longer
  than `manifest.json` claims. That fails *loudly* on the next load — the
  consistency check in
  [vectorStore.service.js:357](../src/infrastructure/vector/vectorStore.service.js#L357)
  catches it — rather than returning nonsense. Recovery is
  `git checkout -- data/index/`, since the index is committed.
- **It rewrites ~130 MB of committed files** (the last chunk and vector shard,
  plus the whole BM25 set). `data/index` is in git, so every appended commit
  grows the repository by roughly that much.

### The preflight is deliberately two-staged

Step 3 of `textract-preflight.js` calls **`DetectDocumentText`**, which bills the
separate **1,000 pages/month** detection allowance, not the scarce 100-page
Tables one. It proves three things at once: the credentials work, `textract:*`
is granted, and our PNG is a format Textract accepts. None of those is worth
discovering with a page of the scarce quota.

Only if that passes does step 4 spend one Tables page, and by then the only
thing left to prove is whether the `TABLES` feature itself is authorised —
which is a **different IAM action** from `DetectDocumentText`.

---

## Where the pieces are

| file | what it does | costs money |
|---|---|---|
| [textractBlocks.js](../src/modules/ingestion/textractBlocks.js) | blocks → page text + table grids. Pure function. | no |
| [textractCache.service.js](../src/modules/ingestion/textractCache.service.js) | the cache and the budget ledger | no |
| [pdfRaster.service.js](../src/modules/ingestion/pdfRaster.service.js) | one PDF page → one PNG | no |
| [textract.service.js](../src/modules/ingestion/textract.service.js) | the send loop, retries, partial failure | **yes** |
| [textract.client.js](../src/config/textract.client.js) | builds the `TextractClient` | no |
| [chunking.service.js](../src/modules/ingestion/chunking.service.js) `chunkTables` | tables → chunks | no |
| [extraction.service.js](../src/modules/ingestion/extraction.service.js) | reads the cache during a build | no |
| `bin/textract-extract.js` | **the only command that sends anything** | **yes** |

Note what is *not* in that list: `src/config/s3.client.js` is an empty
placeholder belonging to a teammate's unpushed storage work, and this story does
not touch it, `storage.service.js`, `storageKey.service.js`, or
`upload.middleware.js`.

The index build reads only the local cache, so **building the index and running
the app need no AWS credentials at all.** Credentials are needed only to extract
a *new* scanned document.

---

## Telemetry

`bin/textract-extract.js` records
`recordApiUsage(API_TYPES.TEXTRACT, { pages, apiCalls, documents })`, which is
the figure TENISE-26 asks for. Under the synchronous API the relationship is
exact rather than estimated: **one `AnalyzeDocument` call is one page.** Retries
are not counted — a throttled page that succeeds on the third attempt is one
page, not three.

With `--source-id <id>` and Mongo running it goes through
`runIngestion(sourceId, { handlers: { extract } })`, which turns that long-stubbed
stage from `not_implemented` into real measured volume. Without Mongo it
measures the same numbers directly and says so — `persistTelemetryRecord`
silently does nothing when Mongo is absent, and a run that *looked* recorded and
was not is worth a warning.

`Source` has no field naming a file on disk, so the handler closes over the
paths rather than the model being changed.

---

## Evidence, per acceptance condition

| condition | artefact | threshold |
|---|---|---|
| Textract really was called | `evidence/tenise-12-textract-run.json`, `evidence/tenise-12-cloudtrail.json` | an `AnalyzeDocument` event |
| cell-by-cell accuracy | `evidence/tenise-12-table-checklist.md` → `evidence/tenise-12-cell-accuracy.json` | ≥ 95% |
| row/column structure | same checklist, indexed by row and column | all aligned |
| tables are retrievable | `evidence/tenise-12-retrieval.json` | ≥ 4 of 5 |
| telemetry page count | `ingestion.byApi.textract.pages` | present and matching |
| caching works | run `npm run textract` twice | second run sends 0 pages |

The checklist orders cells **least-confident first**, so a reviewer working
top-down meets the likely errors immediately. A blank `correct?` counts as *not
reviewed*, never as correct — an unfilled checklist scores nothing rather than a
false 100%.

### Three CloudTrail traps

- Events lag by **up to ~15 minutes**. An empty result straight after a run does
  not mean the call did not happen.
- `lookup-events` is **regional** and retains **90 days**. Querying the wrong
  region returns an empty list that reads exactly like "it never happened".
- Whether Textract's data-plane calls appear in management events at all is not
  guaranteed. If they do not, the fallback first-hand evidence is the
  `AnalyzeDocumentModelVersion` in the run file plus the telemetry page count —
  and the acceptance condition asks for CloudTrail **or** telemetry, not both.

`--redact-identity` replaces `userIdentity` and `sourceIPAddress` with
placeholders. The file is committed to git, and what needs proving is that
`AnalyzeDocument` happened, when, and how often — not who ran it or from where.
See [data-threat-model-and-classification.md](data-threat-model-and-classification.md).

---

## Tests

```bash
npm run test:unit
```

| file | covers |
|---|---|
| `test/unit/textractBlocks.test.js` | grid positioning, merged cells, blank cells, missing relationships, page stamping |
| `test/unit/textractCache.test.js` | cache hits and misses, incomplete-result refusal, budget refusal, month rollover |
| `test/unit/pdfRaster.test.js` | real PNG output from a real PDF, dpi scaling, the 5 MB back-off |
| `test/unit/textractService.test.js` | throttle back-off, partial failure, fatal-error abort, page counting |
| `test/unit/chunkTables.test.js` | structure survives serialisation, schema gate, oversized-table splitting |
| `test/unit/textractPipeline.test.js` | cache → extraction → chunk, end to end, with no credentials present |
| `test/unit/indexAppend.test.js` | `--append` refusing an index built under different settings |

`textractService.test.js` injects the AWS client and the rasteriser. That does
not weaken the acceptance evidence: the rule that stubs are insufficient is
about the **delivered proof**, and everything under `evidence/` comes from a
real run against real scans. Being throttled by AWS on demand is not something a
test can arrange anyway.

`pdfRaster.test.js` uses a real PDF built byte by byte in
`test/unit/helpers/tinyPdf.js` — a fake "PDF" would prove the code runs, not
that it renders.
