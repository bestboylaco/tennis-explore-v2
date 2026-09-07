import {
  createIntelligenceResponse,
} from "./response.types.js";


function cleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .map(cleanString)
        .filter(Boolean),
    ),
  ];
}


/**
 * Documents synthesis intentionally leaves citations
 * empty until grounding verification binds them.
 *
 * Therefore final response formatting checks:
 *
 * 1. explicitly supplied citations
 * 2. verified document-grounding citations
 * 3. synthesis citations
 */
function resolveCitations({
  citations,
  synthesisResult,
  verificationResult,
}) {
  if (Array.isArray(citations)) {
    return citations;
  }

  const groundingCitations =
    verificationResult
      ?.checks
      ?.document_grounding
      ?.metadata
      ?.citations;

  if (
    Array.isArray(groundingCitations) &&
    groundingCitations.length > 0
  ) {
    return groundingCitations;
  }

  if (
    Array.isArray(
      synthesisResult?.citations,
    )
  ) {
    return synthesisResult.citations;
  }

  return [];
}


function formatActionName(actionId) {
  const value =
    cleanString(actionId);

  if (!value) {
    return null;
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}


function formatCitationLocation(
  citation,
) {
  const parts = [];

  if (
    Number.isInteger(citation?.page)
  ) {
    parts.push(
      `page ${citation.page}`,
    );
  }

  if (
    Number.isInteger(citation?.slide)
  ) {
    parts.push(
      `slide ${citation.slide}`,
    );
  }

  const timestamp =
    cleanString(
      citation?.timestamp ??
      citation?.timecode ??
      citation?.startTime,
    );

  if (timestamp) {
    parts.push(
      `timestamp ${timestamp}`,
    );
  }

  return parts.length > 0
    ? ` (${parts.join(", ")})`
    : "";
}


function formatCitation(
  citation,
  index,
) {
  const number =
    Number.isInteger(
      citation?.number,
    )
      ? citation.number
      : index + 1;

  const label =
    cleanString(
      citation?.title ??
      citation?.fileName ??
      citation?.docId ??
      citation?.sourceType,
    ) ||
    "Evidence source";

  return (
    `[${number}] ${label}` +
    formatCitationLocation(
      citation,
    )
  );
}


/**
 * Sources means both:
 *
 * - what capabilities/sources were searched
 * - what evidence was actually cited
 *
 * This distinction matters for refusals:
 * citations may be empty even though a real search occurred.
 */
function buildSourcesSection({
  actions,
  citations,
}) {
  const searched =
    uniqueStrings(
      actions
        .map(formatActionName)
        .filter(Boolean),
    );

  const lines = [];

  if (searched.length > 0) {
    lines.push(
      `Searched: ${searched.join(", ")}.`,
    );
  } else {
    lines.push(
      "Searched: No search source was recorded.",
    );
  }

  if (citations.length > 0) {
    lines.push(
      "Evidence used:",
    );

    citations.forEach(
      (citation, index) => {
        lines.push(
          formatCitation(
            citation,
            index,
          ),
        );
      },
    );
  } else {
    lines.push(
      "Evidence used: None.",
    );
  }

  return lines.join("\n");
}


function normalizeResponseDate(
  responseDate,
  timeZone,
) {
  const value =
    responseDate instanceof Date
      ? responseDate
      : new Date(responseDate);


  if (
    Number.isNaN(
      value.getTime(),
    )
  ) {
    throw new TypeError(
      "responseDate must be a valid Date or date value",
    );
  }


  if (
    typeof timeZone !== "string" ||
    !timeZone.trim()
  ) {
    throw new TypeError(
      "responseTimeZone must be a non-empty string",
    );
  }


  let parts;

  try {
    parts =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            timeZone.trim(),

          year:
            "numeric",

          month:
            "2-digit",

          day:
            "2-digit",
        },
      ).formatToParts(
        value,
      );
  } catch {
    throw new TypeError(
      `Invalid responseTimeZone: "${timeZone}"`,
    );
  }


  const values =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );


  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
  );
}


function collectSourceDates(
  citations,
) {
  return uniqueStrings(
    citations.map(
      (citation) =>
        citation?.date,
    ),
  );
}


function buildDateSection({
  responseDate,
  responseTimeZone,
  citations,
}) {
  const generatedDate =
    normalizeResponseDate(
      responseDate,
      responseTimeZone,
    );

  const sourceDates =
    collectSourceDates(
      citations,
    );

  const lines = [
    `Response date: ${generatedDate}`,
  ];

  if (sourceDates.length > 0) {
    lines.push(
      `Evidence dates: ${sourceDates.join(", ")}`,
    );
  } else {
    lines.push(
      "Evidence dates: Not available",
    );
  }

  return lines.join("\n");
}


function buildRefusalSummary(
  refusal,
) {
  const explicitAnswer =
    cleanString(
      refusal?.answer,
    );

  if (explicitAnswer) {
    return explicitAnswer;
  }

  if (
    refusal?.cause ===
    "access_denied"
  ) {
    return (
      "The information required to answer this question " +
      "is not available to the current role."
    );
  }

  return (
    "The available evidence is insufficient " +
    "to answer this question."
  );
}


function buildRefusalExplanation(
  refusal,
) {
  const reason =
    cleanString(
      refusal?.reason,
    );

  if (
    refusal?.cause ===
    "access_denied"
  ) {
    if (reason) {
      return (
        "The authorised sources were searched, but access " +
        `controls prevented the required evidence from being used. ${reason}`
      );
    }

    return (
      "The authorised sources were searched, but access " +
      "controls prevented the evidence required to answer " +
      "the question from being used."
    );
  }

  if (reason) {
    return (
      "The available sources were searched, but the evidence " +
      `was insufficient to support an answer. ${reason}`
    );
  }

  return (
    "The available sources were searched, but the retrieved " +
    "evidence was insufficient to support the requested answer. " +
    "No unsupported answer was returned."
  );
}


