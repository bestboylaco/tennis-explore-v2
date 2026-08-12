# How to run this

Written for someone who has not used Node before. Every command is meant to be
copied exactly. If a step fails, the "when it goes wrong" section at the bottom
probably has it.

There are two separate things in this repo and it helps to keep them apart:

| | What it is | Needs |
|---|---|---|
| **The pipeline** | Reads documents, makes the search index, answers questions from the command line | Node + Ollama |
| **The web app** | The chat interface the team built, `npm start` | Node + Ollama + MongoDB |

You can do everything in this guide with just the pipeline. MongoDB is only
needed if you want the browser UI.

---

## 1. Install the three things you need

**Node.js 20 or newer** — <https://nodejs.org>, take the LTS installer.
Check it worked:

```bash
node --version
```

**Ollama** — <https://ollama.com/download>. This is what runs the AI models on
your own machine, so no data leaves your computer.

```bash
ollama --version
```

**Git** — <https://git-scm.com/downloads>, if you do not already have it.

---

## 2. Get the code and install its libraries

```bash
git clone https://github.com/bestboylaco/tennis-explore-v2.git
cd tennis-explore-v2
npm install
```

`npm install` downloads the libraries the project depends on into a
`node_modules` folder. It takes a minute and you only do it once.

---

## 3. Pull the models

```bash
ollama pull bge-m3
ollama pull llama3.1:8b
```

About 7 GB in total, downloaded once.

- **bge-m3** turns text into vectors so we can search by meaning. 1024 numbers
  per chunk, ~2.3 GB of video memory.
- **llama3.1:8b** writes the answers, and also scores passages for reranking. ~4.7 GB.

**Do not try `ollama pull bge-reranker-v2-m3`.** It fails — that model is not in
Ollama's library, and Ollama has no rerank endpoint anyway: it serves a
reranker's embedding layer but not its classification head, so there would be
nothing to call. Reranking runs through the chat model instead, in batches, and
needs nothing extra.

If you want a *real* cross-encoder (better, ~1.1 GB more VRAM):

```bash
pip install fastapi uvicorn sentence-transformers
python tools/rerank/rerank_server.py
```

then set `RERANK_STRATEGY=service` and `RERANK_API_URL=http://localhost:8787/rerank`
in `.env`.

Check they are all there:

```bash
npm run check:models
```

> **On an 8 GB card**, all three together is a tight fit. Ollama handles this by
> swapping models in and out of memory as needed, so the first answer after an
> index build takes longer and the ones after it are quick. That is normal.

---

## 4. Set up your settings file

```bash
copy .env.example .env      # Windows
cp .env.example .env        # Mac / Linux
```

The defaults are fine. Open `.env` only if you want to change the model or the
retrieval settings — every option is commented.

---

## 5. Build the index

This is the slow step. It reads every document, splits it into chunks, and sends
each chunk to the embedding model.

```bash
npm run build:index -- "C:/Users/You/Desktop/TennisAU/DOCUMENTS" "C:/Users/You/Desktop/TennisAU/MATCH_DATA" "C:/Users/You/Desktop/TennisAU/RANKINGS"
```

Note the `--` after the script name. That is npm's way of saying "everything
after this belongs to the script, not to npm". It is easy to forget and the error
you get is confusing.

Use forward slashes in paths even on Windows, and put quotes around any path with
a space in it.

**What it can read:** PDF, PPTX (one chunk per slide), CSV, XLSX, TXT, MD, and a
video segment manifest (`data/video/video-segments.json`). You can pass single
files as well as folders.

You will see:

```
found 12 readable files
331 chunks ready, all passed schema v2
embedding 331/331 (100%)  ~0s left

index built in 412.8s
  331 chunks from 12 files
  written to data/index/
```

### How long this takes on the real corpus

The partner library in `TA_S2/document-resources` is 17 GB — 2,301 PDFs and 340
presentations. Measured, not guessed:

| | |
|---|---|
| Chunks produced | **~128,000** (43.5 per PDF, from a 400-file sample) |
| Text extraction | ~20 minutes |
| Embedding with bge-m3 | **2–4 hours** on an 8 GB card |
| Peak memory | ~1.5 GB (flat — the build streams) |
| Index on disk | ~400 MB, int8 quantised, sharded |

Run it overnight:

```bash
node --max-old-space-size=6144 bin/build-index.js "C:/Users/User/Desktop/TA_S2/document-resources"
```

