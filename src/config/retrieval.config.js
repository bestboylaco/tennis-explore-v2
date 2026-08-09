// every knob for ingestion and retrieval lives here, in one file.
//
// the rule this file exists to enforce: nothing in src/modules/ hardcodes a
// model name, a dimension, a host or a top-k. if you want to change how the
// system behaves, you change a number here and nothing else. that is also what
// makes the ablation in `npm run eval` honest -- each technique can be switched
// off without editing the code that uses it.

import dotenv from "dotenv";

dotenv.config();

// small helper so OLLAMA_BASE_URL=http://localhost:11434/ and
// http://localhost:11434 behave identically.
function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

export const retrievalConfig = Object.freeze({
  // ---------------------------------------------------------------------
  // where the built index lives on disk.
  //
  // we deliberately do NOT use a database or a vector server. the index is
  // three plain files, so it can be committed, zipped, or attached to a
  // release, and a teammate can run search by cloning and typing one command.
  // ---------------------------------------------------------------------
  index: Object.freeze({
    dir: process.env.INDEX_DIR || "data/index",
    // schema_version is written into the manifest. if you change the meaning of
    // a field, bump this -- an index built under an older version will refuse
    // to load rather than silently ranking against the wrong fields.
    schemaVersion: 2,
  }),

  // ---------------------------------------------------------------------
  // embedding model
  //
  // provider "ollama" is the real one. provider "hash" is a deterministic
  // offline stand-in that needs no model and no network: it lets you run the
  // whole pipeline and the tests on a machine with nothing installed. the
  // similarity numbers it produces are meaningless, so never build a real
  // index with it -- the manifest records which provider was used so a hash
  // index can never be mistaken for a real one.
  // ---------------------------------------------------------------------
  embedding: Object.freeze({
    provider: process.env.EMBEDDING_PROVIDER || "ollama",
    // bge-m3: 1024 dimensions, 8192-token context, ~2.3 GB on the card.
    // on an 8 GB gpu this leaves comfortable room for the reranker and a 8b
    // generation model, which is why it is the default rather than a bigger
    // 4b/8b embedding model that would evict the others.
    model: process.env.EMBEDDING_MODEL || "bge-m3",
    dimension: num(process.env.EMBEDDING_DIMENSION, 1024),
    baseUrl: stripTrailingSlash(process.env.OLLAMA_BASE_URL || "http://localhost:11434"),
    // how many chunks to send per request. bigger is faster until the gpu runs
    // out of memory and ollama starts swapping, at which point it is much
    // slower. 16 is safe on 8 GB.
    batchSize: num(process.env.EMBEDDING_BATCH_SIZE, 16),
  }),

  // ---------------------------------------------------------------------
  // chunking
  //
  // 1600 chars is roughly 400 tokens, inside the 256-1024 token band that the
  // 2026 chunking guides converge on. bge-m3 could take far bigger chunks, but
  // a bigger chunk dilutes the thing you actually matched -- the vector is an
  // average, so burying one relevant sentence in four irrelevant paragraphs
  // moves the vector away from the query.
  //
  // overlap is kept small on purpose. a january 2026 study found overlap gave
  // no measurable retrieval benefit and just increased index size; the real
  // fix for context lost at a boundary is the contextual header below, not
  // more overlap. 200 chars is enough to keep a sentence from being cut in
  // half and no more.
  // ---------------------------------------------------------------------
  chunking: Object.freeze({
    targetChars: num(process.env.CHUNK_TARGET_CHARS, 1600),
    overlapChars: num(process.env.CHUNK_OVERLAP_CHARS, 200),
    // fragments shorter than this are page numbers, running headers and
    // stray footnote markers. they match everything weakly and nothing well.
    minChars: num(process.env.CHUNK_MIN_CHARS, 120),
  }),

  // ---------------------------------------------------------------------
  // contextual retrieval
  //
  // this is the single highest-value technique in the stack. each chunk gets a
  // short header naming the document, section, date and author before it is
  // embedded and before it is tokenised for bm25. anthropic's write-up
  // measured a 49% drop in retrieval failures from this alone, and 67% when
  // combined with reranking.
  //
  // why it works: a chunk that says "this increased by 12% in the second block"
  // is unretrievable, because nothing in it says what "this" is or which study
  // it came from. the header restores exactly that.
  //
  // two ways to build the header:
  //   "template" -- deterministic, free, instant. builds the header from
  //                 metadata we already have. this is the default.
  //   "llm"      -- asks the local model to write a one-sentence situating
  //                 summary per chunk. better, but it is one model call per
  //                 chunk, so budget ~1-2 hours for 7000 chunks.
  // ---------------------------------------------------------------------
  contextual: Object.freeze({
    enabled: bool(process.env.CONTEXTUAL_ENABLED, true),
    mode: process.env.CONTEXTUAL_MODE || "template",
    llmModel: process.env.CONTEXTUAL_MODEL || "llama3.1:8b",
  }),

  // ---------------------------------------------------------------------
  // retrieval
  // ---------------------------------------------------------------------
  retrieval: Object.freeze({
    // candidates pulled from each arm before fusion. 50/50 is the sweet spot
    // in the benchmarks: going to 100+ pulls in enough noise that the reranker
    // starts performing *worse* than no reranker at all, because it is now
    // choosing between 100 mediocre candidates instead of 50 decent ones.
    bm25K: num(process.env.BM25_K, 50),
    denseK: num(process.env.DENSE_K, 50),
    // rrf damping constant. the curve is flat above about 30; 60 is the value
    // from the original cormack et al. paper and there is nothing to gain by
    // tuning it, so it is not exposed as a tuning target.
    rrfK: num(process.env.RRF_K, 60),
    // how many fused candidates the reranker actually scores.
    rerankInput: num(process.env.RERANK_INPUT, 50),
    // how many chunks reach the language model. the research is consistent
    // that ~20 beats 5 or 10 for answer quality, but 20 chunks of 1600 chars
    // is ~8k tokens of prompt, which is slow on a local 8b model. 10 is the
    // compromise; raise it if your machine can take the latency.
    topN: num(process.env.TOP_N, 10),
  }),

  // ---------------------------------------------------------------------
  // reranking
  //
  // a cross-encoder reads the query and the passage together, so unlike the
  // embedding model it can tell that a chunk shares a keyword with the query
  // for an irrelevant reason. it is the largest single precision gain in the
  // pipeline after hybrid itself.
  //
  // three strategies, tried in order, first one that works wins:
  //   "rerank-api" -- ollama's /api/rerank, if your build has it.
  //   "llm"        -- score each passage 0-10 with the local chat model.
  //                   slower but works on every ollama build.
  //   "none"       -- keep the fused order.
  // if the configured strategy fails at runtime we fall back to the fused
  // order and say so in the response, rather than failing the request.
  // ---------------------------------------------------------------------
  rerank: Object.freeze({
    enabled: bool(process.env.RERANK_ENABLED, true),
    strategy: process.env.RERANK_STRATEGY || "rerank-api",
    model: process.env.RERANK_MODEL || "bge-reranker-v2-m3",
    llmModel: process.env.RERANK_LLM_MODEL || "llama3.1:8b",
    baseUrl: stripTrailingSlash(process.env.OLLAMA_BASE_URL || "http://localhost:11434"),
  }),

  // ---------------------------------------------------------------------
  // query understanding
  // ---------------------------------------------------------------------
  query: Object.freeze({
    // routing decides how much machinery a question deserves. an entity lookup
    // ("what was the score against kumasaka") is already answered perfectly by
    // bm25 in ~50 ms; paying 2.4 s for the vector arm buys nothing on those.
    routingEnabled: bool(process.env.ROUTING_ENABLED, true),

    // decomposition splits a multi-hop question into single-hop parts, runs
    // retrieval on each, and fuses. it genuinely helps on "compare x and y"
    // style questions and does nothing for simple lookups, so the router
    // decides when to use it rather than it running on everything.
    decompositionEnabled: bool(process.env.DECOMPOSITION_ENABLED, true),
    maxSubQueries: num(process.env.MAX_SUB_QUERIES, 3),
    decompositionModel: process.env.DECOMPOSITION_MODEL || "llama3.1:8b",

    // hyde writes a fake answer and searches with its embedding.
    //
    // OFF by default, and that is a deliberate finding rather than laziness.
    // the 2026 text-and-table retrieval benchmark measured hyde *below* plain
    // dense retrieval, and other work found hypothetical-document methods
    // score lower precision than the baseline. it is here, working, behind a
    // flag so the eval harness can show that on our corpus too.
    hydeEnabled: bool(process.env.HYDE_ENABLED, false),
    hydeModel: process.env.HYDE_MODEL || "llama3.1:8b",
  }),

  // ---------------------------------------------------------------------
  // generation
  // ---------------------------------------------------------------------
  generation: Object.freeze({
    model: process.env.OLLAMA_GENERATION_MODEL || "llama3.1:8b",
    baseUrl: stripTrailingSlash(process.env.OLLAMA_BASE_URL || "http://localhost:11434"),
  }),
});

export default retrievalConfig;
