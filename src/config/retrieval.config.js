// every knob for ingestion and retrieval lives here, in one file.
//
// the rule this file exists to enforce: nothing in src/modules/ hardcodes a
// model name, a dimension, a host or a top-k. if you want to change how the
// system behaves, you change a number here and nothing else. that is also what
// makes the ablation in `npm run eval` honest -- each technique can be switched
// off without editing the code that uses it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

dotenv.config();

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

// `num` above only falls back when the value is NaN, so "0", "-3" and "2.5" all
// pass through it untouched. for a count of rows that is not a tuning choice,
// it is a broken index: 0 rows per chunk produces no chunks at all and 2.5
// silently truncates part of a row out of the corpus. so this one throws at
// load rather than quietly accepting a value that cannot mean anything.
function intAtLeast(value, fallback, { name, min }) {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(
      `${name}=${JSON.stringify(value)} is not valid -- it must be an integer >= ${min}. ` +
        `a non-integer or out-of-range value here changes what is indexed rather than how ` +
        `it is ranked, so it fails now instead of producing a subtly wrong index.`,
    );
  }

  return parsed;
}

// a secret shorter than this can be brute-forced from a single known
// name -> pseudonym pair, and then every pseudonym in the index is reversible
// by hashing a list of names.
const DEID_MIN_SECRET_CHARS = 16;

function readDeidentificationFields(configPath) {
  const resolved = path.resolve(PROJECT_ROOT, configPath);
  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`DEID_CONFIG_PATH: cannot read ${resolved} -- ${error.message}`);
  }

  const fields = parsed?.fields;

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error(`${resolved} must hold a non-empty "fields" array.`);
  }

  const names = new Set();

  for (const field of fields) {
    if (typeof field?.name !== "string" || field.name.trim() === "" || names.has(field.name)) {
      throw new Error(`${resolved}: every field needs a unique, non-empty "name".`);
    }

    // the prefix becomes part of a token that bm25 and the doc id sanitiser
    // both have to keep intact, so it is restricted to what survives both.
    if (typeof field.prefix !== "string" || !/^[A-Z][A-Z0-9]*$/.test(field.prefix)) {
      throw new Error(`${resolved}: field "${field.name}" needs an upper-case alphanumeric "prefix".`);
    }

    const columns = field.columns ?? [];
    const composite = field.compositeColumns ?? [];

    if (
      !Array.isArray(columns) ||
      !columns.every((column) => typeof column === "string") ||
      !Array.isArray(composite) ||
      !composite.every((group) => Array.isArray(group) && group.length > 0 && group.every((c) => typeof c === "string"))
    ) {
      throw new Error(`${resolved}: field "${field.name}" has malformed "columns" or "compositeColumns".`);
    }

    if (columns.length === 0 && composite.length === 0) {
      throw new Error(`${resolved}: field "${field.name}" names no columns, so it can never find a value.`);
    }

    names.add(field.name);
  }

  return fields;
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }

  return value;
}

/**
 * E2-08. read once at import like everything else here, and validated eagerly:
 * enabled without a usable secret is a build that would either crash an hour
 * in or, worse, run with a guessable key.
 *
 * the secret is attached NON-ENUMERABLE. it is readable as `.secret` by the
 * code that needs it, but JSON.stringify, object spread and console.log all
 * skip it -- so dumping this config into a manifest or an evidence file cannot
 * leak it by accident.
 */
