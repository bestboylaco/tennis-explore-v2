# Reading the code

Everything lives in **one folder**:

```
C:\Users\User\Documents\Claude\Projects\TennisAUS\tennis-explore-v2
```

Open it in VS Code:

```powershell
cd C:\Users\User\Documents\Claude\Projects\TennisAUS\tennis-explore-v2
code .
```

Open the **folder**, not individual files — that's what gives you go-to-definition
across the project.

Worth installing: **ESLint**, **Python**, and **Error Lens** (shows errors inline
rather than only in the Problems panel).

Two navigation shortcuts do most of the work:

| | |
|---|---|
| `Ctrl+P` | jump to a file by name — type `ranking` and hit enter |
| `Ctrl+Shift+F` | search the whole project |
| `F12` on a function name | jump to where it's defined |
| `Shift+F12` | find everywhere it's used |

---

## Follow one question through the code

This is the most useful way in. A question enters at the top and comes out the
bottom, and every file it touches is listed in order.

```
bin/ask.js                                     you type a question here
  └─ modules/chat/services/answer.service.js   THE ORCHESTRATOR — start here
       ├─ modules/query/queryPlanner.service.js      what kind of question is this?
       ├─ modules/retrieval/retrieval.service.js     go and find evidence
       │    ├─ retrieval/bm25.service.js                  keyword arm
       │    ├─ infrastructure/vector/vectorStore.service.js  meaning arm
       │    ├─ retrieval/accessControl.service.js         who may see what
       │    └─ retrieval/ranking.service.js               fuse + rerank
       ├─ generation/evidenceGrader.service.js       is this evidence any good?
       ├─ query/queryExpansion.service.js            if not, ask again differently
       ├─ generation/contextOrdering.service.js      dedupe, compress, reorder
       ├─ generation/fewShot.service.js              worked examples
       ├─ [the model writes the answer]
       ├─ generation/verifier.service.js             check the citations resolve
       └─ retrieval/citation.service.js              bind [n] back to sources
```

**If you read only one file, read `answer.service.js`.** It is the spine —
everything else is a step it calls.

---

## The map

### Answering a question

| File | Lines | What it does |
|---|---|---|
| `chat/services/answer.service.js` | 569 | **The orchestrator.** Plan, retrieve, grade, generate, verify |
| `query/queryPlanner.service.js` | 377 | Decides: documents or tables? Simple or multi-hop? |
| `query/queryExpansion.service.js` | 129 | Rephrases the question when retrieval comes back thin |
| `retrieval/retrieval.service.js` | 222 | Runs both search arms and fuses them |
| `retrieval/ranking.service.js` | 356 | Reciprocal Rank Fusion, then reranking |
| `retrieval/bm25.service.js` | 329 | Keyword search. Exact terms, rare words |
| `infrastructure/vector/vectorStore.service.js` | 439 | Meaning search. int8 vectors, sharded |
| `retrieval/accessControl.service.js` | 62 | The role filter, applied inside both arms |
| `retrieval/citation.service.js` | 136 | Binds `[3]` in the answer back to a real chunk |
| `retrieval/assetLink.service.js` | 159 | Builds links that open at the right page or second |

### Making the answer good

| File | Lines | What it does |
|---|---|---|
| `generation/evidenceGrader.service.js` | 256 | Judges the evidence *before* answering. Refuses if it's junk |
| `generation/contextOrdering.service.js` | 235 | Removes duplicates, compresses, orders for attention |
| `generation/fewShot.service.js` | 96 | Worked examples — including how to refuse |
| `generation/verifier.service.js` | 104 | Checks citations resolve and numbers are real |
| `retrieval/answerContract.service.js` | 200 | The prompts. Different shape per question type |

### Building the index

| File | Lines | What it does |
|---|---|---|
| `ingestion/indexBuilder.service.js` | 485 | Runs the build. Streaming, resumable, checkpointed |
| `ingestion/extraction.service.js` | 622 | Gets text out of PDF, PPTX, CSV, XLSX, video manifests |
| `ingestion/chunking.service.js` | 484 | Splits into chunks, adds the contextual header |
| `ingestion/metadata.service.js` | 383 | Dates, authors, classification, the schema gate |
| `ingestion/embedding.service.js` | 183 | Talks to bge-m3 through Ollama |

### The rules

| File | What it does |
|---|---|
| `config/retrieval.config.js` | **Every knob in one file.** Read this second |
| `shared/constants/accessControl.js` | Roles, domains, sensitivity levels |
| `shared/constants/queryTaxonomy.js` | The partner's question types, in his words |
| `schema/index-schema.json` | What every indexed chunk must carry |

### Preparing the corpus (Python, separate on purpose)

| File | What it does |
|---|---|
| `tools/prepare_corpus.py` | **The one command.** Detects each file type and routes it |
| `tools/ocr/ocr_scanned.py` | Scanned PDFs → text |
| `tools/media/ingest_media.py` | Video → transcript; images and slide figures → captions |

These are Python because they need PyTorch and a GPU. The rest of the system
needs neither, and keeping them apart is why your teammates can run the chatbot
without installing any of it.

### Commands

| File | Command |
|---|---|
| `bin/ask.js` | `npm run ask -- "..."` |
| `bin/search.js` | `npm run search -- "..."` — retrieval only, no model writing |
| `bin/build-index.js` | the index build |
| `bin/eval-answers.js` | `npm run eval:answers` |
| `bin/check-models.js` | `npm run check:models` |

---

## Where things aren't

Worth knowing so you don't go looking:

- **`data/index/`** is generated, not written by hand. Three shards of chunks,
  their vectors, and the keyword index.
- **`src/config/qdrant.client.js`** and **`s3.client.js`** are empty
  placeholders from the original scaffold. Nothing uses them — the vector store
  is files, and there's no S3 client because ingestion reads local folders.
- **`src/modules/assistant/`** is also empty scaffold; that work ended up in
  `modules/generation/` and `modules/retrieval/`.

---

## The comments are the documentation

Nearly every non-obvious decision has a comment saying **why**, not what. If
something looks strange, the reason is usually directly above it. For example,
in `vectorStore.service.js`:

```js
// clamped rather than wrapped. a component marginally outside [-1, 1] from
// floating point error would otherwise wrap from +127 to -128 and turn the
// single strongest dimension of a vector into its strongest NEGATIVE one,
// which is the sort of bug that produces quietly terrible results.
```

Those notes are where the real reasoning lives — several of them record bugs
that actually happened.

---

## Running one piece in isolation

You don't need the whole app to poke at something:

```powershell
node --input-type=module -e "
const { ruleBasedPlan } = await import('./src/modules/query/queryPlanner.service.js');
console.log(ruleBasedPlan('how many matches were played on each surface?'));
"
```

Or run one test file and read it as a spec — the tests describe intended
behaviour more precisely than any prose:

```powershell
node --test test/unit/queryPlanner.test.js
node --test test/unit/accessControl.test.js
```

`test/unit/accessControl.test.js` is a good place to start reading: it's written
as *"prove the wrong person is refused"* rather than *"prove the right person is
allowed"*, because the second passes even when the filter is missing entirely.
