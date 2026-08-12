// grades the evidence BEFORE writing an answer.
//
// this is the corrective-rag idea, and it is the single most valuable thing in
// the generation layer.
//
// the failure it prevents: retrieval always returns something. ask about a
// document we do not hold and the top ten chunks are still ten chunks, they are
// just ten irrelevant ones -- and a language model handed ten irrelevant
// passages and a question will write a fluent, confident, wrong answer built
// out of whatever those passages happened to mention. the prompt says "say you
// cannot answer", and the model, looking at ten real passages about tennis,
// concludes it can.
//
// so we grade first. if the evidence does not actually address the question,
// we take corrective action rather than generating and hoping.
//
// crag reports large gains from this (the self-crag variant improved on
// self-rag by ~20% on popqa), and the reason is not subtle: refusing to answer
// when you have nothing is worth more than any amount of prompt tuning.

import { retrievalConfig } from "../../config/retrieval.config.js";

export const GRADES = Object.freeze({
  // the evidence answers the question. generate normally.
  SUFFICIENT: "sufficient",
  // some relevant material, but thin or partial. generate, and say so.
  PARTIAL: "partial",
  // nothing here addresses the question. do not generate.
  INSUFFICIENT: "insufficient",
});

// ---------------------------------------------------------------------------
// stage 1: cheap signals, no model call
// ---------------------------------------------------------------------------

/**
 * a first opinion from the retrieval scores themselves.
 *
 * two signals, both free:
 *
 * `armAgreement` -- how many of the top chunks BOTH arms found. when bm25 and
 * the embedding model independently rank the same passage highly they are
 * agreeing for different reasons, which is a much stronger relevance signal
 * than either score alone. when nothing overlaps, usually neither arm found
 * anything good and both returned their least-bad option.
 *
 * `termCoverage` -- what fraction of the question's distinctive words appear
 * anywhere in the evidence. a question about "facet joint sprains" whose
 * evidence never contains "facet" is not answered by that evidence, whatever
 * the cosine score says.
 */
export function cheapGrade(question, evidence) {
  if (evidence.length === 0) {
    return { grade: GRADES.INSUFFICIENT, confidence: 1, reason: "no evidence retrieved" };
  }

  const bothArms = evidence.filter((chunk) => (chunk.foundBy ?? []).length > 1).length;
  const armAgreement = bothArms / evidence.length;

  // content words only. stopwords appear everywhere and would mask the signal.
  const stop = new Set([
    "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
    "does", "did", "do", "is", "are", "was", "were", "the", "a", "an", "of",
    "in", "on", "for", "to", "and", "or", "about", "according", "say", "says",
    "think", "thinks", "with", "that", "this", "from", "at", "by", "as", "it",
  ]);

  const terms = [
    ...new Set(
      String(question)
        .toLowerCase()
        .split(/[^\p{L}\p{N}-]+/u)
        .filter((word) => word.length > 2 && !stop.has(word)),
    ),
  ];

  const haystack = evidence
    .map((chunk) => `${chunk.text ?? ""} ${chunk.title ?? ""}`)
    .join(" ")
    .toLowerCase();

  const covered = terms.filter((term) => haystack.includes(term)).length;
  const termCoverage = terms.length === 0 ? 1 : covered / terms.length;

  // thresholds are deliberately lopsided. calling good evidence insufficient
  // costs a refusal the user can retry; calling bad evidence sufficient costs a
  // confident falsehood, which nobody catches. so we only refuse outright when
  // the signal is unambiguous.
  if (termCoverage < 0.25 && armAgreement < 0.2) {
    return {
      grade: GRADES.INSUFFICIENT,
      confidence: 0.8,
      reason: `only ${Math.round(termCoverage * 100)}% of the question's terms appear in the evidence, and the two retrieval arms did not agree on anything`,
      termCoverage,
      armAgreement,
    };
  }

  if (termCoverage >= 0.6 && armAgreement >= 0.3) {
    return {
      grade: GRADES.SUFFICIENT,
      confidence: 0.75,
      reason: "strong term coverage and both arms agree",
      termCoverage,
      armAgreement,
    };
  }

  return { grade: null, confidence: 0, reason: "inconclusive", termCoverage, armAgreement };
}

