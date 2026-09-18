# Retrieval design and the evidence for it

**TENISE-15 / E3-09**, **TENISE-17 / E3-11**, **TENISE-21 / E4-15** · Zaina Ilyas

Why the pipeline is shaped the way it is, and what the current literature
actually supports. Every technique here is either on with a reason or off with a
reason — nothing is present just because it is fashionable.

---

## The pipeline

```
question
   │
   ├─ classify ─────────► entity lookup / factual / conceptual / multi-hop
   │
   ├─ decompose ────────► only for multi-hop
   │
   ├─ BM25 arm ─────┐    access filter applied INSIDE both arms
   ├─ vector arm ───┤
   │                │
   ├─ RRF fusion ◄──┘
   │
   ├─ assert access invariant
   │
   ├─ cross-encoder rerank
   │
   ├─ cut to top N
   │
   └─ generate ─────────► bind [n] citations back to chunks
```

---

## What is on, and why

### Hybrid BM25 + dense, fused with RRF — **on**

The two arms fail in opposite directions. BM25 matches literal strings, which is
what you need for `M-CH-AUS-2025-005`, a player surname, or `rotation_magnitude`;
an embedding model turns those into a fuzzy point in space and cheerfully returns
a *different* tournament code that sits nearby. Dense retrieval matches meaning,
which is what you need when a coach asks about "fatigue monitoring" and the paper
says "accelerometer load". Dense-only RAG failing on rare terms is a
well-documented, repeatable failure.

Fusion is by **Reciprocal Rank Fusion**, not a weighted score blend, because BM25
scores and cosine similarities live on different unnormalised scales that shift
per query — any fixed `alpha` is really tuned to whichever query you looked at
last. RRF uses only rank position, so there is nothing to tune. `k = 60`, the
value from the original Cormack et al. paper; the curve is flat above about 30.

Reported gains are consistent: a tuned hybrid setup reaches 0.7497 NDCG on the
WANDS benchmark against 0.6983 for BM25 and 0.6953 for vectors alone.

### Contextual retrieval — **on, and the biggest single win**

Each chunk gets a short header naming the document, section, date and authors
*before* it is embedded and *before* it is tokenised for BM25.

The problem it solves: a chunk cut from the middle of a paper reads *"this
increased by 12% in the second block, which is consistent with the earlier
finding."* Nothing in that sentence says what "this" is or which paper it came
from, so it is effectively unretrievable. Anthropic measured a **49% drop in
retrieval failures** from adding the header, and **67% when combined with
reranking**. Independent benchmarking agrees that contextual retrieval yields
consistent gains where query-expansion tricks do not.

Two modes. `template` builds the header from metadata we already hold — free and
instant. `llm` asks the local model to write a situating sentence per chunk —
better, but one model call per chunk, so budget an hour or two for a corpus this
size. Template is the default.

### Cross-encoder reranking — **on**

RRF orders by *agreement between the arms*; it never reads the query against the
passage. A cross-encoder does, so it catches the case where both arms rank
something highly for the same wrong reason — an incidental shared keyword.

This is the largest precision gain after hybrid itself: hybrid plus neural
reranking reaches Recall@5 of 0.816 against 0.695 for hybrid RRF alone.

It degrades rather than failing. If the reranker model is missing, the fused
order is returned with `reranked: false` and a reason, because a slightly worse
ordering beats a chat endpoint that 502s over an optional model.

### Query routing — **on**

Our own numbers are the argument. On the 22-query set, hybrid takes hit@10 from
0.955 to 1.000 and MRR from 0.827 to 0.867 — but the entire gain sits on
paraphrased questions (`acl-sensitive` 0.50 → 0.75 MRR, `documentary`
0.731 → 0.781), while exact-match lookups were already 1.0 on BM25 alone and gain
nothing for an extra ~2.4 seconds.

So an entity lookup gets a much smaller vector budget. It never gets *zero* —
a misclassified conceptual question must cost milliseconds, not correctness.

### Query decomposition — **on, gated to multi-hop**

