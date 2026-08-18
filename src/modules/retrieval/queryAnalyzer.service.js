// query understanding: routing, decomposition, and hyde.
//
// the premise is that not every question deserves the same machinery. our own
// numbers say entity lookups are already answered perfectly by bm25 in ~55 ms,
// and the vector arm adds 2.4 s to return the same thing. paying for the full
// stack on every query is not thoroughness, it is waste that a coach experiences
// as the app being slow.
//
// so: classify first, then spend accordingly.

import { retrievalConfig } from "../../config/retrieval.config.js";

export const QUERY_KINDS = Object.freeze({
  ENTITY_LOOKUP: "entity_lookup", // "score against Kumasaka", "M-CH-AUS-2025-005"
  FACTUAL: "factual", // one fact, one place
  CONCEPTUAL: "conceptual", // "how does serve load affect recovery"
  MULTI_HOP: "multi_hop", // needs two or more separate lookups joined
});

// things that only ever appear in an exact-handle query. if one of these is
// present the user typed a literal string and wants that literal string back.
const EXACT_HANDLE = /\b([A-Z]{1,3}-[A-Z0-9-]{4,}|\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{6,})\b/;

// phrasing that means the answer lives in two places and has to be joined.
const MULTI_HOP_SIGNALS = [
  /\bcompare\b/i,
  /\bversus\b|\bvs\.?\b/i,
  /\bdifference between\b/i,
  /\bboth\b/i,
  /\band (also|then)\b/i,
  /\bhow (do|does) .+ (compare|differ)/i,
];

const CONCEPTUAL_SIGNALS = [/\bwhy\b/i, /\bhow\b/i, /\bexplain\b/i, /\beffect\b/i, /\bimpact\b/i, /\brelationship\b/i];

/**
 * classifies a query with rules rather than a model call.
 *
 * a model call here would add a second of latency to decide whether to spend a
 * second, which is self-defeating. these rules are deliberately conservative:
 * anything ambiguous falls through to `factual`, which runs the full hybrid --
 * so a misclassification costs latency, never a wrong answer.
 */
export function classifyQuery(query) {
  const text = String(query).trim();

  if (MULTI_HOP_SIGNALS.some((pattern) => pattern.test(text))) {
    return QUERY_KINDS.MULTI_HOP;
  }

  // an exact handle plus a short query is a lookup. an exact handle inside a long
  // conceptual question is not -- "why did load spike around 24-11-2025" wants
  // reasoning, not a row.
  if (EXACT_HANDLE.test(text) && text.split(/\s+/).length <= 12) {
    return QUERY_KINDS.ENTITY_LOOKUP;
  }

  if (CONCEPTUAL_SIGNALS.some((pattern) => pattern.test(text))) {
    return QUERY_KINDS.CONCEPTUAL;
  }

  return QUERY_KINDS.FACTUAL;
}

/**
 * the routing plan: which arms to run, and how hard.
 *
 * note that the vector arm is never switched off entirely, even for a lookup --
 * it is just given a much smaller budget. switching it off completely means a
 * misclassified conceptual question gets keyword-only retrieval and a bad
 * answer, and the whole point of the router is that its mistakes should cost
 * milliseconds rather than correctness.
 */
export function planRetrieval(query) {
  const kind = classifyQuery(query);
  const { bm25K, denseK } = retrievalConfig.retrieval;

  if (!retrievalConfig.query.routingEnabled) {
    return { kind, bm25K, denseK, decompose: false, useHyde: false, reason: "routing disabled" };
  }

  switch (kind) {
    case QUERY_KINDS.ENTITY_LOOKUP:
      return {
        kind,
        bm25K,
        denseK: Math.min(10, denseK),
        decompose: false,
        useHyde: false,
        reason: "exact handle present, keyword arm does the work",
      };

    case QUERY_KINDS.MULTI_HOP:
      return {
        kind,
        bm25K,
        denseK,
        decompose: retrievalConfig.query.decompositionEnabled,
        useHyde: false,
        reason: "needs two or more lookups joined",
      };

    case QUERY_KINDS.CONCEPTUAL:
      return {
        kind,
        bm25K,
        denseK,
        decompose: false,
        // hyde is aimed at exactly this case, and is still off by default --
        // see the config for why the benchmarks argue against it.
        useHyde: retrievalConfig.query.hydeEnabled,
        reason: "vocabulary mismatch likely, vector arm earns its latency",
      };

    default:
      return { kind, bm25K, denseK, decompose: false, useHyde: false, reason: "default hybrid" };
  }
}

