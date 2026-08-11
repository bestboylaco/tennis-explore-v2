// the retrieval orchestrator (TENISE-17 / E3-11).
//
// one function, `retrieve`, does the whole job:
//
//   plan  ->  filter  ->  bm25 arm  +  dense arm  ->  rrf  ->  assert  ->  rerank  ->  cut
//
// the order matters in one specific way: the access filter is applied INSIDE
// both arms, before either produces a ranked list. filtering afterwards would
// let a forbidden chunk occupy a slot and then get dropped, which silently
// shortens the result set. so the filter is a parameter to the arms, never a
// step between them.

import { retrievalConfig } from "../../config/retrieval.config.js";
import { VectorStore } from "../../infrastructure/vector/vectorStore.service.js";
import { embedQuery } from "../ingestion/embedding.service.js";
import { BM25Index } from "./bm25.service.js";
import { assertAccessInvariant, buildAccessFilter } from "./accessControl.service.js";
import {
  hydrateFusedCandidates,
  reciprocalRankFusion,
  rerankCandidates,
} from "./ranking.service.js";
import {
  decomposeQuery,
  generateHypotheticalDocument,
  planRetrieval,
} from "./queryAnalyzer.service.js";

// the index is loaded once and reused. it is tens of megabytes and parsing it on
// every request would dominate the latency of everything else in this file.
let cached = null;

export async function loadIndex({ directory = retrievalConfig.index.dir, force = false } = {}) {
  if (cached && !force && cached.directory === directory) return cached;

  const store = await VectorStore.load(directory);

  // bm25 is built in memory from the same chunk list, in the same order, so a
  // positional index means the same thing to both arms. it takes about a second
  // for 7k chunks, which is not worth persisting to disk.
  //
  // note it indexes `embedding_text`, not `text`: the contextual header has to
  // be searchable by the keyword arm too, or half the benefit of contextual
  // retrieval is thrown away on exactly the queries bm25 is best at.
  const bm25 = new BM25Index(
    store.chunks.map((chunk) => ({
      id: chunk.chunk_id,
      text: chunk.embedding_text ?? chunk.text,
    })),
  );

  cached = { directory, store, bm25, manifest: store.manifest };

  return cached;
}

/**
 * runs both arms once for one query string and returns the two ranked lists.
 */
async function runArms(queryText, { index, filter, plan, queryVector = null, signal }) {
  const { store, bm25 } = index;

  const bm25Hits = bm25.search(queryText, {
    k: plan.bm25K,
    isAllowed: filter.isIndexAllowed(store.chunks),
  });

  let denseHits = [];

  if (plan.denseK > 0) {
    // a caller can pass a vector in (hyde does this) so we do not embed twice.
    const vector = queryVector ?? (await embedQuery(queryText, { signal }));

    denseHits = store.search(vector, {
      k: plan.denseK,
      isAllowed: filter.isChunkAllowed,
    });
  }

  // attach the chunk to each hit so fusion can hydrate without a second lookup.
  const attach = (hits) =>
    hits.map((hit) => ({ ...hit, chunk: store.getChunk(hit.index) }));

  return { bm25: attach(bm25Hits), dense: attach(denseHits) };
}

/**
 * retrieves evidence for one question.
 *
 * `roleId` is required and has no default. a default would mean a caller that
 * forgets to pass a role still gets results, and the role they would silently
 * get is whichever one we picked -- that is how access control quietly stops
 * working.
 */
export async function retrieve(query, { roleId, topN = retrievalConfig.retrieval.topN, signal = null, subQueries = null } = {}) {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("retrieve requires a non-empty query.");
  }

  if (!roleId) {
    throw new Error(
      "retrieve requires a roleId. there is no default role on purpose -- " +
        "a default would mean forgetting to pass one still returns documents.",
    );
  }

  const startedAt = Date.now();
  const index = await loadIndex();
  const filter = buildAccessFilter(roleId);
  const plan = planRetrieval(query);

  const notes = [];

  // ---- query expansion ---------------------------------------------------
  let queries = [query];

  // the intent planner may already have split this question. reuse its split
  // rather than paying for a second model call to make the same decision.
  if (Array.isArray(subQueries) && subQueries.length > 0) {
    queries = [query, ...subQueries.filter((sub) => sub !== query)];
    notes.push(`using ${subQueries.length} sub-questions from the planner`);
  } else if (plan.decompose) {
    queries = await decomposeQuery(query, { signal });

    if (queries.length > 1) {
      notes.push(`decomposed into ${queries.length - 1} sub-questions`);
    }
  }

  let hydeVector = null;

  if (plan.useHyde) {
    const hypothetical = await generateHypotheticalDocument(query, { signal });

    if (hypothetical) {
      hydeVector = await embedQuery(hypothetical, { signal });
      notes.push("hyde document generated");
    }
  }

  // ---- run the arms ------------------------------------------------------
  const lists = [];
  const armNames = [];

  for (const [position, subQuery] of queries.entries()) {
    const arms = await runArms(subQuery, { index, filter, plan, signal });

    lists.push(arms.bm25, arms.dense);
    armNames.push(`bm25${position > 0 ? `_sub${position}` : ""}`, `dense${position > 0 ? `_sub${position}` : ""}`);
  }

  if (hydeVector) {
    const hydeHits = index.store
      .search(hydeVector, { k: plan.denseK, isAllowed: filter.isChunkAllowed })
      .map((hit) => ({ ...hit, chunk: index.store.getChunk(hit.index) }));

    lists.push(hydeHits);
    armNames.push("hyde");
  }

  // ---- fuse --------------------------------------------------------------
  // every list goes into one rrf call, whether it came from an arm or a
  // sub-question. that is the nice property of rank fusion: adding a source is
  // just adding a list, there is no weight to rebalance.
  const fused = reciprocalRankFusion(lists);
  const hydrated = hydrateFusedCandidates(fused, lists, armNames);

  // the filter already ran inside both arms. this proves it did.
  assertAccessInvariant(hydrated, filter);

  // ---- rerank and cut ----------------------------------------------------
  const { candidates, reranked, reason } = await rerankCandidates(query, hydrated, { signal });

  if (!reranked && reason && reason !== "disabled") notes.push(reason);

  const evidence = candidates.slice(0, topN).map((candidate, position) => ({
    ...candidate,
    // 1-based because this is the number the model will cite and a coach will
    // read. off-by-one here shows up as every citation pointing one document
    // early, which is the sort of bug that survives a demo.
    citationNumber: position + 1,
  }));

  return {
    query,
    roleId,
    evidence,
    plan,
    notes,
    telemetry: {
      queryKind: plan.kind,
      subQueries: queries.length,
      armCount: lists.length,
      bm25Candidates: lists.filter((_, i) => armNames[i].startsWith("bm25")).flat().length,
      denseCandidates: lists.filter((_, i) => armNames[i].startsWith("dense")).flat().length,
      fusedCandidates: hydrated.length,
      // how many of the final results only one arm found. if this is zero across
      // the whole query set then the arms agree completely and the vector arm is
      // not buying anything for its latency -- which would be a finding, not a
      // failure.
      singleArmInTopN: evidence.filter((candidate) => candidate.foundBy.length === 1).length,
      reranked,
      itemsOut: evidence.length,
      corpusSize: index.store.size,
      durationMs: Date.now() - startedAt,
    },
  };
}

export function clearIndexCache() {
  cached = null;
}