*"How did serve load in the national academy compare with the pro tour squad"* is
two retrievals. Embedding the whole sentence gives a vector sitting between both
topics and close to neither. So we split, retrieve each part, and fuse the
results with the same RRF — adding a source to rank fusion is just adding a list.

The literature is clear that this helps on multi-hop questions specifically and
does nothing for simple lookups, which is why the router gates it rather than it
running on everything.

### Chunking per file type — **measured on our corpus (E2-07)**

The live index uses 1600-character prose chunks with a 200-character overlap and
one CSV row per chunk. Until E2-07 those numbers were defended only by citing
other people's benchmarks. They are now defended by
`evidence/chunking_comparison.json`: four indexes built from the same 27 partner
files (26 research PDFs, 1 match CSV) under `data/index-eval/<cell>/`, scored on
15 questions whose answer spans were verified verbatim in the source *before* any
cell was built. Every per-file-type value now lives in
`retrievalConfig.chunking` (`rowsPerChunk`, `recordMaxChars`,
`fallbackMinChars`, `slideMinChars`, `tableHeadroomChars`) instead of as
literals in `chunking.service.js`.

**What was measured.** Hybrid RRF with the reranker, router, HyDE and
decomposition all off — one variable per comparison. A hit is a single top-5
chunk whose `text` (never the context header) wholly contains the normalised
span. The tie-break rule was registered before scoring: recall@5, then span-MRR,
then index cost, then the status quo; 10 points is the threshold at every step.

| cell | prose recall@5 | prose span-MRR | records recall@5 | records span-MRR | chunks | bytes |
|---|---|---|---|---|---|---|
| `t1600-o200-r1` (live) | 8/8 | 0.656 | 6/7 | 0.786 | 812 | 3.68 MB |
| `t800-o200-r1` | 8/8 | **0.854** | 6/7 | 0.786 | 1496 | 5.50 MB |
| `t1600-o0-r1` | 8/8 | 0.781 | 6/7 | 0.786 | 805 | 3.51 MB |
| `t1600-o200-r5` | 8/8 | 0.656 | **5/7** | 0.566 | 734 | 3.50 MB |
| `t800-o0-r1` (combination check) | 8/8 | **0.917** | 6/7 | 0.786 | 1471 | 5.09 MB |

**Records: one row per chunk, now a decision rather than an assumption.** Packing
five rows per chunk (`rowsPerChunk=5`, 98 → 20 record chunks of ~4,800 chars)
dropped record recall@5 from 6/7 to 5/7 and span-MRR from 0.786 to 0.566: one
question fell out of the top 10 entirely and two others slipped from rank 1 to
ranks 2 and 3. That is a 14-point loss, above the threshold, so the rule keeps
`rowsPerChunk=1`. Packing also carries a cost the scores do not show: a chunk has
one `event_date`, so five rows with five dates are filed under the first row's
date for the query-time filter (`event_date_span` records the true range).

**Prose: recall@5 did not separate the cells; span-MRR did.** All four cells
retrieved every prose span in the top 5 (8/8), so on this question set the
chunking parameters do not change *whether* the passage is found, only how high
it ranks. On rank, 800-character chunks beat 1600 by 19.8 MRR points and
zero overlap beat 200 by 12.5 points — both above the threshold, so the
registered rule picks `targetChars=800` and `overlapChars=0` for prose. Two
things stop that from being an automatic change to the live default:

- **Effect size is unknowable at n=8.** A Wilson interval at this size is about
  ±25 points; the harness measures direction, not magnitude. The MRR gains are
  consistent in direction across the questions (no prose question got worse
  under either challenger) but they are not a precise estimate.
- **The live index has 103,708 append-only chunks**, so adopting either value
  means a full rebuild of several hours, not a config change.

The two wins were then checked together. `t800-o0-r1` changes both variables
against the same baseline — it is a combination check, not a fourth
single-variable comparison, and it says only whether the two gains survive each
other, not which variable earned them. They do: prose span-MRR reached 0.917,
the highest of the five cells, with recall still 8/8 and no span severed; the
record questions were unaffected, as they must be. Read alongside the
single-variable cells this is consistent: smaller chunks put the right passage
higher, dropping the overlap helps a little more, and neither costs recall on
this corpus. The cost is index size — 1,471 prose chunks and 5.09 MB against
812 and 3.68 MB — about 40% more bytes for the same corpus.

