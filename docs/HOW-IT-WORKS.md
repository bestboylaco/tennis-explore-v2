# How it works

A technical summary: what happens to a question, how ranking works, what an
industry deployment would swap out, and what stays.

---

## What the model actually sees

**Never a whole document.** That is worth stating plainly because it is the most
common misconception about these systems.

A 40-page paper is ~120,000 characters. An 8B model has an 8,000-token window,
about 32,000 characters, and quality degrades well before that ceiling — models
demonstrably lose material in the middle of a long context. So the pipeline never
passes documents; it passes **chunks**.

| Stage | Size |
|---|---|
| A document | 10,000 – 300,000 chars |
| One chunk | ~1,600 chars (~400 tokens) |
| Retrieved before filtering | ~25 chunks |
| After grading drops the irrelevant | ~10–14 chunks |
| After compression, per chunk | ~900 chars |
| **Total reaching the model** | **≤ 12,000 chars** |

So roughly **eight pages' worth of the most relevant paragraphs**, drawn from
across several documents — never one document in full.

---

## Ranking, in order

### 1. Two arms, run independently

**BM25** matches literal strings. A 1990s ranking function, still here because it
returns the exact token you typed: `M-CH-AUS-2025-005`, `Gescheit`, `facet
joint`. An embedding model turns those into a fuzzy point in space and
cheerfully returns a neighbouring tournament code.

Its score has two parts. **IDF** — how surprising is this word — so a match on
"periodisation" counts far more than a match on "tennis" in a corpus where every
document says tennis. And **term frequency with saturation**: five mentions beat
one, but fifty do not beat five by much, which stops a document winning by
repetition alone. Length normalisation then stops long documents winning simply
by containing more words.

**Dense retrieval** matches meaning. Every chunk was turned into 1,024 numbers by
bge-m3; the question is turned into 1,024 numbers by the same model; similarity
is the dot product. This is what finds "fatigue monitoring" when the paper says
"accelerometer load".

Both arms are filtered by role **before** either produces a ranked list. Not
after — a post-filter lets a forbidden chunk take one of the k slots and then get
dropped, silently shortening the result set.

### 2. Reciprocal Rank Fusion

The two arms produce scores on completely different scales: BM25 is unbounded
(0 to 40+), cosine similarity sits in [-1, 1], and both shift per query. Any
fixed `alpha` in `alpha·bm25 + (1-alpha)·dense` is really tuned to whichever
query you looked at last.

So fusion ignores scores entirely and uses only **position**:

```
score(d) = Σ  1 / (k + rank(d, list))          k = 60
```

A chunk ranked 1st by BM25 and 3rd by dense scores `1/61 + 1/63`. A chunk ranked
1st by one arm and absent from the other scores `1/61`. **Agreement between two
methods that fail differently is the signal** — there is nothing to tune and
nothing to drift.

`k` damps how much the top positions dominate. The curve is flat above ~30; 60
is the value from the original Cormack et al. paper.

### 3. Reranking

RRF orders by agreement between the arms; it never reads the question *against*
the passage. A reranker does, which is how it catches the case both arms get
wrong for the same reason — an incidental shared keyword.

Ours scores passages in batches with the chat model, constrained to a JSON
schema. A real cross-encoder is better (it reads query and passage together
through full attention, which is exactly what a bi-encoder cannot do) and there
is a 40-line server in `tools/rerank/` for it. Optional, ~1.1 GB more VRAM.

### 4. Grading — the refusal step

Retrieval **always** returns something. Ask about a document we do not hold and
you still get ten chunks; they are just ten irrelevant ones. A model handed ten
irrelevant passages writes a confident wrong answer, because from where it sits
ten real passages about tennis look like grounds to answer.

So before generating, each passage is judged for relevance. Two cheap signals
first — how many chunks both arms found, and what fraction of the question's
*proper nouns and years* appear anywhere in the evidence. That second one is
what catches "Djokovic's serve speed at the 2019 Australian Open": plain word
overlap scores well against any tennis corpus, but "djokovic" and "2019" appear
nowhere, and that is the whole signal.

