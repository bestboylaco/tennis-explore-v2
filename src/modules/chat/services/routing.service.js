import {
  API_TYPES,
  PIPELINE_STAGES,
  QUERY_CLASSES,
} from "../../../shared/constants/telemetry.js";

// Routing stage of the RAG pipeline (TENISE-30). Decides which class a question
// belongs to so telemetry can report latency per class rather than one blended
// figure, and so the retrieval branch has something to switch on when it lands.
//
// Deliberately rule based rather than a model call. A classifier LLM would add
// seconds to every query and would make the routing latency figure a
// measurement of a second model round trip instead of routing -- which defeats
// the point of measuring the stage separately. Epic 3 (E3-09) replaces the
// rules behind the same classifyQuery interface when a real router exists.

// Ordered: the first match wins, so a more specific rule must come first.
// Rule names are what reach telemetry, so they are short and content free.
const CLASSIFICATION_RULES = [
  { rule: "head_to_head", pattern: /\bhead[\s-]?to[\s-]?head\b|\brecord\s+(?:against|versus|vs\.?)\b/i },
  { rule: "count", pattern: /\bhow\s+many\b|\bhow\s+often\b|\bnumber\s+of\b|\btotal\s+(?:number|count)\b/i },
  { rule: "rate", pattern: /\bwin\s+rate\b|\bpercentage\b|\bper\s?cent\b|\bratio\b|\baverage\b|\bmean\b|\bmedian\b/i },
  { rule: "ranking", pattern: /\brank(?:ed|ing|ings)?\b|\bmost\b|\bfewest\b|\bhighest\b|\blowest\b|\btop\s+\d+\b|\bbest\b/i },
  { rule: "statistics_term", pattern: /\bstat(?:s|istic|istics)\b|\bscoreline\b|\bwin[\s-]loss\b|\btally\b/i },
  { rule: "season_figures", pattern: /\bin\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s+season\b/i },
];

/**
 * Classifies one question.
 *
 * Returns the class and the name of the rule that decided it. The rule name is
 * recorded on the telemetry stage; the question text never is (threat model
 * T-04 -- telemetry stores metadata, never content).
 */
export function classifyQuery(question) {
  const text = typeof question === "string" ? question : "";

  if (text.trim() === "") {
    return { queryClass: QUERY_CLASSES.NOT_APPLICABLE, rule: "empty_question" };
  }

  for (const { rule, pattern } of CLASSIFICATION_RULES) {
    if (pattern.test(text)) {
      return { queryClass: QUERY_CLASSES.STATISTICS, rule };
    }
  }

  // A question that asks for explanation or technique rather than figures.
  // This is the fallback, not a default nobody chose: no statistics rule
  // matched, which is itself the decision.
  return { queryClass: QUERY_CLASSES.DOCUMENT, rule: "no_statistics_signal" };
}

/**
 * Runs classification as a measured pipeline stage and tags the record with the
 * class it decided.
 *
 * The recorder is optional so the stage stays callable (and testable) without
 * telemetry, matching generateAnswer.
 */
export async function routeQuery({ question, recorder = null }) {
  if (!recorder) {
    return classifyQuery(question);
  }

  const result = await recorder.measureStage(
    PIPELINE_STAGES.ROUTING,
    async () => {
      const classification = classifyQuery(question);

      return {
        ...classification,
        // Which rule fired, never what it matched.
        telemetry: { attributes: { rule: classification.rule } },
      };
    },
    {
      // Local CPU work: no network call, so no API type beyond "local", no
      // cold start wrapper, and no OCU resource to charge it to.
      apiType: API_TYPES.LOCAL,
      itemsIn: 1,
      itemsOut: 1,
    },
  );

  recorder.setQueryClass(result.queryClass);

  return result;
}
