// works out what a question is asking for, before we go looking for the answer.
//
// -------------------------------------------------------------------------
// why this is not "function calling"
// -------------------------------------------------------------------------
// the obvious way to build this is to hand the model a set of tools --
// search_documents(), query_table(), summarise() -- and let it choose. that is
// how the hosted assistants do it, and on a frontier model it works well.
//
// it works badly here, for three reasons.
//
// 1. we run llama3.1:8b locally. small models emit tool calls with invented
//    argument names, missing required fields, or a plausible function that does
//    not exist. every one of those is a failed request unless you write repair
//    logic, and once you have written the repair logic you have written this
//    file anyway.
//
// 2. a tool call is a decision to ACT. we do not want the model deciding to run
//    an aggregation over athlete data; we want it to tell us what the coach
//    asked for, and then OUR code decides what runs. that difference matters
//    when there is an access filter involved -- a model that picks the tool can
//    be talked into picking a different one.
//
// 3. the partner asked for specific output shapes per question type. if the
//    model chooses the tool, the model implicitly chooses the shape, and the
//    same question returns prose on monday and a table on tuesday.
//
// so instead: the model fills in a FORM. one call, constrained to a json schema,
// no side effects. it classifies and extracts; it never dispatches. our code
// reads the form and decides what to run. this is the same idea as constrained
// decoding / structured outputs, and it is far more reliable on a small local
// model than free-form tool selection.
//
// and before we even make that call, a set of rules has a go for free. on a
// clear-cut question the rules are right and we skip the model entirely, which
// saves about a second per query.

import { retrievalConfig } from "../../config/retrieval.config.js";
import {
  ALL_INTENTS,
  INTENTS,
  ROUTES,
  ROUTE_FOR_INTENT,
  CONTRACTS_FOR_INTENT,
  TOP_N_FOR_INTENT,
} from "../../shared/constants/queryTaxonomy.js";

// ---------------------------------------------------------------------------
// stage 1: rules
// ---------------------------------------------------------------------------

// wording that means "do arithmetic over many rows". these are the questions
// retrieval fundamentally cannot answer -- you cannot find a median by looking
// for a chunk that contains it, because no chunk contains it.
const AGGREGATION_SIGNALS = [
  /\b(average|mean|median|total|sum|count|how many|number of)\b/i,
  /\b(year on year|year-over-year|over time|trend|distribution|across all)\b/i,
  /\b(percentage|percentile|proportion|rate)\b/i,
];

// superlatives are ambiguous and it is worth being explicit about why.
//
// "what is player x's best ranking" is a LOOKUP -- one named entity, one value,
// straight out of a record. al gave that exact example as the simple case.
// "who had the highest beep test result" is an AGGREGATION -- it ranks a whole
// population to find the top of it.
//
// the words are identical. the difference is whether one entity is named. so the
// rule below does not try to settle it: it routes to structured either way and
// leaves the intent to the planner, which has the entity list.
const SUPERLATIVE_SIGNALS = [
  /\b(highest|lowest|best|worst|top|bottom|fastest|slowest|most|least)\b/i,
];

const COMPARISON_SIGNALS = [
  /\bcompare\b|\bcomparison\b/i,
  /\bversus\b|\bvs\.?\b/i,
  /\bdifference(s)? between\b/i,
  /\b(men'?s?|women'?s?)\s+and\s+(men'?s?|women'?s?)\b/i,
  /\bside by side\b/i,
  /\bbetween\b.+\band\b/i,
];

const SUMMARY_SIGNALS = [
  /\b(summar(y|ise|ize)|overview|executive summary|brief me|what do we know about)\b/i,
  /\b(everything|all the research|the literature)\b/i,
];

const MULTI_HOP_SIGNALS = [
  /\band also\b/i,
  /\bhow (do|does) .+ (relate|compare|differ)/i,
  /\b(both|each of)\b/i,
  /\?.*\?/, // two question marks means two questions
];

