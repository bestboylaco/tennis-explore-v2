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

### Chunking: 1600 chars, 200 overlap — **deliberately modest overlap**

1600 characters is roughly 400 tokens, inside the 256–1024 token band the 2026
chunking guidance converges on. BGE-M3 could take far larger chunks, but a bigger
chunk dilutes what you matched — the vector is an average, so burying one
relevant sentence among four irrelevant paragraphs drags it away from the query.

Overlap is small on purpose. A January 2026 systematic analysis found overlap
gave **no measurable retrieval benefit** and only increased indexing cost; the
real fix for context lost at a boundary is the contextual header, not more
overlap. 200 characters is enough to stop a sentence being severed.

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
