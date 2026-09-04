// asks the same question several different ways.
//
// the problem this solves
// ----------------------
// retrieval matches the words you used. a coach asking "how do we stop kids
// hurting their backs" and a paper titled "risk factors for lumbar bone stress
// injury in adolescent athletes" share almost no vocabulary, and the embedding
// model only partly bridges that -- it is trained on general text, not on the
// specific way this corpus phrases things.
//
// so before giving up, we ask again in the corpus's own language. three
// rephrasings, retrieved independently, fused by the same reciprocal rank
// fusion that merges the keyword and vector arms. adding a query is just adding
// another ranked list, which is the property that makes RRF worth having.
//
// this is the retrieval half of corrective RAG: when the first attempt comes
// back thin, do something about it rather than either refusing or generating
// from whatever turned up.
//
// why it is not always on
// -----------------------
// each rephrasing costs a model call to write plus a full retrieval pass, and
// on a question that already retrieved well it changes nothing. so it fires
// only when grading says the evidence is thin -- which is exactly when the
// extra second is worth spending.

import { retrievalConfig } from "../../config/retrieval.config.js";

const EXPANSION_SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: { type: "string" },
      description: "rephrasings of the question",
    },
  },
  required: ["queries"],
};

const SYSTEM_PROMPT = `You rewrite a question several different ways so a document search can find it.

The archive is sports science: research papers, coaching presentations, match records and video from a tennis federation.

Write rewritings that:
- use the technical vocabulary a researcher would use, not the everyday wording
- name the specific measure, body part, phase or population where the question implies one
- vary the angle: one broader, one narrower, one using synonyms

Rules:
- Keep the original meaning. Do not answer, and do not add facts.
- Each rewriting must stand alone as a search query.
- Return between 2 and 4 of them.`;

/**
 * produces rephrasings of a question.
 *
 * returns an empty array on any failure rather than throwing. expansion is an
 * improvement to retrieval, not a precondition for it -- a question that cannot
 * be rephrased should still be answered from whatever the first pass found.
 */
export async function expandQuery(
    question,
    {
        signal = null,
        max = 3,
        fetchImpl = fetch,
    } = {},
) {
  if (!retrievalConfig.query.expansionEnabled) return [];

  try {
      const response = await fetchImpl(
          `${retrievalConfig.generation.baseUrl}/api/chat`,
          {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: retrievalConfig.query.expansionModel,
        stream: false,
        format: EXPANSION_SCHEMA,
        // temperature 0 keeps the rewritings reproducible, so a question that
        // worked yesterday works today. variety comes from the instruction to
        // vary the angle, not from sampling.
        options: { temperature: 0, num_predict: 250 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
      }),
      signal,
    });

    if (!response.ok) return [];

    const payload = await response.json();
    const parsed = JSON.parse(payload.message?.content ?? "{}");

    const original = question.trim().toLowerCase();

    return (parsed.queries ?? [])
      .filter((candidate) => typeof candidate === "string")
      .map((candidate) => candidate.trim())
      // a rewriting identical to the question adds a duplicate ranked list,
      // which quietly doubles that phrasing's weight in the fusion.
      .filter((candidate) => candidate.length > 8 && candidate.toLowerCase() !== original)
      .slice(0, max);
  } catch {
    return [];
  }
}

/**
 * a last-resort widening, with no model involved.
 *
 * strips the question down to its content words. it reads badly as a sentence
 * and that does not matter -- BM25 sees a bag of terms either way, and dropping
 * the grammar removes the phrasing that failed the first time.
 *
 * exists so the fallback path still works when the model is unreachable, which
 * is precisely when you least want the system to give up.
 */
export function keywordFallback(question) {
  const stop = new Set([
    "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
    "does", "did", "do", "is", "are", "was", "were", "the", "a", "an", "of",
    "in", "on", "for", "to", "and", "or", "about", "with", "that", "this",
    "from", "at", "by", "as", "it", "can", "could", "would", "should", "say",
    "says", "tell", "me", "us", "our", "we", "you", "your", "any", "some",
  ]);

  const terms = String(question)
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length > 2 && !stop.has(word));

  return terms.length >= 2 ? [terms.join(" ")] : [];
}