So the live defaults stay at 1600/200 for now, with the evidence recorded and a
rebuild decision left to the team: the registered rule's recommendation for
prose is `targetChars=800, overlapChars=0`, and the combination has been
measured. The literature claim this section used to rest on — that overlap buys
no measurable retrieval benefit — is now a finding on our own corpus: overlap
did not help recall, and cost 0.17 MB and 12.5 MRR points. The 800-character
result agrees with the ~200-token region most RAG guidance converges on.

**Confounds, stated rather than hidden.** `minChars` is applied *after* the
overlap tail is prepended (`splitText`, final filter), so a short trailing
fragment survives at overlap 200 and is dropped at overlap 0; that is why the
overlap-0 cell has 707 prose chunks against 714, and it biases *against*
overlap 0 by removing content. Prose here is PDF only (the corpus holds no
`.txt`/`.md`; `.docx` is unsupported by `extractFile`), all three go through the
same `chunkDocument` path. No `.pptx` exists, so `slideMinChars` is in config
without evidence. PDFs with Textract tables were excluded because `chunkTables`'
budget also depends on `targetChars`. The deterministic control passed: record
chunks are byte-identical between `t1600-o200-r1` and `t800-o200-r1`, and their
seven record outcomes and ranks matched exactly. `authors.slice(0, 3)` and
`detectSection`'s 200-character window were deliberately left as literals — they
are not per-file-type, and both feed the context header rather than the chunk.

The one prose question that failed nowhere and the one record question that
failed everywhere (CQ-09, a Wimbledon result among eight Wimbledon rows) are
both in `perQuestion` in the JSON, with the chunk ids, so any number above can
be traced to a specific chunk.

---

## What is off, and why

### HyDE — **off by default**

HyDE writes a hypothetical answer and searches with *its* embedding, on the
theory that answers resemble answers more than questions do.

It is implemented and it works. It is off because the current evidence does not
support it: the 2026 text-and-table retrieval benchmark measured HyDE **below
plain dense retrieval**, and related work found hypothetical-document methods
score lower precision than baseline. Query-expansion methods in general give
limited benefit on precise numerical queries — which is a large share of what
coaches ask.

It stays behind a flag so `npm run eval` can demonstrate that on *our* corpus
rather than us quoting someone else's benchmark. "We tested HyDE and it did not
help here" is a more useful thing to say in a review than "we implemented HyDE".

### An ANN index (HNSW / FAISS) — **not yet**

At 7,000 chunks a brute-force scan is roughly 7 million multiply-adds, a few
milliseconds. An approximate index would add a dependency and a recall cliff to
optimise something that is not the bottleneck. Revisit past a few hundred
thousand chunks.

### A vector database server — **deliberately not**

Qdrant or OpenSearch would mean every teammate runs their own server and builds
their own index, and then nobody is comparing the same thing. Three committed
files mean one command to reproduce exactly what was evaluated.

---

## Access control

Enforced **inside both arms, before either produces a ranked list** — never as a
post-filter.

This is not an optimisation. A post-filter lets a forbidden chunk occupy one of
the k slots and then get dropped, silently shortening the result set: a coach
gets 6 results where they should have 10, the leak is invisible, and the answer
is quietly worse. Filtering first means the forbidden chunk never competes.

`assertAccessInvariant` then re-checks after fusion and **throws**. It should
never fire. It exists because the failure it guards against — a refactor dropping
the filter — produces a perfectly fluent answer built on data the caller should
never have seen, and nobody would ever notice.