**It checkpoints.** If it crashes, you close the laptop, or you hit Ctrl-C,
re-running the exact same command picks up where it stopped instead of starting
again. Progress is saved every 25 files.

If you change the embedding model or chunk size, it will **refuse** to resume and
tell you why — mixing vectors from two models into one index produces a file that
loads fine, searches fine, and returns nonsense.

It writes into `data/index/`:

- `chunks-NNN.jsonl` — text and metadata, one JSON object per line
- `vectors-NNN.i8` — the embeddings, int8 quantised
- `bm25-*` — the keyword index, prebuilt so startup does not re-tokenise it
- `manifest.json` — which model built it, when, with what settings
- `build-report.json` — every file that was skipped, and why

**Why int8?** Full-precision vectors for this corpus would be 1.1 GB. Quantising
to one byte per dimension makes it ~270 MB, which fits in normal git, and makes
the search about four times faster. The measured cost is a 0.27% cosine error —
far below anything that changes the ranking.

**Why sharded?** GitHub rejects files over 100 MB. Shards are capped below that,
so the index commits to an ordinary repo with no Git LFS and no release assets.

**If the build fails on a schema error, nothing is written.** That is deliberate.
The message names every chunk that failed and why, so you can fix them all in one
go rather than one per run.

---

## 6. Try it

**Search only** — no AI writing, just "what did retrieval find". This is the tool
for checking whether retrieval works, separately from whether the model writes a
good answer.

```bash
npm run search -- "accelerometer load during tournaments"
npm run search -- --role analyst "athlete heart rate monitoring"
```

**Full answer with citations:**

```bash
npm run ask -- "how does serve load differ between training and tournaments?"
npm run ask -- --role physiotherapist "what does the research say about injury risk?"
```

You get the answer, then a numbered source list, then warnings if the model cited
something that does not exist or used a number that appears in no document.

**The roles** are: `admin`, `academy_coach`, `tour_coach`, `analyst`,
`strength_conditioning`, `physiotherapist`, `member_services`, `athlete`.

Try the same question as `admin` and then as `analyst` — the analyst is denied
physiological data, so you should see fewer results. That is the access control
working, and it is worth demonstrating in a review.

**Ask a question about the tables** — these get computed, not retrieved:

```bash
npm run ask -- "how many matches were played on each surface?"
npm run ask -- "what is Carlos Alcaraz's best ranking?"
```

You get the sentence, the table, and the query that produced it. See
[`docs/QUERY-HANDLING.md`](QUERY-HANDLING.md) for why these take a different
path from document questions.

**See the full response payload** the frontend receives:

```bash
npm run ask -- --json "compare wins on hard versus clay"
```

**Measure it:**

```bash
npm run eval          # retrieval only: seven configurations compared
npm run eval:answers  # the whole assistant against the gold question set
```

`npm run eval` writes `evidence/strategy_comparison.json`.
`npm run eval:answers` runs the gold set in `queries/gold_set.json` and checks
routing, sources, grounding and — most importantly — that the assistant refuses
the questions it cannot answer. It writes `evidence/answer_evaluation.json`.

---

## 7. Using a bigger embedding model

You asked about this specifically. The trade-off is real but smaller than people
expect — the gap between a good 1024-dimension model and the top of the
leaderboard is a few points, while indexing time roughly doubles.

To switch, change **two** lines in `.env` and rebuild from scratch:

```bash
EMBEDDING_MODEL=qwen3-embedding:0.6b
EMBEDDING_DIMENSION=1024
```

| Model | Dims | VRAM | Comment |
|---|---|---|---|
| `nomic-embed-text` | 768 | 0.3 GB | smallest, fastest, noticeably weaker |
| `mxbai-embed-large` | 1024 | 0.7 GB | fast, but only a 512-token context window |
| `qwen3-embedding:0.6b` | 1024 | 1.5 GB | best quality-per-GB on an 8 GB card |
| **`bge-m3`** | **1024** | **2.3 GB** | **the default. 8k context, strong on rare terms** |
| `qwen3-embedding:4b` | 2560 | ~8 GB | only if you free the card of everything else |

**Two things that will bite you:**

1. **The dimension must match the model.** If they disagree the build stops on the
   very first batch with a message telling you what to set. It checks the first
   vector rather than the last, so you find out in one second, not forty minutes.
2. **You must rebuild the whole index.** An index is only readable by the model
   that made it. Mixing vectors from two models produces search results that look
   plausible and are meaningless. Delete `data/index/` first:

```bash
rm -rf data/index          # Mac / Linux
rmdir /s /q data\index     # Windows
```

Raising `EMBEDDING_BATCH_SIZE` from 16 to 32 makes indexing faster if you have
headroom. If your machine starts swapping, put it back — a batch too big for the
card is much slower, not faster.

---

## 8. Giving the index to your teammates

This is the part that makes the work usable by everyone else. The index is three
plain files, so it goes in the repo:

```bash
git add data/index .env.example
git commit -m "chore(index): rebuild with bge-m3, 7268 chunks"
git push
```

Your teammates then run:

```bash
git pull
npm install
ollama pull bge-m3          # to embed their question
ollama pull llama3.1:8b     # to write the answer
npm run ask -- "what does the research say about serve volume?"
```

**They do not need to build an index and they do not need the source PDFs.**
They do still need `bge-m3`, because their *question* has to be turned into a
vector by the same model that made the index before it can be compared against
it. What they save is the 20-minute build and the partner's raw documents.

Keep `manifest.json` in the commit. It records which model built the index, so
when someone gets odd results the first question — "which model made this?" — has
an answer in the repo rather than in someone's memory.

If the index ever grows past about 200 MB, attach `vectors.bin` to a GitHub
release instead of committing it, and put the download URL in the manifest. Do
not switch to "everyone builds their own" — then you are no longer comparing the
same thing.

---

## When it goes wrong

**`could not reach ollama at http://localhost:11434`**
Ollama is not running. Start it with `ollama serve`, or open the Ollama app.

**`ollama does not have the model "bge-m3"`**
`ollama pull bge-m3`.

**`no index found at data/index`**
You have not run step 5 yet.

**`model returns 768-dimension vectors but the config says 1024`**
Your `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` disagree. Fix `.env`, delete
`data/index/`, rebuild.

**`index is inconsistent: 331 chunks x 1024 dims should be...`**
A build was interrupted partway. Delete `data/index/` and rebuild.

**`retrieve requires a roleId`**
Something called retrieval without saying who is asking. There is no default role
on purpose — a default would mean forgetting to pass one still returns documents.

**The assistant says the knowledge base has no answer, but I know it does**
Run `npm run search` with the same question. If the chunk is not in that list,
retrieval missed it — try rebuilding with a real embedding model rather than the
hash stand-in. If it *is* in the list, the model abstained when it should not
have; that is a generation problem, not a retrieval one.

**A table question returns "no table holds this information"**
The spec planner could not map your wording onto a column. `npm run ask --json`
shows the reason. Column names come from the file headers, so ask using words
that appear in them.

**Everything runs but the answers are vague and generic**
Run `npm run search` with the same question first. If the right chunk is not in
that list, the problem is retrieval and no amount of prompt-tuning will fix it.
If it *is* in the list and the answer still ignores it, that is a generation
problem.

**`Missing required environment variable: MONGODB_URI`**
Only `npm start` needs MongoDB. The pipeline scripts do not touch it — use
`npm run ask` instead.

**Some files were skipped**
Normal — about 5% of the corpus is scanned images with no text layer. Every one
is named in `data/index/build-report.json`. To read them, run OCR:

```bash
pip install surya-ocr pypdfium2          # GPU, best accuracy
# or: pip install pytesseract pypdfium2  # CPU fallback

python tools/ocr/ocr_scanned.py --from-report data/index/build-report.json \
  --source-dir "C:/Users/User/Desktop/TA_S2/document-resources"
```

It writes text sidecars into `data/ocr-cache/`. Re-run the index build and it
picks them up automatically — and because the build resumes, only the newly
readable documents get embedded. Add `--dry-run` first to see what it would do.

**The 48 `.ppt` files are ignored**
`.ppt` is a binary format unrelated to the zip-based `.pptx`. Convert them first:

```bash
soffice --headless --convert-to pptx --outdir converted/ *.ppt
```

**The build says it will not resume**
You changed the model, the dimension or the chunk size since the last run.
Either put the old setting back, or delete `data/index/` and start fresh.

**JavaScript heap out of memory**
Pass more heap: `node --max-old-space-size=6144 bin/build-index.js ...`

**I want to test without downloading any models**

```bash
EMBEDDING_PROVIDER=hash EMBEDDING_DIMENSION=256 npm run build:index -- ./data/raw
```

This runs the entire pipeline with a fake offline embedder. It proves the
plumbing works. The search results will be nonsense and every tool will warn you
about it — never demo with it.
