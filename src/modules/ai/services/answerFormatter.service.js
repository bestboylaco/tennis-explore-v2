import {
  AI_RESPONSE_STATUS,
} from "../types/ai.types.js";

function cleanCompletionText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSection(
  text,
  heading,
  nextHeadings = []
) {
  const escapedHeading =
    heading.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const nextPattern =
    nextHeadings.length > 0
      ? nextHeadings
          .map((item) =>
            item.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            )
          )
          .join("|")
      : null;

  const pattern =
    nextPattern
      ? new RegExp(
          `##\\s*${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s*(?:${nextPattern})|$)`,
          "i"
        )
      : new RegExp(
          `##\\s*${escapedHeading}\\s*\\n([\\s\\S]*)$`,
          "i"
        );

  const match =
    text.match(pattern);

  return match?.[1]?.trim() || "";
}

function extractBulletItems(sectionText) {
  if (
    typeof sectionText !== "string" ||
    sectionText.trim().length === 0
  ) {
    return [];
  }

  const lines =
    sectionText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const bullets =
    lines
      .filter((line) =>
        /^[-•*]\s+/.test(line)
      )
      .map((line) =>
        line.replace(
          /^[-•*]\s+/,
          ""
        ).trim()
      );

  if (bullets.length > 0) {
    return bullets;
  }

  return [sectionText.trim()];
}

function parseStructuredAnswer(completion) {
  const cleaned =
    cleanCompletionText(completion);

  const summary =
    extractSection(
      cleaned,
      "Summary",
      [
        "Key Findings",
        "Practical Implications",
        "Limitations",
      ]
    );

  const keyFindingsText =
    extractSection(
      cleaned,
      "Key Findings",
      [
        "Practical Implications",
        "Limitations",
      ]
    );

  const practicalText =
    extractSection(
      cleaned,
      "Practical Implications",
      [
        "Limitations",
      ]
    );

  const limitationsText =
    extractSection(
      cleaned,
      "Limitations"
    );

  return {
    cleaned,
    summary,
    keyFindings:
      extractBulletItems(
        keyFindingsText
      ),
    practicalImplications:
      extractBulletItems(
        practicalText
      ),
    limitations:
      extractBulletItems(
        limitationsText
      ),
  };
}



export function formatAIAnswer({
  question,
  completion,
  citations = [],
  evidenceConfidence = null,
  evidenceConsensus = null,
  provider,
  model,
} = {}) {
  if (
    typeof completion !== "string" ||
    completion.trim().length === 0
  ) {
    throw new TypeError(
      "Completion must be a non-empty string."
    );
  }

  if (!Array.isArray(citations)) {
    throw new TypeError(
      "Citations must be an array."
    );
  }

  const structured =
    parseStructuredAnswer(
      completion
    );


  return {
    status:
        AI_RESPONSE_STATUS.ANSWERED,

    question,

    summary:
        structured.summary,

    keyFindings:
        structured.keyFindings,

    practicalImplications:
        structured.practicalImplications,

    limitations:
        structured.limitations,

    // Keep temporarily for backward compatibility.
    answer:
        structured.cleaned,

    citations,

    sourceCount:
        citations.length,

    evidenceConfidence:
        evidenceConfidence || {
        overall: 0,
        level: "unknown",
        evidenceCount: 0,
        sourceCount: 0,
        warningCount: 0,
        },

    evidenceConsensus:
        evidenceConsensus || {
        independentSources: 0,
        moduleCount: 0,
        moduleDistribution: {},
        sourceTypeDistribution: {},
        dominantModule: null,
        dominantSourceType: null,
        coverage: "none",
        },

    ai: {
        provider,
        model,
    },
    };
}

export function formatNoEvidenceAnswer({
  question,
  provider = null,
  model = null,
} = {}) {
  const message =
    "The current knowledge base does not contain enough relevant evidence to answer this question reliably.";

  return {
    status:
        AI_RESPONSE_STATUS.NO_EVIDENCE,

    question,

    summary:
        message,

    keyFindings: [],

    practicalImplications: [],

    limitations: [
        "No sufficiently relevant evidence was found in the available knowledge modules.",
    ],

    answer:
        message,

    citations: [],

    sourceCount: 0,

    evidenceConfidence: {
        overall: 0,
        level: "unknown",
        evidenceCount: 0,
        sourceCount: 0,
        warningCount: 0,
    },

    evidenceConsensus: {
        independentSources: 0,
        moduleCount: 0,
        moduleDistribution: {},
        sourceTypeDistribution: {},
        dominantModule: null,
        dominantSourceType: null,
        coverage: "none",
    },

    ai: {
        provider,
        model,
    },
  };
}