// ---------------------------------------------------------------------------
// stage 2: ask the model, per chunk
// ---------------------------------------------------------------------------

/**
 * asks the model whether each passage actually helps answer the question.
 *
 * one small call per chunk, capped and run concurrently. it is a yes/no
 * judgement rather than a score, because small models produce meaningless
 * gradations ("7/10") and reliable binaries.
 *
 * chunks judged irrelevant are DROPPED before generation. that matters
 * independently of the grade: a local 8b model reading ten passages where six
 * are noise writes a worse answer than one reading the four that matter, and it
 * is also three times slower.
 */
async function gradeChunk(question, chunk, { signal }) {
  const response = await fetch(`${retrievalConfig.generation.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: retrievalConfig.generation.model,
      stream: false,
      options: { temperature: 0, num_predict: 3 },
      messages: [
        {
          role: "system",
          content:
            "You judge whether a passage contains information that helps answer a question. " +
            "Answer with exactly one word: yes or no. " +
            "Answer yes only if the passage contains facts that bear on the question. " +
            "Being on the same general topic is not enough.",
        },
        {
          role: "user",
          content: `Question: ${question}\n\nPassage: ${(chunk.text ?? "").slice(0, 1000)}\n\nDoes this passage help answer the question?`,
        },
      ],
    }),
    signal,
  });

  if (!response.ok) throw new Error(`grader returned ${response.status}`);

  const payload = await response.json();

  return /^\s*yes/i.test(String(payload.message?.content ?? ""));
}

/**
 * the full grade.
 *
 * degrades to "assume sufficient" if the model is unreachable, because a
 * grading step that cannot run should not block an answer the retrieval layer
 * was perfectly capable of supporting.
 */
export async function gradeEvidence(question, evidence, { signal = null } = {}) {
  const cheap = cheapGrade(question, evidence);

  if (!retrievalConfig.generation.gradingEnabled) {
    return { ...cheap, grade: cheap.grade ?? GRADES.SUFFICIENT, kept: evidence, source: "disabled" };
  }

  // an unambiguous cheap verdict is taken as final. no point spending ten model
  // calls to confirm what two counters already agree on.
  if (cheap.grade === GRADES.INSUFFICIENT && cheap.confidence >= 0.8) {
    return { ...cheap, kept: [], source: "rules" };
  }

  const window = evidence.slice(0, retrievalConfig.generation.gradeLimit);
  const tail = evidence.slice(retrievalConfig.generation.gradeLimit);

  let verdicts;

  try {
    verdicts = await Promise.all(window.map((chunk) => gradeChunk(question, chunk, { signal })));
  } catch (error) {
    return {
      ...cheap,
      grade: cheap.grade ?? GRADES.SUFFICIENT,
      kept: evidence,
      source: `grader_unavailable: ${error.message}`,
    };
  }

  const kept = window.filter((_, index) => verdicts[index]);
  const relevantFraction = window.length === 0 ? 0 : kept.length / window.length;

  // ungraded tail chunks are kept behind the graded ones. they were never
  // judged, so dropping them would be a guess in the other direction.
  const finalEvidence = [...kept, ...tail];

  let grade;

  if (kept.length === 0) grade = GRADES.INSUFFICIENT;
  else if (relevantFraction < 0.3 || kept.length < 2) grade = GRADES.PARTIAL;
  else grade = GRADES.SUFFICIENT;

  return {
    grade,
    confidence: 0.9,
    reason: `${kept.length} of ${window.length} passages judged relevant`,
    termCoverage: cheap.termCoverage,
    armAgreement: cheap.armAgreement,
    relevantFraction,
    kept: finalEvidence,
    dropped: window.length - kept.length,
    source: "model",
  };
}
