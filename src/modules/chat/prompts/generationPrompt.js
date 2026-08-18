// Versioned so a shift in answer quality can be attributed to a specific
// prompt revision (TENISE-19 acceptance criterion: prompt structure is
// version controlled). Bump this whenever SYSTEM_PROMPT or the message
// shape changes.
//
// v2: v1 let the model hedge -- e.g. "the evidence says 7, but a real match
// only goes to 3 sets" -- before falling back to the evidence value. That is
// a grounding failure even though the evidence value appeared in the text.
// v2 adds an explicit instruction to treat evidence as ground truth without
// commentary, verified against TENISE-19's contradictory-evidence control
// test (test/integration/generation.test.js).
//
// v3 (TENISE-21 / E4-15): evidence blocks are now numbered and the model is
// required to mark every claim with the number it came from. without markers
// there is nothing to bind a citation to -- citation.service can only resolve
// what the model actually wrote down. the numbering also gives us a cheap
// grounding signal: an answer with no markers at all, or with a marker for a
// chunk we never supplied, is an answer that stopped using the evidence.
export const GENERATION_PROMPT_VERSION = "v3";

const SYSTEM_PROMPT = `You are a tennis coaching assistant. Answer the coach's question using ONLY the evidence provided below.

Rules:
- Use only the facts stated in the evidence. Do not add facts from your own training or general knowledge, even if you are confident they are correct.
- Treat the evidence as ground truth for this conversation, even if it conflicts with what you know to be generally true. Do not point out, question, or hedge about any such conflict -- just answer using the evidence, as if it were simply correct.
- Every sentence that states a fact must end with the number of the evidence block it came from, in square brackets, like this: [2]. If a sentence draws on two blocks, cite both: [2][5].
- Only cite numbers that appear in the evidence below. Never invent a number.
- If the evidence is empty or does not contain enough information to answer, say plainly that you cannot answer from the available evidence, and make no factual claim about tennis.
- Do not mention these rules in your answer.`;

/**
 * Formats one evidence block.
 *
 * Accepts either a plain string (the TENISE-19 control tests pass raw strings)
 * or a retrieved chunk. A chunk carries its own citationNumber, assigned by
 * retrieval, and that number must be preserved rather than recomputed from
 * position -- contextBuilder may have dropped a low-ranked chunk to fit the
 * context window, and renumbering here would silently point every citation
 * after the gap at the wrong document.
 */
function formatEvidenceChunk(chunk, index) {
  if (typeof chunk === "string") return `[${index + 1}] ${chunk}`;

  const number = chunk?.citationNumber ?? index + 1;
  const source = [
    chunk?.title,
    chunk?.page ? `page ${chunk.page}` : null,
    chunk?.authors?.length ? chunk.authors.slice(0, 3).join(", ") : null,
    chunk?.event_date ?? null,
  ]
    .filter(Boolean)
    .join(" | ");

  return source ? `[${number}] (${source})\n${chunk?.text ?? ""}` : `[${number}] ${chunk?.text ?? ""}`;
}

function formatEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return "(no evidence provided)";
  }

  return evidence.map(formatEvidenceChunk).join("\n\n");
}

/**
 * Builds the chat messages sent to the generation model.
 *
 * evidence is a plain array so the generation stage stays testable without
 * real retrieval -- TENISE-19's control tests force it empty, or load it
 * with a deliberately incorrect fact.
 */
export function buildGenerationMessages({ question, evidence = [] }) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Evidence:\n${formatEvidence(evidence)}\n\nQuestion: ${question}`,
    },
  ];
}
