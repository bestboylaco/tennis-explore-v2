# Sharing the index so your teammates never run embedding

The whole point of committing the index: **you** spend the GPU hours once,
**they** run `git pull` and query the identical corpus.

Not a rebuild of it — the *identical* one. That distinction matters. If everyone
builds their own, small differences in model version, chunk settings or which
files they happened to have make every result incomparable, and "it works on my
machine" becomes unanswerable.

---

## What gets committed

After a full build, `data/index/` holds:

| File | What it is | Size (128k chunks) |
|---|---|---|
| `chunks-NNN.jsonl` | Text + metadata, one JSON object per line | ~250 MB across shards |
| `vectors-NNN.i8` | Embeddings, int8 quantised | ~130 MB across shards |
| `bm25-*` | Prebuilt keyword index | ~25 MB |
| `manifest.json` | Which model built it, when, with what settings | 1 KB |
| `build-report.json` | Every skipped file and why | small |

**~400 MB total**, in shards each under 90 MB. `.gitignore` is already set up to
include `data/index/` and exclude `data/raw/` — the partner's source documents
must not go into the repo.

### Why it fits at all

Full-precision vectors would be 1.08 GB. Int8 quantisation stores one byte per
dimension instead of four: **4× smaller, ~4× faster to scan, and a measured
0.27% cosine error** — far below anything that reorders results.

Sharding then keeps every file under GitHub's 100 MB hard limit, so this needs
no Git LFS (which would exhaust a free account's 1 GB quota immediately) and no
release assets (which someone has to re-upload on every rebuild).

---

## You: build and publish

```bash
# 1. build. hours. checkpoints, so an interruption is not fatal.
node --max-old-space-size=6144 bin/build-index.js "C:/Users/User/Desktop/TA_S2/document-resources"

# 2. optional: OCR the ~5% that are scanned images, then re-run the build
python tools/ocr/ocr_scanned.py --from-report data/index/build-report.json \
  --source-dir "C:/Users/User/Desktop/TA_S2/document-resources"
node --max-old-space-size=6144 bin/build-index.js "C:/Users/User/Desktop/TA_S2/document-resources"

# 3. sanity check before publishing
npm run search -- --role admin "lumbar bone stress in junior players"
npm run eval:answers

# 4. commit and push
git add data/index
git commit -m "chore(index): full corpus, bge-m3, 128k chunks

Built from TA_S2/document-resources: 2,301 PDFs, 292 decks, 4 tables.
Embedding: bge-m3, 1024d, int8 quantised, N shards.
Skipped files are listed in data/index/build-report.json."
git push
```

## Them: pull and run

```bash
git pull
npm install
ollama pull bge-m3          # to embed their question
ollama pull llama3.1:8b     # to write the answer

npm run ask -- "what does the research say about serve volume?"
```

**No source documents. No GPU-hours. No embedding.** They need `bge-m3` because
their *question* still has to be turned into a vector by the same model that
built the index — but that is one short call, not 128,000 of them.

### If they want the web UI too

```bash
copy .env.example .env
npm start          # needs MongoDB for the source registry
```

`npm run ask` needs neither MongoDB nor the server.

---

## Keeping it honest

**`manifest.json` records which model built the index.** When someone gets odd
results, "which model made this?" is answerable from the repo instead of from
someone's memory.

**Anyone who changes the embedding model must rebuild from scratch.** The build
detects this and refuses to resume, because mixing vectors from two embedding
spaces produces an index that loads without error and returns quiet nonsense.
Delete `data/index/` and start again.

**Citations still work without the source files.** Clicking one calls
`/api/assets/:docId`, which returns `410 ASSET_NOT_LOCAL` with a clear message if
the original PDF is not on that machine. The citation text, page number, authors
and date are all in the index, so the answer stays fully readable — only opening
the underlying file needs the file.

**If the index outgrows this.** Past roughly 200 MB per shard or 2 GB total,
move `vectors-*.i8` to a GitHub release asset and put the download URL in
`manifest.json`. Do *not* switch to "everyone rebuilds their own" — that gives
up the one property this whole arrangement exists to protect.
