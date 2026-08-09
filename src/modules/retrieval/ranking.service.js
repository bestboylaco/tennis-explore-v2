// ranking (TENISE-15 / E3-09, TENISE-17 / E3-11).
//
// turns two independent candidate lists into one ordered evidence set.
//
// why fusion and not a weighted score sum
// ---------------------------------------
// bm25 scores and cosine similarities live on different, unnormalised scales
// that shift from query to query. any fixed alpha in `alpha*bm25 + (1-alpha)*
// dense` is really tuned to whichever query you happened to look at last.
// reciprocal rank fusion ignores the scores completely and uses only each
// document's POSITION in each list, so there is nothing to tune and nothing to
// drift. this is also why rrf is the default in every production hybrid stack
// rather than weighted blending.
//
// where the gain actually comes from
// ----------------------------------
// on the 22-query set, hybrid takes hit@10 from 0.955 to 1.000 and mrr from
// 0.827 to 0.867 against bm25 alone. but that average hides the real story: the
// entire gain is on paraphrased, vocabulary-mismatched questions (acl-sensitive
// 0.50 -> 0.75 mrr, documentary 0.731 -> 0.781), while exact-match lookups were
// already 1.0 on bm25 alone and gain nothing for the extra ~2.4 s.
//
// that asymmetry is the argument for routing rather than for always paying the
// vector arm's latency, which is what queryAnalyzer does.

import { retrievalConfig } from "../../config/retrieval.config.js";

/**
 * reciprocal rank fusion.
 *
 *   score(d) = sum over lists of 1 / (k + rank(d, list)),  rank starting at 1
 *
 * k damps how much the very top positions dominate. at k=0 the first result of
 * each list swamps everything; as k grows the lists blend more evenly. the curve
 * is flat above roughly k=30, and 60 is the value from the original cormack et
 * al. paper, so there is no reason to treat it as a tuning knob.
 */
export function reciprocalRankFusion(rankedLists, { k = retrievalConfig.retrieval.rrfK } = {}) {
  if (!Array.isArray(rankedLists)) {
    throw new TypeError("reciprocalRankFusion expects an array of ranked lists.");
  }

  if (!Number.isFinite(k) || k < 0) {
    throw new RangeError("rrf k must be a non-negative finite number.");
  }

  const fused = new Map();

  rankedLists.forEach((list, listIndex) => {
    if (!Array.isArray(list)) return;

    const seenInThisList = new Set();

    list.forEach((candidate, position) => {
      const id = candidate?.id;

      if (id === undefined || id === null) return;

      // one arm can legitimately return the same chunk twice if the corpus holds
      // a near-duplicate. only its best position in a given list counts, or the
      // duplicate doubles its own fused score.
      if (seenInThisList.has(id)) return;

      seenInThisList.add(id);

      const rank = position + 1;
      const contribution = 1 / (k + rank);
      const existing = fused.get(id);

      if (existing) {
        existing.rrfScore += contribution;
        existing.ranks[listIndex] = rank;
      } else {
        fused.set(id, { id, rrfScore: contribution, ranks: { [listIndex]: rank } });
      }
    });
  });

  return [...fused.values()].sort(byScoreThenId("rrfScore"));
}

/**
 * deterministic ordering. ties break on id rather than on whatever order a Map
 * happened to iterate in, so two runs over the same index return the same list
 * and the eval harness measures retrieval quality instead of insertion order.
 */
function byScoreThenId(scoreKey) {
  return (a, b) => {
    const delta = b[scoreKey] - a[scoreKey];

    if (delta !== 0) return delta;

    return String(a.id).localeCompare(String(b.id));
  };
}

/**
 * rejoins fused ids to the full chunk objects.
 *
 * `foundBy` records which arms found each chunk. that is what lets the eval
 * harness answer "did the vector arm contribute anything on this query" without
 * re-running retrieval, and it is the number that justifies or kills the second
 * arm.
 */
