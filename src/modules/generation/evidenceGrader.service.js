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

  // the anchors: proper nouns and years. these carry almost all of a question's
  // identity, and plain term coverage drowns them out on a single-subject
  // corpus.
  //
  // "what was Djokovic's serve speed at the 2019 Australian Open final" scores
  // well on plain coverage against ANY tennis corpus -- serve, speed, open and
  // final are everywhere -- so the grader passed it and the model answered a
  // question it could not answer. but "djokovic" and "2019" appear nowhere, and
  // that is the whole signal.
  // strips accents and the possessive/plural tail that a proper noun collects in
  // ordinary sentences ("Djokovic's", "Federers'"). without this, a question
  // about "Nadal's" serve refuses outright against evidence that only ever
  // writes "Nadal", which is the majority of real usage -- the possessive is
  // vastly more common in a question than in the prose that answers it.
  const normaliseAnchor = (text) =>
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/'s?\b/g, "");

  const anchors = [
    ...new Set(
      [
        ...String(question).matchAll(/\b(?:19|20)\d{2}\b/g),
        // capitalised words, ignoring the sentence's first word
        ...String(question).slice(1).matchAll(/\b[A-Z][a-z]{2,}\b/g),
      ].map((match) => normaliseAnchor(match[0].toLowerCase())),
    ),
  ];

  const normalisedHaystack = normaliseAnchor(haystack);

  const anchorsFound = anchors.filter((anchor) => normalisedHaystack.includes(anchor)).length;
  const anchorCoverage = anchors.length === 0 ? 1 : anchorsFound / anchors.length;

  // thresholds are deliberately lopsided. calling good evidence insufficient
  // costs a refusal the user can retry; calling bad evidence sufficient costs a
  // confident falsehood, which nobody catches. so we only refuse outright when
  // the signal is unambiguous.
  // a named subject the evidence has never heard of. the strongest refusal
  // signal there is, so it fires before anything else.
  if (anchors.length > 0 && anchorCoverage === 0) {
    return {
      grade: GRADES.INSUFFICIENT,
      confidence: 0.95,
      reason: `the evidence never mentions ${anchors.slice(0, 3).join(", ")}`,
      termCoverage,
      anchorCoverage,
      armAgreement,
    };
  }

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
      // a reasoning model (qwen3 and friends) spends tokens on a hidden
      // <think> pass before answering. num_predict: 3 leaves no room for
      // that AND the actual "yes"/"no" -- measured live, every single
      // judgement came back with an empty content field and the whole
      // 3-token budget spent on one reasoning token, so every chunk on every
      // question graded "not relevant" regardless of what it said. think:
      // false turns the reasoning pass off so the budget goes to the answer.
      think: false,
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
export async function gradeEvidence(question, evidence, { signal = null, forceModelGrade = false } = {}) {
  const cheap = cheapGrade(question, evidence);

  if (!retrievalConfig.generation.gradingEnabled) {
    return { ...cheap, grade: cheap.grade ?? GRADES.SUFFICIENT, kept: evidence, source: "disabled" };
  }

  // an unambiguous cheap verdict is taken as final. no point spending ten model
  // calls to confirm what two counters already agree on.
  //
  // forceModelGrade skips this shortcut. it is set on the regrade that follows
  // query expansion -- the cheap rules already voted insufficient once on this
  // question, expansion was run specifically because that vote might be wrong,
  // and trusting the same heuristic a second time defeats the point of having
  // widened the search. the small model gets the actual final say instead.
  if (cheap.grade === GRADES.INSUFFICIENT && cheap.confidence >= 0.8 && !forceModelGrade) {
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

  let kept = window.filter((_, index) => verdicts[index]);
  let graded = window;
  let ungradedTail = tail;

  // the window entirely failing is exactly the case where looking further
  // matters most. topN widens retrieval to ~1.8x what actually gets shown,
  // so a real answer sitting just past position gradeLimit in the ranking
  // reads identically to "nothing retrieved is relevant" once the window
  // alone decides that -- and it is genuinely there often enough to be
  // worth one more concurrent batch of cheap yes/no calls (observed live,
  // 2026-09-17: the passage that directly answered the question ranked
  // 10th, one place past an 8-chunk window, and the question was refused
  // with 25 chunks retrieved and 17 of them never even looked at).
  //
  // graded only once, not looped -- a second empty batch is a much weaker
  // signal that a third would help, and this should cost extra only on the
  // single worst case, not turn into an unbounded search.
  if (kept.length === 0 && tail.length > 0) {
    const nextWindow = tail.slice(0, retrievalConfig.generation.gradeLimit);
    ungradedTail = tail.slice(retrievalConfig.generation.gradeLimit);

    try {
      const nextVerdicts = await Promise.all(nextWindow.map((chunk) => gradeChunk(question, chunk, { signal })));

      kept = nextWindow.filter((_, index) => nextVerdicts[index]);
      graded = [...window, ...nextWindow];
    } catch {
      // the first batch's grader call already succeeded, so this is not
      // "grader unavailable" -- just proceed with what the first batch found
      // (nothing), and leave the second window ungraded rather than judged.
      ungradedTail = tail;
    }
  }

  const relevantFraction = graded.length === 0 ? 0 : kept.length / graded.length;

  // ungraded tail chunks are kept behind the graded ones. they were never
  // judged, so dropping them would be a guess in the other direction.
  const finalEvidence = [...kept, ...ungradedTail];

  let grade;

  if (kept.length === 0) grade = GRADES.INSUFFICIENT;
  else if (relevantFraction < 0.3 || kept.length < 2) grade = GRADES.PARTIAL;
  else grade = GRADES.SUFFICIENT;

  return {
    grade,
    confidence: 0.9,
    reason: `${kept.length} of ${graded.length} passages judged relevant`,
    termCoverage: cheap.termCoverage,
    armAgreement: cheap.armAgreement,
    relevantFraction,
    kept: finalEvidence,
    dropped: graded.length - kept.length,
    source: "model",
  };
}