// ---------------------------------------------------------------------------
// llm helpers
// ---------------------------------------------------------------------------

async function callOllamaChat(model, messages, { signal, maxTokens = 200 } = {}) {
  const response = await fetch(`${retrievalConfig.generation.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0, num_predict: maxTokens },
    }),
    signal,
  });

  if (!response.ok) throw new Error(`ollama chat returned ${response.status}`);

  const payload = await response.json();

  return String(payload.message?.content ?? "");
}

/**
 * query decomposition.
 *
 * "how did serve load in the national academy compare with the pro tour squad"
 * is two retrievals, not one. embedding the whole sentence gives a vector that
 * sits between the two topics and is close to neither.
 *
 * so we split, retrieve each part separately, and fuse the results with rrf --
 * the same fusion that merges the two arms, reused. this is where the benchmark
 * gains for decomposition come from: multi-hop questions. it does nothing for
 * simple lookups, which is why the router gates it.
 *
 * on failure it returns the original query as a single item. a decomposition
 * that cannot run should degrade to plain retrieval, not break the request.
 */
export async function decomposeQuery(query, { signal } = {}) {
  const { maxSubQueries, decompositionModel } = retrievalConfig.query;

  try {
    const raw = await callOllamaChat(
      decompositionModel,
      [
        {
          role: "system",
          content:
            `Split the user's question into at most ${maxSubQueries} simpler questions, ` +
            "each answerable by looking in one place. Keep the original wording where you can. " +
            "Reply with one question per line and nothing else. " +
            "If the question is already simple, reply with just the original question.",
        },
        { role: "user", content: query },
      ],
      { signal },
    );

    const parts = raw
      .split("\n")
      .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
      .filter((line) => line.length > 8)
      .slice(0, maxSubQueries);

    // the original always stays in the list. a decomposition that loses the
    // user's actual phrasing loses the exact terms bm25 was going to match on.
    return parts.length > 1 ? [query, ...parts] : [query];
  } catch {
    return [query];
  }
}

/**
 * hyde -- hypothetical document embeddings.
 *
 * the idea: a question and its answer are written differently, so embedding the
 * question and comparing it to answers is a shape mismatch. write a fake answer
 * first, embed that, and search with it.
 *
 * it is implemented, it works, and it is off by default. the 2026 text-and-table
 * retrieval benchmark measured hyde BELOW plain dense retrieval, and related
 * work found hypothetical-document methods score lower precision than the
 * baseline. it is kept behind a flag so the eval harness can demonstrate that on
 * our own corpus rather than us asserting it -- which is a more useful thing to
 * be able to say in a review than "we implemented hyde".
 */
export async function generateHypotheticalDocument(query, { signal } = {}) {
  try {
    const text = await callOllamaChat(
      retrievalConfig.query.hydeModel,
      [
        {
          role: "system",
          content:
            "Write a short, plausible paragraph that would answer the question, as if it " +
            "were an extract from a sports science report. Do not hedge, do not say you " +
            "are unsure, do not mention that this is hypothetical. Three sentences maximum.",
        },
        { role: "user", content: query },
      ],
      { signal, maxTokens: 160 },
    );

    return text.trim() || null;
  } catch {
    return null;
  }
}