// vocabulary that only exists in the tables. if a question uses these words it
// is almost certainly asking about records rather than about prose.
//
// note the optional plurals everywhere. an earlier version wrote `serve speed`
// without them and silently failed to match "serve speeds", which sent the
// partner's own example question down the document route.
const STRUCTURED_VOCABULARY =
  /\b(rankings?|matches|match|scores?|opponents?|tournaments?|rounds?|surfaces?|seeds?|draws?|win rate|aces?|double faults?|serve speeds?|beep test|results?|player \w+'?s?)\b/i;

// vocabulary that only exists in the documents.
const UNSTRUCTURED_VOCABULARY =
  /\b(papers?|stud(y|ies)|research|articles?|publications?|authors?|presentations?|slides?|decks?|says?|claims?|findings?|methodology|abstract|videos?|clips?|footage|according to)\b/i;

/**
 * a first guess, from rules alone.
 *
 * returns a confidence as well as an intent. high confidence means we skip the
 * model call; low confidence means we ask. the thresholds are deliberately
 * conservative -- being wrong about the route is expensive (an aggregation
 * question routed to retrieval gets a confidently wrong answer), so anything
 * ambiguous goes to the model.
 */
export function ruleBasedPlan(question) {
  const text = String(question);

  const structured = STRUCTURED_VOCABULARY.test(text);
  const unstructured = UNSTRUCTURED_VOCABULARY.test(text);
  const aggregating = AGGREGATION_SIGNALS.some((pattern) => pattern.test(text));
  const superlative = SUPERLATIVE_SIGNALS.some((pattern) => pattern.test(text));
  const comparing = COMPARISON_SIGNALS.some((pattern) => pattern.test(text));
  const summarising = SUMMARY_SIGNALS.some((pattern) => pattern.test(text));
  const multiHop = MULTI_HOP_SIGNALS.some((pattern) => pattern.test(text));

  // real arithmetic over table vocabulary is the one case the rules are
  // reliably right about, and also the case where being wrong is worst -- an
  // aggregation sent to retrieval returns a confident, wrong number.
  if (aggregating && structured && !unstructured) {
    return { intent: comparing ? INTENTS.COMPARATIVE : INTENTS.AGGREGATION, confidence: 0.9 };
  }

  if (summarising && !structured) {
    return { intent: INTENTS.SUMMARISATION, confidence: 0.85 };
  }

  if (comparing && structured && !unstructured) {
    return { intent: INTENTS.COMPARATIVE, confidence: 0.8 };
  }

  // a superlative over table vocabulary. analytical is the safer default of the
  // two candidates -- it is the narrower query, and the planner has the entity
  // list needed to widen it to an aggregation. confidence is deliberately below
  // the floor so the planner always gets asked.
  if (superlative && structured && !unstructured) {
    return { intent: INTENTS.ANALYTICAL, confidence: 0.5 };
  }

  // plain table vocabulary with no aggregation wording: a lookup.
  if (structured && !unstructured && !multiHop) {
    return { intent: INTENTS.ANALYTICAL, confidence: 0.6 };
  }

  if (multiHop && unstructured) {
    return { intent: INTENTS.MULTI_HOP, confidence: 0.7 };
  }

  if (unstructured && !structured && !multiHop && !summarising) {
    return { intent: INTENTS.SINGLE_HOP, confidence: 0.65 };
  }

  // genuinely ambiguous. say so rather than guessing -- a low confidence here
  // is what buys the planner call.
  return { intent: INTENTS.SINGLE_HOP, confidence: 0.3 };
}

// ---------------------------------------------------------------------------
// stage 2: the form the model fills in
// ---------------------------------------------------------------------------

// this is a json schema, handed to ollama as its `format`. modern ollama
// constrains decoding to the schema, so the model physically cannot emit an
// invalid intent -- which removes the single most common failure of the
// tool-calling approach. on an older build that ignores `format`, the validator
// below catches it instead.
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ALL_INTENTS },
    entities: {
      type: "array",
      items: { type: "string" },
      description: "player names, tournaments, authors, document titles mentioned",
    },
    metrics: {
      type: "array",
      items: { type: "string" },
      description: "what is being measured, e.g. serve speed, ranking, load",
    },
    timeframe: { type: "string", description: "any period mentioned, or empty" },
    subQuestions: {
      type: "array",
      items: { type: "string" },
      description: "for multi-hop only: the separate lookups needed",
    },
    needsExactWording: {
      type: "boolean",
      description: "true if the user wants a definition or quote verbatim",
    },
  },
  required: ["intent", "entities", "metrics", "timeframe", "subQuestions", "needsExactWording"],
};

