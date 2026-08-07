/**
 * Build an evidence-grounded prompt using
 * structured orchestration context.
 *
 * @param {Object} options
 * @param {string} options.question
 * @param {Object} options.contextResult
 * @param {boolean} options.contextResult.hasEvidence
 * @param {string} options.contextResult.context
 * @param {number} options.contextResult.sourceCount
 * @param {number} options.contextResult.moduleCount
 * @param {string[]} options.contextResult.modules
 *
 * @returns {{
 *   prompt: string | null,
 *   context: string,
 *   sourceCount: number,
 *   moduleCount: number,
 *   modules: string[],
 *   hasEvidence: boolean
 * }}
 */
export function buildKnowledgePrompt({
  question,
  contextResult,
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "A valid question is required to build the prompt."
    );
  }

  if (
    !contextResult ||
    typeof contextResult !== "object"
  ) {
    throw new TypeError(
      "A valid orchestration context is required."
    );
  }

  const normalisedQuestion =
    question.trim();

  const context =
    typeof contextResult.context === "string"
      ? contextResult.context.trim()
      : "";

  const sourceCount =
    Number.isInteger(
      contextResult.sourceCount
    )
      ? contextResult.sourceCount
      : 0;

  const moduleCount =
    Number.isInteger(
      contextResult.moduleCount
    )
      ? contextResult.moduleCount
      : 0;

  const modules =
    Array.isArray(
      contextResult.modules
    )
      ? contextResult.modules
      : [];

  if (
    !contextResult.hasEvidence ||
    context.length === 0 ||
    sourceCount === 0
  ) {
    return {
      prompt: null,
      context: "",
      sourceCount: 0,
      moduleCount: 0,
      modules: [],
      hasEvidence: false,
    };
  }

  const prompt = `
==================================================
SYSTEM ROLE
==================================================

You are TennisExplore, an evidence-based tennis knowledge assistant.

Your task is to answer the user's question using only the supplied knowledge-base evidence.

==================================================
EVIDENCE RULES
==================================================

1. Use only the evidence provided below.
2. Do not use outside knowledge.
3. Do not invent facts, statistics, studies, players, events, or sources.
4. Support factual claims with source references such as [Source 1].
5. Combine evidence from multiple sources or modules when relevant.
6. Clearly distinguish direct findings from reasonable interpretations.
7. If the evidence is incomplete, explain the limitation.
8. The available evidence comes primarily from one study involving a relatively small sample of male junior players. Additional research is needed to determine whether these findings generalize across female players, different playing surfaces, and different playing styles.
9. Do not recommend external websites, articles, research, or other outside sources.
10. Do not present an interpretation as a proven fact.
11. Never cite a source that does not support the associated claim.
12.Treat multiple chunks with the same sourceId and document title as one source document, not as separate studies.
13.Do not claim that an intervention prevents injuries, improves performance, or causes an outcome unless the supplied evidence directly establishes that result.
14.When multiple evidence chunks share the same sourceId, treat them as one document or one study. Do not refer to them as multiple studies.

==================================================
AVAILABLE EVIDENCE
==================================================

${context}

==================================================
USER QUESTION
==================================================

${normalisedQuestion}

==================================================
MANDATORY RESPONSE FORMAT
==================================================

You MUST use exactly these four headings, in exactly this order:

## Summary

## Key Findings

## Practical Implications

## Limitations

Formatting rules:

1. Every heading must appear, even when evidence is limited.
2. Do not write any text before the Summary heading.
3. Do not add any headings other than the four listed above.
4. Key Findings must use hyphen bullets beginning with "- ".
5.Practical Implications must also use hyphen bullets when listing multiple items.
6.Do not use Unicode bullet symbols.
7. Practical Implications should only include recommendations directly supported by the evidence.
8. Limitations must clearly explain what the supplied evidence does not establish.
9. Cite factual claims inline using [Source 1], [Source 2], and so on.
10. Do not include a separate Sources section because source metadata is returned separately by the API.
11. Do not recommend outside research or external sources.
12. Return plain text only. Do not return JSON.
13.Every bullet point containing a factual finding or recommendation must include at least one supporting source reference.

Begin your response with:

## Summary


`.trim();

  return {
    prompt,
    context,
    sourceCount,
    moduleCount,
    modules,
    hasEvidence: true,
  };
}