If nothing is relevant, **no model call is made at all**. The one situation
where a model must not improvise is the one where it has nothing to improvise
from.

### 5. Preparing the context

- **Deduplication.** The corpus holds the same deck three and four times.
  Measured: 4.2% of chunks are near-duplicates. Without this the model reads one
  paragraph four times and it looks like four corroborating sources.
- **Compression.** A 1,600-char chunk usually earns its place on two or three
  sentences; the rest helped retrieval find it and does nothing for generation.
- **Attention ordering.** Strongest evidence first *and* last, weakest in the
  middle — the position models are most likely to skim.

### 6. Generation and verification

Few-shot examples demonstrate the citation format and, importantly, demonstrate
*refusing*. A model that has never seen a refusal will not produce one.

Afterwards the answer is checked mechanically — not by a second model, which
shares the first one's failure modes and mostly rubber-stamps. Every `[n]` must
resolve to a supplied chunk; every number must appear in a source.

---

## What the citation numbers mean

They are the **position of the evidence block in the list shown to the model** —
not a document ID, not a global reference number.

The model is handed ~10–14 numbered blocks and cites the ones it used. If you see
`[5]`, `[7]`, `[9]`, `[10]`, those were blocks 5, 7, 9 and 10 of what it was
shown; blocks 1–4, 6 and 8 were retrieved and not used. That is why the numbers
look non-contiguous — the gaps are evidence the model chose not to draw on, which
is information rather than a bug.

---

## Structured questions take a different path

"How many matches on each surface" cannot be answered by retrieval — **no chunk
contains that count**, because nobody ever wrote it down. Retrieval can only find
text that already exists.

So table questions are routed away from retrieval entirely. The model fills in a
**query spec** — table, filters, groupBy, metrics — which is validated against
the real schema (unknown column, wrong aggregate, `avg` on a text column all
rejected with a message naming the valid options, fed back for one retry). Our
own engine executes the spec, and the SQL you see is **rendered afterwards for
display**. No model-written SQL is ever executed.

---

## What industry would replace

| Ours | Production | Why |
|---|---|---|
| Files in `data/index/` | Qdrant, OpenSearch, pgvector | Concurrent writes, live updates, replication. Ours is read-only and rebuilt whole |
| Brute-force int8 scan | HNSW / IVF-PQ index | Fine to a few million chunks. Past that, sub-linear search is worth the recall cliff |
| Local folder ingestion | S3 event → SQS → worker | Documents arrive continuously, not in one overnight batch |
| Ollama on one GPU | vLLM / TGI, or a hosted API | Batching, concurrency, autoscaling. Ollama serves one request at a time |
| LLM-scored reranking | A dedicated cross-encoder service | Better and ~50× faster |
| Role from a request field | SSO / OIDC session claims | **Non-negotiable.** A caller who picks their own role has every role |
| Table-level ACL | Row-level security in the database | "This coach may see *their* squad's rows" |
| Rebuild the whole index | Incremental upsert by document | Re-embedding 100k chunks to add one paper is absurd at scale |

**What does not change:** chunking, the contextual headers, the schema gate, ACL
enforcement inside both arms, RRF, grading, citation binding, verification. All
of it is written against interfaces rather than the filesystem, and none of it
assumes a single machine.

The honest summary: **the retrieval logic is production-shaped; the
infrastructure is not.** That is the right way round for a project at this stage
— the logic is what is expensive to get right, and swapping a file-backed store
for Qdrant is a week's work against a settled design.

---

## Numbers, measured on this corpus

| | |
|---|---|
| Documents indexed | 2,599 files → **99,496 chunks** |
| Build time | 62 minutes |
| Index on disk | 3 shards, int8 quantised |
| Keyword index | 359,290 terms, 11.9M postings |
| Skipped | 168 files (~6%), scanned images with no text layer |
| int8 accuracy cost | 0.27% cosine error |
| Near-duplicate chunks | 4.2% |
| Vector scan | ~145 ms at this size |