const PLANNER_SYSTEM_PROMPT = `You classify questions about a tennis performance knowledge base. You do not answer them.

The knowledge base holds two kinds of material:
- DOCUMENTS: research papers, slide decks, video clips. Prose and findings.
- TABLES: match records, rankings, test results. Rows and numbers.

Choose exactly one intent:
- single_hop: one fact found in one document.
- multi_hop: needs two or more separate lookups joined together.
- summarisation: asks you to condense or overview a body of material.
- analytical: looks up a specific value for a specific entity in the tables.
- comparative: sets two or more groups against each other in the tables.
- aggregation: requires arithmetic over many rows (average, median, total, count, trend).

Rules:
- If the question needs a calculation over many records, it is aggregation or comparative, never single_hop.
- If the question asks what a paper, author, presentation or video says, it is single_hop, multi_hop or summarisation.
- Extract entities and metrics exactly as the user wrote them. Do not invent any.
- Leave a field empty rather than guessing.`;

async function callPlanner(question, { signal }) {
  const response = await fetch(`${retrievalConfig.generation.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: retrievalConfig.query.plannerModel,
      stream: false,
      // constrained decoding. this is the whole trick.
      format: PLAN_SCHEMA,
      // temperature 0: the same question must classify the same way every time,
      // or the answer shape becomes non-deterministic and nothing downstream can
      // be tested.
      options: { temperature: 0, num_predict: 300 },
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
    }),
    signal,
  });

  if (!response.ok) throw new Error(`planner returned ${response.status}`);

  const payload = await response.json();

  return JSON.parse(payload.message?.content ?? "{}");
}

/**
 * validates whatever came back.
 *
 * we do not trust the schema to have been enforced. an older ollama build
 * ignores `format` silently, and a model given free rein will happily return
 * `{"intent": "lookup"}`. anything that fails here falls back to the rules,
 * which is a worse plan but never an invalid one.
 */
function validatePlan(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!ALL_INTENTS.includes(raw.intent)) return null;

  const asStringArray = (value) =>
    Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "") : [];

  return {
    intent: raw.intent,
    entities: asStringArray(raw.entities).slice(0, 10),
    metrics: asStringArray(raw.metrics).slice(0, 10),
    timeframe: typeof raw.timeframe === "string" ? raw.timeframe.trim() : "",
    subQuestions: asStringArray(raw.subQuestions).slice(0, retrievalConfig.query.maxSubQueries),
    needsExactWording: raw.needsExactWording === true,
  };
}

// ---------------------------------------------------------------------------
// the public entry point
// ---------------------------------------------------------------------------

/**
 * produces the plan everything downstream reads.
 *
 * the plan is a description of the question, never an instruction to run
 * something. `route`, `contracts` and `topN` are derived from the intent by
 * lookup tables in the taxonomy -- the model does not get a say in those, which
 * is what makes the output shape stable.
 */
export async function planQuery(question, { signal = null } = {}) {
  if (typeof question !== "string" || question.trim() === "") {
    throw new Error("planQuery requires a non-empty question.");
  }

  const rules = ruleBasedPlan(question);

  let plan = {
    intent: rules.intent,
    entities: [],
    metrics: [],
    timeframe: "",
    subQuestions: [],
    needsExactWording: false,
  };

  let source = "rules";

  // only pay for the model when the rules are unsure, or when we need the
  // entities and metrics extracted for a table query.
  const needsModel =
    retrievalConfig.query.plannerEnabled &&
    (rules.confidence < retrievalConfig.query.plannerConfidenceFloor ||
      ROUTE_FOR_INTENT[rules.intent] === ROUTES.STRUCTURED);

  if (needsModel) {
    try {
      const validated = validatePlan(await callPlanner(question, { signal }));

      if (validated) {
        plan = validated;
        source = "model";
      } else {
        source = "rules_after_invalid_model_output";
      }
    } catch {
      // planner unreachable. the rules are a worse plan, not no plan, so the
      // request continues rather than failing. a chatbot that 500s because a
      // classifier was down is worse than one that occasionally over-retrieves.
      source = "rules_after_planner_error";
    }
  }

  const route = ROUTE_FOR_INTENT[plan.intent];

  return {
    question,
    intent: plan.intent,
    route,
    contracts: CONTRACTS_FOR_INTENT[plan.intent],
    topN: TOP_N_FOR_INTENT[plan.intent],
    entities: plan.entities,
    metrics: plan.metrics,
    timeframe: plan.timeframe,
    subQuestions: plan.subQuestions,
    needsExactWording: plan.needsExactWording,
    planSource: source,
    ruleConfidence: rules.confidence,
  };
}

export { PLAN_SCHEMA };