function collectVerificationIssues(
  verificationResult,
) {
  if (
    !Array.isArray(
      verificationResult?.issues,
    )
  ) {
    return [];
  }

  return verificationResult
    .issues
    .map(cleanString)
    .filter(Boolean);
}


function buildVerificationFailureExplanation(
  verificationResult,
) {
  const issues =
    collectVerificationIssues(
      verificationResult,
    );

  if (issues.length > 0) {
    return (
      "A draft answer was produced but was withheld because " +
      `verification failed: ${issues.join("; ")}`
    );
  }

  return (
    "A draft answer was produced but was withheld because " +
    "it did not pass the required verification checks."
  );
}


function buildSuccessfulExplanation({
  synthesisResult,
  verificationResult,
  actions,
}) {
  const actionNames =
    uniqueStrings(
      actions
        .map(formatActionName)
        .filter(Boolean),
    );

  const actionText =
    actionNames.length > 0
      ? actionNames.join(", ")
      : "available evidence";

  if (
    verificationResult
      ?.verified === true
  ) {
    return (
      `This answer was produced from ${actionText} ` +
      "and passed the configured verification checks."
    );
  }

  const mode =
    cleanString(
      synthesisResult?.mode,
    );

  if (mode) {
    return (
      `This answer was produced from the available ${mode} evidence.`
    );
  }

  return (
    "This answer was produced from the available evidence."
  );
}


/**
 * Converts synthesis / verification output into the single
 * coach-facing IntelligenceResponse contract.
 *
 * This function does not call an LLM.
 * It does not retrieve evidence.
 * It does not execute Actions.
 *
 * It only formats already-produced backend results.
 */
export function formatIntelligenceResponse({
  synthesisResult = null,

  verificationResult = null,

  refusal = null,

  intent = null,

  actions = [],

  citations,

  data,

  telemetry = {},

  metadata = {},

  responseDate = new Date(),

  responseTimeZone = "UTC",
} = {}) {
  if (!Array.isArray(actions)) {
    throw new TypeError(
      "actions must be an array",
    );
  }


  const resolvedCitations =
    resolveCitations({
      citations,
      synthesisResult,
      verificationResult,
    });


  const sources =
    buildSourcesSection({
      actions,
      citations:
        resolvedCitations,
    });


  const date =
    buildDateSection({
      responseDate,

      responseTimeZone,

      citations:
        resolvedCitations,
    });


  /*
   * Explicit refusal always wins.
   */
  if (refusal) {
    const summary =
      buildRefusalSummary(
        refusal,
      );

    const explanation =
      buildRefusalExplanation(
        refusal,
      );

    return createIntelligenceResponse({
      answered: false,

      answer:
        summary,

      summary,

      sources,

      date,

      explanation,

      intent,

      actions,

      citations:
        resolvedCitations,

      data:
        data ?? null,

      verification:
        verificationResult,

      telemetry,

      metadata: {
        ...metadata,

        cause:
          refusal.cause ??
          "not_found",

        reason:
          refusal.reason ??
          null,
      },
    });
  }


  /*
   * A synthesis result that explicitly says it could not
   * answer becomes a structured refusal rather than bare text.
   */
  if (
    synthesisResult?.answered !== true
  ) {
    const syntheticRefusal = {
      cause:
        "insufficient_evidence",

      answer:
        synthesisResult?.answer ??
        null,

      reason:
        synthesisResult
          ?.metadata
          ?.reason ??
        null,
    };

    const summary =
      buildRefusalSummary(
        syntheticRefusal,
      );

    const explanation =
      buildRefusalExplanation(
        syntheticRefusal,
      );

    return createIntelligenceResponse({
      answered: false,

      answer:
        summary,

      summary,

      sources,

      date,

      explanation,

      intent,

      actions,

      citations:
        resolvedCitations,

      data:
        data ??
        synthesisResult?.data ??
        null,

      verification:
        verificationResult,

      telemetry,

      metadata: {
        ...metadata,

        cause:
          syntheticRefusal.cause,

        reason:
          syntheticRefusal.reason,
      },
    });
  }


  /*
   * Verification is a release gate.
   *
   * If verification explicitly fails, do not expose the
   * unverified draft as the final coach-facing answer.
   */
  if (
    verificationResult &&
    verificationResult.verified === false
  ) {
    const summary =
      "The answer could not be released because verification failed.";

    const explanation =
      buildVerificationFailureExplanation(
        verificationResult,
      );

    return createIntelligenceResponse({
      answered: false,

      answer:
        summary,

      summary,

      sources,

      date,

      explanation,

      intent,

      actions,

      citations:
        resolvedCitations,

      data:
        data ??
        synthesisResult?.data ??
        null,

      verification:
        verificationResult,

      telemetry,

      metadata: {
        ...metadata,

        cause:
          "verification_failed",
      },
    });
  }


  const answer =
    cleanString(
      synthesisResult?.answer,
    );

  if (!answer) {
    throw new TypeError(
      "A successful synthesisResult must contain a non-empty answer",
    );
  }


  const summary =
    answer;


  const explanation =
    buildSuccessfulExplanation({
      synthesisResult,
      verificationResult,
      actions,
    });


  return createIntelligenceResponse({
    answered: true,

    answer,

    summary,

    sources,

    date,

    explanation,

    intent,

    actions,

    citations:
      resolvedCitations,

    data:
      data ??
      synthesisResult?.data ??
      null,

    verification:
      verificationResult,

    telemetry,

    metadata,
  });
}