The model has three axes: what kind of data (`domain`), how sensitive
(`sensitivity`, using Tennis Australia's own classification vocabulary), and
which program owns it. A role expands to a set of flattened grant strings; access
is a set intersection. Details and the reasoning for each role are in
`src/shared/constants/accessControl.js`.

One design note worth repeating: the first version scoped by gender. That was
wrong. A men's squad coach is not denied women's data because of gender, they are
denied it because those athletes are not theirs. The real boundary is which
program you work in, and scoping permissions by a protected attribute is both
arbitrary and indefensible in a governance document.

---

## Citation binding (TENISE-21)

An ungrounded RAG answer and a grounded one look identical to a reader — both are
fluent prose about tennis. The only thing separating them is whether the claims
trace back to a document, and a coach will not check by hand.

So evidence blocks are numbered, the prompt (v3) requires a `[n]` marker on every
factual sentence, and `citation.service.js` binds each marker back to its chunk
with title, page, authors and date. It reports three things plainly:

- **dangling citations** — the model cited `[7]` when it was given five chunks.
  A model inventing citation numbers is inventing the claims attached to them.
- **unused evidence** — retrieved and ignored. Consistently high means `topN` is
  larger than the model can absorb.
- **unsupported numbers** — a figure in the answer appearing in no source. Crude,
  and it will occasionally flag a correct paraphrase, but on a corpus of match
  scores and load figures it is nearly always the model filling in from memory.

---

## Reproducing the numbers

```bash
npm run eval
```

Seven configurations over the question set in `queries/query_set.json`, each in
its **own process** — Node caches modules and freezes config at import, so
flipping an env var and re-importing silently runs every strategy with the first
one's settings. That produces an identical row for every strategy, which reads as
"none of the techniques helped" when in fact nothing was tested. This bug was
present in the first version of the harness and is the reason the current one
spawns children.

Results are written to `evidence/strategy_comparison.json`, broken down by
question type as well as overall — the headline average tends to hide that a
technique helps enormously on one kind of question and not at all on another,
and *that* is the finding worth reporting.

```bash
CHUNK_EVAL_CORPUS_ROOT=C:/IFN736-project/document-sources npm run eval:chunking
```

The chunking comparison is a separate harness on purpose: `npm run eval` varies
query-time settings over one fixed index, whereas chunking is a build-time
choice, so each cell is its own index under `data/index-eval/<cellId>/`. It never
builds unless `--build` is passed (a few minutes per cell, needs Ollama), it
refuses any `INDEX_DIR` that is or sits inside `data/index`, and it runs the
ground-truth gate (`--check-questions` to run only that) before touching an
index: every span in `queries/chunking_questions.json` must occur verbatim on
exactly one page or row of exactly one corpus document, and any that does not is
excluded from every cell's denominator and reported loudly. The corpus files are
partner data and are not committed; `queries/chunking_corpus.json` holds their
sha256 hashes and preflight refuses a missing, altered or duplicated file.

---

## Sources

- [Contextual Retrieval in AI Systems — Anthropic](https://www.anthropic.com/engineering/contextual-retrieval)
- [From BM25 to Corrective RAG: Benchmarking Retrieval Strategies for Text-and-Table Documents (arXiv 2604.01733)](https://arxiv.org/html/2604.01733v1)
- [Hybrid Search: BM25, Vector & Reranking Reference 2026](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026)
- [Hybrid Search for RAG: Combining BM25 and Dense Vector Search (2026 Guide)](https://denser.ai/blog/hybrid-search-for-rag/)
- [Dense RAG Fails on Rare Terms. Hybrid Search Fixes It (2026)](https://tensoria.fr/en/blog/hybrid-search-reranking)
- [RAG Chunking Strategies: A 2026 Retrieval Playbook](https://www.digitalapplied.com/blog/rag-chunking-strategies-2026-retrieval-quality-playbook)
- [Best Chunking Strategies for RAG (and LLMs) in 2026](https://www.firecrawl.dev/blog/best-chunking-strategies-rag)
- [12 Advanced RAG Techniques: Beyond Naive Retrieval (2026)](https://atlan.com/know/advanced-rag-techniques/)
- [MultiHop-RAG: Benchmarking RAG for Multi-Hop Queries (arXiv 2401.15391)](https://arxiv.org/pdf/2401.15391)
- [Best Ollama Embedding Models 2026, benchmarked by MTEB score, VRAM and dimensions](https://www.morphllm.com/ollama-embedding-models)
- [Reranking & Cross-Encoders for RAG: BGE, Cohere, Jina (2026)](https://localaimaster.com/blog/reranking-cross-encoders-guide)
