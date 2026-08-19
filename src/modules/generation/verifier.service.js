// checks the answer against the evidence, after it is written.
//
// the prompt asks the model to ground every claim. this checks whether it did.
// those are different things, and only the second one is evidence.
//
// deliberately mechanical rather than another model call. a second model
// judging the first tends to agree with it -- they share the same failure modes
// and the same context -- so a "verifier" built that way mostly rubber-stamps.
// string checks are cruder but they are independent, which is the property that
// matters.

import { bindCitations, findUnsupportedNumbers } from "../retrieval/citation.service.js";

/**
 * splits an answer into sentences that make factual claims.
 *
 * a sentence with no digits, no proper nouns and no comparative wording is
 * usually framing ("This is worth considering in context") rather than a claim,
 * and demanding a citation on those produces noise that trains everyone to
 * ignore the warnings.
 */
function claimSentences(answer) {
  return String(answer)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (sentence.length < 25) return false;

      const hasNumber = /\d/.test(sentence);
      const hasProperNoun = /\b[A-Z][a-z]{2,}/.test(sentence.slice(1));
      const hasComparison = /\b(higher|lower|more|less|greater|fewer|increased|decreased|better|worse|than)\b/i.test(sentence);

      return hasNumber || hasProperNoun || hasComparison;
    });
}

/**
 * verifies one answer.
 *
 * returns a report, not a pass/fail. the caller decides what to do with it --
 * for a coach-facing answer we surface the warnings rather than suppressing the
 * answer, because an answer with a flagged number is still useful if the reader
 * knows which number to check.
 */
export function verifyAnswer(answer, evidence) {
  const bound = bindCitations(answer, evidence);
  const unsupportedNumbers = findUnsupportedNumbers(answer, evidence);

  const claims = claimSentences(answer);
  const uncited = claims.filter((sentence) => !/\[\d+\]/.test(sentence));

  // the fraction of factual sentences carrying a citation. this is the single
  // number worth tracking over time: it moves when the prompt changes, and it
  // is what "grounded" actually means in practice.
  const citedFraction = claims.length === 0 ? 1 : 1 - uncited.length / claims.length;

  const warnings = [];

  if (bound.dangling.length > 0) {
    warnings.push({
      kind: "dangling_citation",
      severity: "high",
      // a model inventing citation numbers is inventing the claims attached to
      // them. this is the most serious signal here.
      detail: `cited [${bound.dangling.join("], [")}], which was never supplied`,
    });
  }

  if (unsupportedNumbers.length > 0) {
    warnings.push({
      kind: "unsupported_number",
      severity: "high",
      detail: `these figures appear in no source: ${unsupportedNumbers.join(", ")}`,
    });
  }

  if (citedFraction < 0.6 && claims.length > 1) {
    warnings.push({
      kind: "weak_attribution",
      severity: "medium",
      detail: `${uncited.length} of ${claims.length} factual sentences carry no citation`,
    });
  }

  if (bound.citations.length === 0 && claims.length > 0) {
    warnings.push({
      kind: "ungrounded",
      severity: "high",
      detail: "the answer cites nothing at all",
    });
  }

  return {
    grounded: warnings.filter((warning) => warning.severity === "high").length === 0,
    citedFraction: Number(citedFraction.toFixed(2)),
    claimCount: claims.length,
    uncitedClaims: uncited.slice(0, 3),
    citations: bound.citations,
    danglingCitations: bound.dangling,
    unusedEvidence: bound.unusedEvidence,
    unsupportedNumbers,
    warnings,
  };
}