function loadDeidentification() {
  const enabled = bool(process.env.DEID_ENABLED, false);
  const configPath = process.env.DEID_CONFIG_PATH || "config/deidentification.json";
  const secret = process.env.DEID_SECRET || "";

  let fields = [];

  if (enabled) {
    if (secret.trim().length < DEID_MIN_SECRET_CHARS) {
      throw new Error(
        `DEID_ENABLED=true but DEID_SECRET is ${secret.trim() === "" ? "not set" : "too short"}. ` +
          `it must be at least ${DEID_MIN_SECRET_CHARS} characters -- it is the key every ` +
          `pseudonym is derived from, and without it nothing can be de-identified.`,
      );
    }

    fields = readDeidentificationFields(configPath);
  }

  const block = {
    enabled,
    configPath,
    // extra folders whose csv/xlsx feed the name dictionary without being
    // indexed themselves -- e.g. the athlete lists, when building an index of
    // pdfs only. semicolon-separated, like STRUCTURED_SOURCE_DIRS.
    dictionaryDirs: (process.env.DEID_DICTIONARY_DIRS || "")
      .split(";")
      .map((directory) => directory.trim())
      .filter(Boolean),
    fields,
  };

  Object.defineProperty(block, "secret", { value: secret, enumerable: false });

  return deepFreeze(block);
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
  //
  // everything below `minChars` is per-file-type, and every one of these values
  // used to be a bare literal inside chunking.service.js. they are here because
  // E2-07 has to be able to vary them per file type from the outside, and
  // because a per-file-type value hidden in the code is a value nobody ever
  // measured. the defaults are byte-for-byte the literals they replaced, so the
  // default configuration chunks exactly as it did before.
  //
  // they are kept FLAT under `chunking` rather than nested per file type on
  // purpose: the append guard and the build fingerprint both read this one
  // object, and a second object is a second place to forget.
  // ---------------------------------------------------------------------
  chunking: Object.freeze({
    targetChars: num(process.env.CHUNK_TARGET_CHARS, 1600),
    overlapChars: num(process.env.CHUNK_OVERLAP_CHARS, 200),
    // fragments shorter than this are page numbers, running headers and
    // stray footnote markers. they match everything weakly and nothing well.
    minChars: num(process.env.CHUNK_MIN_CHARS, 120),

    // records (csv/xlsx): how many verbalised rows go into one chunk.
    //
    // one row per chunk was never a decision, it was the only thing the code
    // could do. it has a real cost -- a single 98-row csv floods the candidate
    // pool with near-identical neighbours and crowds prose out of the top k --
    // and a real benefit, which is that a row's citation points at that row.
    // exposing it is what turns that into a question evidence can answer.
    rowsPerChunk: intAtLeast(process.env.CHUNK_ROWS_PER_CHUNK, 1, {
      name: "CHUNK_ROWS_PER_CHUNK",
      min: 1,
    }),
    // the per-row truncation inside verbaliseRow. a row longer than this is
    // cut and suffixed with "...", so it bounds one row, not one chunk.
    recordMaxChars: num(process.env.CHUNK_RECORD_MAX_CHARS, 1400),
    // the floor used by chunkDocument's whole-document fallback, for documents
    // whose every page is shorter than minChars -- conference handouts and
    // slide printouts routinely carry ~90 characters a page. deliberately far
    // below minChars: at that point the alternative is indexing nothing at all.
    fallbackMinChars: num(process.env.CHUNK_FALLBACK_MIN_CHARS, 40),
    // slides are never split, so this only drops section-divider slides that
    // hold nothing but a number or a stray label.
    slideMinChars: num(process.env.CHUNK_SLIDE_MIN_CHARS, 40),
    // budget left over in a table chunk after the heading and the repeated
    // header row, so a row is not cut in half by a rounding error.
    tableHeadroomChars: num(process.env.CHUNK_TABLE_HEADROOM_CHARS, 32),
  }),

  // ---------------------------------------------------------------------
  // de-identification (E2-08)
  //
  // replaces configured identifying values -- athlete names, for now -- with
  // keyed one-way pseudonyms before anything is chunked or indexed. see
  // modules/ingestion/deidentification.service.js and docs/DEIDENTIFICATION.md.
  //
  // a sibling of `chunking`, NOT a key inside it: every chunking key is checked
  // by the append guard's canonicaliser, and test/unit/indexAppend.test.js
  // fails on a chunking key it does not know about.
  //
  // OFF by default, for now. the committed data/index was built from the raw
  // corpus, so turning this on by default would make every teammate's append
  // and resume refuse; the E2-07 ground truth is written against real names;
  // and CI has no secret. a production rebuild sets DEID_ENABLED=true.
  // ---------------------------------------------------------------------
  deidentification: loadDeidentification(),

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
    // dropped from 50 to 24. with llm scoring that was 5 batched calls, and
    // ollama runs one request at a time unless OLLAMA_NUM_PARALLEL is set, so
    // "concurrent" batches queued and a search took 20-56 seconds. 24 is two
    // batches. raise it when running the cross-encoder service, where scoring
    // is a single fast forward pass.
    rerankInput: num(process.env.RERANK_INPUT, 24),
    // how many chunks reach the language model. the research is consistent
    // that ~20 beats 5 or 10 for answer quality, but 20 chunks of 1600 chars
    // is ~8k tokens of prompt, which is slow on a local 8b model. 10 is the
    // compromise; raise it if your machine can take the latency.
    //
    // in normal use this is not actually the number that reaches the model --
    // answerQuestion (answer.service.js) asks a per-intent/route table instead
    // (TOP_N_FOR_INTENT_ROUTE, queryTaxonomy.js) and only TENISE-68's effort
    // levels SCALE that number (x0.6 fast, x1.5 thorough -- effort.config.js).
    // this field remains the default for a direct retrieve() call that passes
    // no topN of its own, e.g. `npm run search`.
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
    // a cross-encoder reads the query and the passage together, so unlike the
    // embedding model it can tell that a chunk shares a keyword with the query
    // for an irrelevant reason. it is the largest precision gain in the
    // pipeline after hybrid itself.
    //
    // this is also the global default TENISE-68's per-request effort levels
    // override ("low" skips it, "high" keeps it) -- see
    // src/config/effort.config.js. unchanged here either way: a request
    // with no effort opinion gets exactly this value.
    enabled: bool(process.env.RERANK_ENABLED, true),

    // three strategies.
    //
    //   "llm"           score passages in batches with the ordinary chat
    //                    model. works on a stock ollama install with nothing
    //                    extra, but batches are scored on their own curve and
    //                    pooling scores across batches is not reliable -- see
    //                    rerankViaLlm in ranking.service.js.
    //
    //   "cross-encoder"  a real cross-encoder (bge-reranker), run in-process
    //                     via transformers.js/onnx. no separate service, no
    //                     batch-calibration problem -- every passage is
    //                     scored against the query independently, not against
    //                     the other passages in its batch. this is the
    //                     recommended strategy; "llm" exists as a fallback
    //                     that needs no model download.
    //
    //   "service"        call a real cross-encoder over http instead --
    //                     tools/rerank/rerank_server.py, or huggingface
    //                     text-embeddings-inference, or infinity. set
    //                     RERANK_API_URL to point at it. useful if you would
    //                     rather run the reranker as a separate process (e.g.
    //                     on a GPU box) than in the node process.
    //
    // NOTE for anyone reaching for ollama here: ollama has NO /api/rerank.
    // it serves a reranker model's embedding layer but not its classification
    // head, so `ollama pull bge-reranker-v2-m3` both fails (it is not in the
    // library) and would not help if it succeeded.
    strategy: process.env.RERANK_STRATEGY || "llm",

    apiUrl: process.env.RERANK_API_URL || "",
    model: process.env.RERANK_MODEL || "BAAI/bge-reranker-v2-m3",
    // the transformers.js model id for the "cross-encoder" strategy. Xenova's
    // org publishes onnx conversions of the standard bge-reranker checkpoints
    // -- "Xenova/bge-reranker-base" (~280MB, the default) fits comfortably
    // alongside the embedding and generation models on an 8GB card;
    // "Xenova/bge-reranker-v2-m3" is larger and stronger if there is room.
    crossEncoderModel: process.env.RERANK_CROSS_ENCODER_MODEL || "Xenova/bge-reranker-base",
    llmModel: process.env.RERANK_LLM_MODEL || "llama3.1:8b",
    // how many passages go into one scoring call. one call per passage meant 50
    // sequential round trips and about 90 seconds; ten per call is five calls,
    // run concurrently. the cross-encoder strategy scores every passage in one
    // batch regardless -- this only bounds the "llm" strategy.
    batchSize: num(process.env.RERANK_BATCH_SIZE, 12),
    baseUrl: stripTrailingSlash(process.env.OLLAMA_BASE_URL || "http://localhost:11434"),
  }),

  // ---------------------------------------------------------------------
  // query understanding
  //
  // decompositionEnabled, expansionEnabled (below) and rerank.enabled (its
  // own block further down) are also overridable PER REQUEST -- TENISE-68's
  // "low" vs "high" effort levels -- see src/config/effort.config.js.
  // these fields stay the GLOBAL default: a request that does not opt into
  // an effort level reads exactly these values, unchanged.
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

    // the intent planner. fills in a schema-constrained form describing what the
    // question is asking for. see modules/query/queryPlanner.service.js for why
    // this is a form and not tool calling.
    // ask the same question several ways when the first attempt comes back
    // thin, and fuse the results. this is the retrieval half of corrective rag:
    // when evidence is weak, do something about it rather than refusing or
    // generating from whatever turned up. off by default per query -- it only
    // fires when grading says the evidence is insufficient or partial.
    //
    // the global default for TENISE-68's effort override too ("low" skips
    // this whole stage, "high" leaves it able to fire) -- see
    // src/config/effort.config.js.
    expansionEnabled: bool(process.env.EXPANSION_ENABLED, true),
    expansionModel: process.env.EXPANSION_MODEL || process.env.OLLAMA_GENERATION_MODEL || "llama3.1:8b",

    // NOT overridable per request by TENISE-68's effort levels -- see
    // effort.config.js's comment on why: this is what lets a structured
    // (table) question extract its entities at all, so turning it off for
    // "low" would trade latency for a wrong answer, not a thinner one.
    plannerEnabled: bool(process.env.PLANNER_ENABLED, true),
    plannerModel: process.env.PLANNER_MODEL || "llama3.1:8b",
    // below this rule-confidence we pay for a model call. above it the rules are
    // trusted and the call is skipped, which saves about a second per query.
    plannerConfidenceFloor: Number(process.env.PLANNER_CONFIDENCE_FLOOR ?? 0.8),
  }),

  // ---------------------------------------------------------------------
  // generation
  // ---------------------------------------------------------------------
  generation: Object.freeze({
    model: process.env.OLLAMA_GENERATION_MODEL || "llama3.1:8b",
    baseUrl: stripTrailingSlash(process.env.OLLAMA_BASE_URL || "http://localhost:11434"),

    // corrective-rag evidence grading. judges whether the retrieved passages
    // actually address the question BEFORE writing an answer, and refuses
    // rather than generating from irrelevant material. the highest-value part
    // of the generation layer -- see modules/generation/evidenceGrader.
    gradingEnabled: bool(process.env.GRADING_ENABLED, true),
    // how many passages get an individual relevance judgement. one small model
    // call each, run concurrently.
    gradeLimit: num(process.env.GRADE_LIMIT, 8),

    // worked examples in the prompt. cheapest quality lever there is: it fixes
    // citation formatting and, more importantly, teaches the model what a
    // refusal looks like.
    fewShotEnabled: bool(process.env.FEW_SHOT_ENABLED, true),

    // drop sentences within a chunk that have nothing to do with the question.
    // on an 8b model this is the difference between fitting twelve passages
    // and fitting six.
    compressionEnabled: bool(process.env.COMPRESSION_ENABLED, true),

    // put the strongest evidence at both ends of the context, weakest in the
    // middle, where models demonstrably lose material.
    attentionOrdering: bool(process.env.ATTENTION_ORDERING, true),

    // how much context the model is given. 12000 chars is ~3000 tokens, which
    // leaves room in an 8k window for the few-shot examples and the answer.
    maxContextChars: num(process.env.MAX_CONTEXT_CHARS, 12000),
  }),

  // ---------------------------------------------------------------------
  // multi-turn conversation
  // ---------------------------------------------------------------------
  conversation: Object.freeze({
    // rewriting a follow-up into a standalone question before retrieval. off
    // and the system still answers -- it just cannot follow "what about clay?".
    rewriteEnabled: bool(process.env.REWRITE_ENABLED, true),

    rewriteModel:
      process.env.REWRITE_MODEL || process.env.OLLAMA_GENERATION_MODEL || "llama3.1:8b",

    // how many previous turns the rewriter may look at. small on purpose: an
    // older turn is far more likely to drag the rewrite off topic than to
    // supply the missing subject, and every extra turn is prompt tokens spent
    // on context that is probably no longer relevant.
    maxTurns: num(process.env.REWRITE_MAX_TURNS, 3),
  }),
});

export default retrievalConfig;