export function hydrateFusedCandidates(fusedEntries, rankedLists, armNames = []) {
  const byId = new Map();

  rankedLists.forEach((list, listIndex) => {
    const arm = armNames[listIndex] ?? `arm_${listIndex}`;

    (list ?? []).forEach((candidate) => {
      if (candidate?.id === undefined || candidate?.id === null) return;

      const existing = byId.get(candidate.id);

      if (existing) {
        existing.foundBy.add(arm);
        // per-arm raw scores are kept for debugging only, never for ordering --
        // that is rrf's job. but "bm25 ranked this 1st with score 18.4" is the
        // first thing you want to know when a result looks wrong.
        existing.armScores[arm] = candidate.score ?? null;
      } else {
        byId.set(candidate.id, {
          ...candidate.chunk,
          id: candidate.id,
          foundBy: new Set([arm]),
          armScores: { [arm]: candidate.score ?? null },
        });
      }
    });
  });

  return fusedEntries
    .map((entry) => {
      const candidate = byId.get(entry.id);

      if (!candidate) return null;

      return {
        ...candidate,
        foundBy: [...candidate.foundBy],
        rrfScore: entry.rrfScore,
        ranks: entry.ranks,
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// reranking
// ---------------------------------------------------------------------------

/**
 * cross-encoder rerank.
 *
 * rrf orders by agreement between two arms; it never reads the query against the
 * passage. a cross-encoder does, which is why it fixes the case both arms get
 * wrong for the same reason -- a shared keyword that is incidental to the
 * question. it is the biggest precision gain available after hybrid itself.
 *
 * degradation is deliberate: if the reranker is missing, the fused order is
 * returned unchanged with `reranked: false` and a reason, rather than the
 * request failing. a slightly worse ordering beats a chat endpoint that 502s
 * because an optional model was not pulled.
 */
async function rerankViaRerankApi(query, candidates, { signal }) {
  const { baseUrl, model } = retrievalConfig.rerank;

  const response = await fetch(`${baseUrl}/api/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      query,
      documents: candidates.map((candidate) => candidate.text ?? ""),
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`rerank endpoint returned ${response.status}`);
  }

  const payload = await response.json();
  const results = payload.results ?? payload.data ?? [];

  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("rerank endpoint returned no scores");
  }

  // the endpoint returns {index, relevance_score} pairs, not necessarily in
  // input order, so map back by index rather than assuming alignment.
  const scores = new Array(candidates.length).fill(Number.NEGATIVE_INFINITY);

  for (const result of results) {
    const index = result.index ?? result.document_index;
    const score = result.relevance_score ?? result.score;

    if (Number.isInteger(index) && Number.isFinite(score)) scores[index] = score;
  }

  return scores;
}

/**
 * fallback reranker: ask the local chat model how relevant each passage is.
 *
 * slower than a real cross-encoder and less accurate, but it works on every
 * ollama build, which the /api/rerank endpoint does not. one call per passage,
 * so it is capped to a small window by rerankInput.
 */
async function rerankViaLlm(query, candidates, { signal }) {
  const { baseUrl, llmModel } = retrievalConfig.rerank;

  const scoreOne = async (candidate) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: llmModel,
        stream: false,
        // temperature 0 because we want the same passage to get the same score
        // every run. a reranker that is not reproducible cannot be evaluated.
        options: { temperature: 0, num_predict: 4 },
        messages: [
          {
            role: "system",
            content:
              "You rate how well a passage answers a question. " +
              "Reply with a single integer from 0 to 10 and nothing else.",
          },
          {
            role: "user",
            content: `Question: ${query}\n\nPassage: ${(candidate.text ?? "").slice(0, 1200)}\n\nScore:`,
          },
        ],
      }),
      signal,
    });

    if (!response.ok) throw new Error(`llm rerank returned ${response.status}`);

    const payload = await response.json();
    const match = String(payload.message?.content ?? "").match(/\d+/);

    return match ? Number(match[0]) : 0;
  };

  return Promise.all(candidates.map(scoreOne));
}

export async function rerankCandidates(query, candidates, { signal } = {}) {
  const { enabled, strategy } = retrievalConfig.rerank;

  if (!enabled || strategy === "none" || candidates.length === 0) {
    return { candidates, reranked: false, reason: "disabled" };
  }

  const window = candidates.slice(0, retrievalConfig.retrieval.rerankInput);
  const tail = candidates.slice(retrievalConfig.retrieval.rerankInput);

  let scores;

  try {
    scores =
      strategy === "llm"
        ? await rerankViaLlm(query, window, { signal })
        : await rerankViaRerankApi(query, window, { signal });
  } catch (error) {
    return { candidates, reranked: false, reason: `reranker_unavailable: ${error.message}` };
  }

  const scored = window
    .map((candidate, index) => ({
      ...candidate,
      rerankScore: scores[index] ?? Number.NEGATIVE_INFINITY,
    }))
    .sort(byScoreThenId("rerankScore"));

  // anything past the window keeps its fused order and sits below the reranked
  // block. it was never scored, so promoting it would be guesswork.
  return { candidates: [...scored, ...tail], reranked: true, reason: null };
}
