// the query taxonomy, v2.
//
// v1 came straight from al's brief and named intents after retrieval mechanics
// he asked to track (single_hop, multi_hop, analytical, comparative,
// aggregation). the brief has since been revised: al no longer wants "how many
// sources did this need" as a category a question is filed under -- that is a
// retrieval-strategy detail, not something a question is ABOUT -- and wants
// comparison to mean comparing content (two papers, two findings), not only
// comparing rows in a table.
//
// the shape is still:
//
//   what the question IS  ->  where the answer LIVES  ->  what the answer LOOKS LIKE
//        (intent)                    (route)                     (contract)
//
// but intent and route are now independent. v1 conflated them (an intent's
// route was a fixed lookup), which is exactly what produced categories like
// "analytical" and "single_hop" that were really naming a source type, not a
// question type. route is decided separately, from what the question's
// vocabulary is actually about -- see classifyRoute in queryPlanner.service.js.
// the same intent (a fact, a comparison) can resolve to either route.
//
// chitchat is deliberately NOT one of these. it never reaches this taxonomy at
// all -- see chitchat.service.js -- because it has no route and no contract to
// choose; making it an intent here would mean every consumer of INTENTS has to
// handle a case that carries no evidence, which is a different kind of thing
// than the other three.

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
  // one specific answer -- a fact from a document, a value from a table, or
  // several lookups joined together (what v1 called multi_hop). whether that
  // takes one retrieval pass or several, and whether it reads prose or a
  // table, is decided elsewhere: it is not part of what makes a question a
  // fact-retrieval question.
  FACT_RETRIEVAL: "fact_retrieval",
  // condense a lot of material. "summarise the recovery research"
  SUMMARISATION: "summarisation",
  // set two or more things against each other -- two papers' findings, two
  // players' records, men's vs women's serve speed. v1 split this by source
  // (comparative for tables, an unlabelled corner of multi_hop for documents);
  // the question "compare X and Y" is the same question either way.
  COMPARISON: "comparison",
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

// which contracts each intent CAN produce -- the actual shape for one answer is
// narrowed further by the route it resolved to (see answerContract.service.js).
export const CONTRACTS_FOR_INTENT = Object.freeze({
  [INTENTS.FACT_RETRIEVAL]: [
    CONTRACTS.ATTRIBUTED,
    CONTRACTS.EXTRACTIVE,
    CONTRACTS.TABULAR,
    CONTRACTS.STRUCTURED_JSON,
    CONTRACTS.CODE_SQL,
  ],
  [INTENTS.SUMMARISATION]: [CONTRACTS.ABSTRACTIVE, CONTRACTS.ATTRIBUTED],
  [INTENTS.COMPARISON]: [
    CONTRACTS.ATTRIBUTED,
    CONTRACTS.TABULAR,
    CONTRACTS.STRUCTURED_JSON,
    CONTRACTS.CODE_SQL,
  ],
});

// how many chunks/rows each intent needs, by the route it resolved to. a table
// lookup and a document lookup are not the same amount of context, which a flat
// per-intent number used to quietly assume.
export const TOP_N_FOR_INTENT_ROUTE = Object.freeze({
  [INTENTS.FACT_RETRIEVAL]: Object.freeze({
    [ROUTES.UNSTRUCTURED]: 8,
    [ROUTES.STRUCTURED]: 6,
  }),
  [INTENTS.SUMMARISATION]: Object.freeze({
    [ROUTES.UNSTRUCTURED]: 20,
    [ROUTES.STRUCTURED]: 10,
  }),
  [INTENTS.COMPARISON]: Object.freeze({
    [ROUTES.UNSTRUCTURED]: 12,
    [ROUTES.STRUCTURED]: 10,
  }),
});

// widened topN once a question turns out to need more than one retrieval pass
// (what v1 called multi_hop) -- decided from plan.subQuestions.length, not from
// intent, so it applies under fact-retrieval or comparison equally.
export const DECOMPOSED_TOP_N = 14;

export const ALL_INTENTS = Object.freeze(Object.values(INTENTS));
export const ALL_ROUTES = Object.freeze(Object.values(ROUTES));
