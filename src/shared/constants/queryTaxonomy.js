// the query taxonomy the partner asked for, written down in one place.
//
// this comes straight from al's brief, and the names are his rather than ours on
// purpose -- when he asks "how are we doing on multi-hop", the answer should
// come from a field literally called multi_hop rather than from someone
// translating in their head.
//
// the shape of the whole thing:
//
//   what the question IS  ->  where the answer LIVES  ->  what the answer LOOKS LIKE
//        (intent)                    (route)                     (contract)
//
// the important design decision is that the CONTRACT is chosen by the route and
// the intent, not by the language model. the model decides what a question is
// asking for; it never decides whether the reply contains a table. otherwise the
// same question gets prose one day and a table the next, and nothing downstream
// can rely on the shape.

// ---------------------------------------------------------------------------
// where the answer lives
// ---------------------------------------------------------------------------
export const ROUTES = Object.freeze({
  UNSTRUCTURED: "unstructured", // pdfs, slide decks, video segments
  STRUCTURED: "structured", // csv and xlsx tables
  HYBRID: "hybrid", // both, e.g. prose summary plus the table behind it
  OUT_OF_SCOPE: "out_of_scope", // nothing we hold could answer this
});

// ---------------------------------------------------------------------------
// what the question is asking for
// ---------------------------------------------------------------------------
export const INTENTS = Object.freeze({
  // --- unstructured -------------------------------------------------------
  // one fact, in one place. "what year was the cardio tennis paper published"
  SINGLE_HOP: "single_hop",
  // needs two or more separate lookups joined together. "how do the findings of
  // the periodisation paper compare with what the catapult deck recommends"
  MULTI_HOP: "multi_hop",
  // condense a lot of material. "summarise the recovery research"
  SUMMARISATION: "summarisation",

  // --- structured ---------------------------------------------------------
  // a precise lookup of one entity's value. "what is player x's best ranking"
  ANALYTICAL: "analytical",
  // set against set. "men's versus women's serve speed at the australian open"
  COMPARATIVE: "comparative",
  // maths over many rows. "median change in serve speed year on year"
  AGGREGATION: "aggregation",
});

// ---------------------------------------------------------------------------
// what the answer has to look like
// ---------------------------------------------------------------------------
export const CONTRACTS = Object.freeze({
  // prose, every claim carrying a citation marker. the default for unstructured.
  ATTRIBUTED: "attributed",
  // rewritten in our own words. used for summaries, still cited.
  ABSTRACTIVE: "abstractive",
  // quoted verbatim from the source. used when the exact wording is the answer,
  // e.g. a definition or a policy clause, where paraphrasing loses the point.
  EXTRACTIVE: "extractive",
  // a table.
  TABULAR: "tabular",
  // machine-readable rows, for the frontend to chart.
  STRUCTURED_JSON: "structured_json",
  // the query we ran, shown so the number can be checked.
  CODE_SQL: "code_sql",
});

// which contracts each intent produces. an intent can produce several -- a
// comparison returns a table AND the json behind it AND the sql that made it,
// because al asked for the number, the picture and the audit trail.
export const CONTRACTS_FOR_INTENT = Object.freeze({
  [INTENTS.SINGLE_HOP]: [CONTRACTS.ATTRIBUTED, CONTRACTS.EXTRACTIVE],
  [INTENTS.MULTI_HOP]: [CONTRACTS.ATTRIBUTED],
  [INTENTS.SUMMARISATION]: [CONTRACTS.ABSTRACTIVE, CONTRACTS.ATTRIBUTED],
  [INTENTS.ANALYTICAL]: [CONTRACTS.TABULAR, CONTRACTS.STRUCTURED_JSON, CONTRACTS.CODE_SQL],
  [INTENTS.COMPARATIVE]: [CONTRACTS.TABULAR, CONTRACTS.STRUCTURED_JSON, CONTRACTS.CODE_SQL],
  [INTENTS.AGGREGATION]: [CONTRACTS.TABULAR, CONTRACTS.STRUCTURED_JSON, CONTRACTS.CODE_SQL],
});

export const ROUTE_FOR_INTENT = Object.freeze({
  [INTENTS.SINGLE_HOP]: ROUTES.UNSTRUCTURED,
  [INTENTS.MULTI_HOP]: ROUTES.UNSTRUCTURED,
  [INTENTS.SUMMARISATION]: ROUTES.UNSTRUCTURED,
  [INTENTS.ANALYTICAL]: ROUTES.STRUCTURED,
  [INTENTS.COMPARATIVE]: ROUTES.STRUCTURED,
  [INTENTS.AGGREGATION]: ROUTES.STRUCTURED,
});

// how many chunks each intent needs. a summary genuinely needs breadth; a single
// fact does not, and giving a local 8b model thirty chunks to find one date in
// makes the answer worse, not better.
export const TOP_N_FOR_INTENT = Object.freeze({
  [INTENTS.SINGLE_HOP]: 8,
  [INTENTS.MULTI_HOP]: 14,
  [INTENTS.SUMMARISATION]: 20,
  [INTENTS.ANALYTICAL]: 6,
  [INTENTS.COMPARATIVE]: 10,
  [INTENTS.AGGREGATION]: 6,
});

export const ALL_INTENTS = Object.freeze(Object.values(INTENTS));
export const ALL_ROUTES = Object.freeze(Object.values(ROUTES));
