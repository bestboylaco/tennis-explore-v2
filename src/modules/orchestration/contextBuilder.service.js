/**
 * Convert a module ID into a readable context heading.
 *
 * @param {string} moduleId
 * @returns {string}
 */
function formatModuleHeading(moduleId) {
  const headings = {
    research: "Research Papers",
    coaching: "Coach Interviews",
    conference: "Conference Content",
    rankings: "Ranking Data",
    matches: "Match Reports",
  };

  return (
    headings[moduleId] ||
    "Other Evidence"
  );
}

/**
 * Format one evidence item for the AI context.
 *
 * @param {Object} evidence
 * @param {number} sourceNumber
 *
 * @returns {string}
 */
function formatEvidenceItem(
  evidence,
  sourceNumber
) {
  const title =
    evidence?.documentTitle ||
    "Unknown source";

  const sourceType =
    evidence?.sourceType ||
    "unknown";

  const sectionTitle =
    evidence?.sectionTitle ||
    null;

  const score =
    typeof evidence?.score === "number"
      ? evidence.score.toFixed(3)
      : "unknown";

  const text =
    typeof evidence?.text === "string"
      ? evidence.text.trim()
      : "";

  const sectionLine =
    sectionTitle
      ? `Section: ${sectionTitle}\n`
      : "";

  return `
[Source ${sourceNumber}]
Title: ${title}
Source type: ${sourceType}
${sectionLine}Relevance score: ${score}
Content:
${text}
`.trim();
}

/**
 * Group evidence by orchestration module.
 *
 * @param {Object[]} evidence
 *
 * @returns {Map<string, Object[]>}
 */
function groupEvidenceByModule(
  evidence
) {
  const groupedEvidence =
    new Map();

  for (const item of evidence) {
    const moduleId =
      item?.moduleId ||
      "other";

    if (
      !groupedEvidence.has(moduleId)
    ) {
      groupedEvidence.set(
        moduleId,
        []
      );
    }

    groupedEvidence
      .get(moduleId)
      .push(item);
  }

  return groupedEvidence;
}

/**
 * Build structured AI context from merged evidence.
 *
 * @param {Object} options
 * @param {Object[]} [options.evidence=[]]
 *
 * @returns {{
 *   hasEvidence: boolean,
 *   sourceCount: number,
 *   moduleCount: number,
 *   modules: string[],
 *   context: string,
 *   sourceMap: Object[]
 * }}
 */
export function buildOrchestrationContext({
  evidence = [],
} = {}) {
  if (!Array.isArray(evidence)) {
    throw new TypeError(
      "Context evidence must be an array."
    );
  }

  const usableEvidence =
    evidence.filter(
      (item) =>
        item &&
        typeof item.text === "string" &&
        item.text.trim().length > 0
    );

  if (usableEvidence.length === 0) {
    return {
      hasEvidence: false,
      sourceCount: 0,
      moduleCount: 0,
      modules: [],
      context: "",
      sourceMap: [],
    };
  }

  const groupedEvidence =
    groupEvidenceByModule(
      usableEvidence
    );

  let sourceNumber = 1;

  const sourceMap = [];

  const contextSections = [];

  for (
    const [moduleId, moduleEvidence]
    of groupedEvidence.entries()
  ) {
    const heading =
      formatModuleHeading(moduleId);

    const formattedItems =
      moduleEvidence.map((item) => {
        const currentSourceNumber =
          sourceNumber;

        sourceMap.push({
          reference:
            `Source ${currentSourceNumber}`,

          moduleId,

          pointId:
            item.pointId ||
            null,

          sourceId:
            item.sourceId ||
            null,

          title:
            item.documentTitle ||
            "Unknown source",

          sourceType:
            item.sourceType ||
            "unknown",

          score:
            typeof item.score === "number"
              ? item.score
              : null,

          chunkIndex:
            item.chunkIndex ??
            null,
        });

        sourceNumber += 1;

        return formatEvidenceItem(
          item,
          currentSourceNumber
        );
      });

    contextSections.push(
      `
=== ${heading} ===

${formattedItems.join("\n\n")}
      `.trim()
    );
  }

  const modules =
    Array.from(
      groupedEvidence.keys()
    );

  return {
    hasEvidence: true,

    sourceCount:
      usableEvidence.length,

    moduleCount:
      modules.length,

    modules,

    context:
      contextSections.join(
        "\n\n"
      ),

    sourceMap,
  };
}