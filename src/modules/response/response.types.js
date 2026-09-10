export const RESPONSE_CONTRACT_VERSION = 2;


export const RESPONSE_SECTION_IDS =
  Object.freeze({
    SUMMARY: "summary",
    SOURCES: "sources",
    DATE: "date",
    EXPLANATION: "explanation",
  });


export const RESPONSE_SECTION_ORDER =
  Object.freeze([
    RESPONSE_SECTION_IDS.SUMMARY,
    RESPONSE_SECTION_IDS.SOURCES,
    RESPONSE_SECTION_IDS.DATE,
    RESPONSE_SECTION_IDS.EXPLANATION,
  ]);


const RESPONSE_SECTION_TITLES =
  Object.freeze({
    [RESPONSE_SECTION_IDS.SUMMARY]:
      "Summary",

    [RESPONSE_SECTION_IDS.SOURCES]:
      "Sources",

    [RESPONSE_SECTION_IDS.DATE]:
      "Date",

    [RESPONSE_SECTION_IDS.EXPLANATION]:
      "Explanation",
  });


function requireNonEmptyString(
  value,
  fieldName,
) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new TypeError(
      `${fieldName} must be a non-empty string`,
    );
  }

  return value.trim();
}


function createSection(
  id,
  content,
) {
  return Object.freeze({
    id,

    title:
      RESPONSE_SECTION_TITLES[id],

    content:
      requireNonEmptyString(
        content,
        id,
      ),
  });
}


/**
 * Creates the fixed coach-facing response template.
 *
 * The order is deliberately owned by the backend contract.
 * Callers cannot rearrange the four required sections.
 *
 * 1. Summary
 * 2. Sources
 * 3. Date
 * 4. Explanation
 */
export function createResponseSections({
  summary,
  sources,
  date,
  explanation,
} = {}) {
  return Object.freeze([
    createSection(
      RESPONSE_SECTION_IDS.SUMMARY,
      summary,
    ),

    createSection(
      RESPONSE_SECTION_IDS.SOURCES,
      sources,
    ),

    createSection(
      RESPONSE_SECTION_IDS.DATE,
      date,
    ),

    createSection(
      RESPONSE_SECTION_IDS.EXPLANATION,
      explanation,
    ),
  ]);
}


/**
 * Common response contract returned by the
 * TennisExplore intelligence pipeline.
 *
 * Version 2 adds a mandatory, deterministic
 * four-section coach-facing presentation while
 * preserving the existing machine-facing fields.
 */
export function createIntelligenceResponse({
  answered = false,

  answer = null,

  summary,
  sources,
  date,
  explanation,

  intent = null,

  actions = [],

  citations = [],

  data = null,

  verification = null,

  telemetry = {},

  metadata = {},
} = {}) {
  if (
    answer !== null &&
    (
      typeof answer !== "string" ||
      !answer.trim()
    )
  ) {
    throw new TypeError(
      "answer must be null or a non-empty string",
    );
  }

  if (
    intent !== null &&
    (
      typeof intent !== "string" ||
      !intent.trim()
    )
  ) {
    throw new TypeError(
      "intent must be null or a non-empty string",
    );
  }

  if (!Array.isArray(actions)) {
    throw new TypeError(
      "actions must be an array",
    );
  }

  if (!Array.isArray(citations)) {
    throw new TypeError(
      "citations must be an array",
    );
  }

  const sections =
    createResponseSections({
      summary,
      sources,
      date,
      explanation,
    });


  return Object.freeze({
    contractVersion:
      RESPONSE_CONTRACT_VERSION,

    answered:
      Boolean(answered),

    sections,

    /*
     * Existing compatibility field.
     *
     * This remains the raw/full synthesis answer.
     * The four-section presentation is represented
     * separately by `sections`.
     */
    answer:
      typeof answer === "string"
        ? answer.trim()
        : null,

    intent:
      typeof intent === "string"
        ? intent.trim()
        : null,

    actions:
      Object.freeze([
        ...actions,
      ]),

    citations:
      Object.freeze([
        ...citations,
      ]),

    data,

    verification,

    telemetry:
      Object.freeze({
        ...telemetry,
      }),

    metadata:
      Object.freeze({
        ...metadata,
      }),
  });
}