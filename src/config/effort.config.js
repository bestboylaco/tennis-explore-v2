// per-request effort control (TENISE-68).
//
// every other toggle in retrieval.config.js is set once, from .env, at
// process startup -- RERANK_ENABLED, EXPANSION_ENABLED, DECOMPOSITION_ENABLED
// and TOP_N all apply to every question the process ever answers for as long
// as it keeps running. that is a fine way to answer "how good should this
// deployment be", and the wrong question for "how much should THIS question
// cost" -- a coach asking "what was the score against Kumasaka" and a coach
// asking "compare our return positioning research across both papers" do not
// deserve the same machinery, and today they get it anyway, because the only
// knob is global and it is set once at boot.
//
// this file does not add a new mechanism. it adds a second way to produce the
// same overrides retrieval.config.js already reads -- "fast" and "thorough"
// are just two more values for the same handful of knobs, chosen per request
// instead of once at startup. every call site that reads one of these
// overrides falls back to retrievalConfig when the field is missing, so a
// request that never mentions `effort` reads retrievalConfig exactly as it
// did before this file existed. that is what makes this backward compatible
// rather than a second place the same decision is made.
//
// -----------------------------------------------------------------------
// why these flags and not the others in retrieval.config.js
// -----------------------------------------------------------------------
// decomposition, expansion and rerank are switched; topN is scaled. four
// knobs, matching the ticket's own example of what "fast vs thorough" should
// mean. three flags in retrieval.config.js that look like candidates are
// deliberately left alone:
//
//   PLANNER_ENABLED        turning this off per-request for "fast" would
//                           save a model call, but it is also what extracts
//                           the entities a structured (table) question
//                           needs to run at all -- see queryPlanner.service.
//                           js. disabling it trades latency for a wrong
//                           answer on exactly the questions that need it
//                           most, not for a thinner one. not worth it for a
//                           saving of about a second.
//
//   CONTEXTUAL_ENABLED      this governs whether a chunk was WRITTEN with a
//                           situating header when the index was built. by
//                           the time a chat request exists, every chunk in
//                           the index already has its header or it does
//                           not -- there is nothing left at query time for a
//                           request to switch.
//
//   HYDE_ENABLED            stays off under both levels. it is already off
//                           globally because the benchmarks found it scores
//                           *below* plain dense retrieval (see
//                           retrieval.config.js) -- "thorough" means "spend
//                           more on the techniques that help", not
//                           "re-enable the one technique measured to hurt".
//
// -----------------------------------------------------------------------
// why a multiplier for topN, not a fixed number
// -----------------------------------------------------------------------
// the starting point already varies a lot by question before effort ever
// enters the picture: TOP_N_FOR_INTENT_ROUTE (queryTaxonomy.js) gives a
// summarisation question 20 chunks and a structured lookup 6. a fixed
// override would either starve the summary or waste budget on the lookup.
// a multiplier keeps the existing per-question shape and only turns the one
// dial the ticket actually asks for.
//
// -----------------------------------------------------------------------
// why two levels, not three
// -----------------------------------------------------------------------
// the ticket asks for a tradeoff between speed and thoroughness, and names
// fast/thorough as the example. a third "balanced" level sitting between the
// two would need its own evidence that some intermediate combination of
// these four flags is worth having -- nothing in this investigation surfaced
// one: every flag here is binary (a stage either runs or it does not), so
// the only middle ground available without inventing a new mechanism is
// topN, which already varies by question and effort level together. two
// levels covers what was asked without adding a choice nobody asked for.

export const EFFORT_LEVELS = Object.freeze({
  FAST: "fast",
  THOROUGH: "thorough",
});

export const ALL_EFFORT_LEVELS = Object.freeze(Object.values(EFFORT_LEVELS));

const EFFORT_PROFILES = Object.freeze({
  // skips every optional stage that is itself a model call, and narrows the
  // evidence window. the floor is retrieval-plus-generation only: bm25 +
  // dense + fusion always run (hybrid retrieval itself is not a toggle this
  // ticket touches), nothing else.
  [EFFORT_LEVELS.FAST]: Object.freeze({
    decompositionEnabled: false,
    expansionEnabled: false,
    rerankEnabled: false,
    topNScale: 0.6,
  }),

  // runs every optional stage and widens the evidence window beyond the
  // existing default. "enables all of them" per the ticket -- which for
  // decomposition/expansion/rerank is already this deployment's default
  // (see retrieval.config.js), so the visible difference against the
  // default is almost entirely topN; the visible difference against "fast"
  // is all four.
  [EFFORT_LEVELS.THOROUGH]: Object.freeze({
    decompositionEnabled: true,
    expansionEnabled: true,
    rerankEnabled: true,
    topNScale: 1.5,
  }),
});

/**
 * resolves the overrides for one request.
 *
 * returns `{}` -- not null, not a partially-filled object -- for anything
 * that is not exactly "fast" or "thorough", including undefined. every call
 * site reads a field off the returned object with `?? retrievalConfig...`,
 * so an empty object means "nothing overridden", which is exactly what a
 * request that never mentions effort should get.
 *
 * deliberately permissive about the input rather than throwing: this runs
 * after chat.validation.js has already rejected anything invalid, so by the
 * time this is called `effort` is either one of the two known strings or
 * absent. a third, unrecognised value reaching this function anyway (a
 * caller inside the codebase, not through the validated API) degrades to
 * "no override" rather than crashing the request over an effort label.
 */
export function resolveEffortOverrides(effort) {
  return EFFORT_PROFILES[effort] ?? {};
}

/**
 * scales a question's topN by the resolved effort's multiplier.
 *
 * `overrides` is whatever `resolveEffortOverrides` returned -- no
 * `topNScale` field means no change, so an omitted or unrecognised effort
 * leaves topN exactly as the intent/route lookup table produced it
 * (queryTaxonomy.js's TOP_N_FOR_INTENT_ROUTE).
 */
export function applyEffortToTopN(topN, overrides) {
  const scale = overrides?.topNScale;

  if (typeof scale !== "number" || !Number.isFinite(scale)) return topN;

  return Math.max(1, Math.round(topN * scale));
}

export default {
  EFFORT_LEVELS,
  ALL_EFFORT_LEVELS,
  resolveEffortOverrides,
  applyEffortToTopN,
};
