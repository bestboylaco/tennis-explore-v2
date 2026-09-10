# Textract extraction cache — COMMITTED ON PURPOSE

This directory is in git. `data/ocr-cache/` next door is not. That is not an
inconsistency.

Re-running the local OCR tool is free, so its output is a build artefact and
gets ignored. Textract output is **paid for against a hard 100-page monthly
cap** that cannot be topped up. A teammate who clones this repo must inherit the
pages we already paid for rather than spending their own allowance re-extracting
the same documents.

Same reasoning as committing `data/index/`, only stronger — an index can be
rebuilt on any machine for the price of some electricity.

## What is in here

| file | what it is |
|---|---|
| `<docId>.<sha12>.json` | one extracted document: page text, table grids, per-cell confidence |
| `usage.json` | the monthly page ledger, `{ "2026-08": { pages, calls } }` |

The `<sha12>` is the first 12 hex characters of the sha256 of the **source
file's bytes**. Lookup matches on that suffix, not on the filename, so a
document that has been renamed or re-synced from S3 still hits. Change the file
and you get a miss, which is correct — different bytes are a different document.

## Two things not to do

**Do not hand-edit `usage.json` to free up budget.** It is the only record of
what has been spent this month, and the number it holds is the one thing
standing between a mistyped command and an empty allowance.

**Do not delete an entry to "force a re-extract".** Use
`npm run textract -- --force`, which goes through the budget check. Deleting the
file bypasses nothing but does lose the paid-for result if the re-run fails.

## Entries are only written for complete documents

An extraction that lost even one page is deliberately **not** cached. Caching a
partial result would make every later run report a hit, leave the missing page
invisible forever, and remove any pressure to notice — because the run now costs
nothing. See `writeCache` in
[textractCache.service.js](../../src/modules/ingestion/textractCache.service.js)
and [docs/TEXTRACT.md](../../docs/TEXTRACT.md).

The source PDFs themselves are **not** committed — `data/scanned/` is ignored,
under the same rule as `data/raw/`. They are partner scans.
