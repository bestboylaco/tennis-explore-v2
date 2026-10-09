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

import {
  bindCitations,
  buildAuthorYearIndex,
  findUnsupportedNumberTokens,
  findUnsupportedNumbers,
  textCitesKnownAuthor,
} from "../retrieval/citation.service.js";

function normaliseForMatch(value) {
  return String(value)
    .toLowerCase()
    .replace(/(?:['’]s)\b/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function properNounPhrases(sentence) {
  const withoutCitations = String(sentence).replace(/\[\d+\]/g, "");

  const matches =
    withoutCitations.match(
      /\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)+\b/g,
    ) ?? [];

  return [...new Set(
    matches.map((phrase) =>
      phrase.replace(/^(The|A|An)\s+/, "").trim(),
    ),
  )];
}

function findCitationMismatches(claims, evidence) {
  const byNumber = new Map(
    evidence.map((chunk) => [chunk.citationNumber, chunk]),
  );

  const mismatches = [];

  for (const claim of claims) {
    const citationNumbers = [
      ...claim.matchAll(/\[(\d+)\]/g),
    ].map((match) => Number(match[1]));

    if (citationNumbers.length === 0) continue;

    const citedChunks = citationNumbers
      .map((number) => byNumber.get(number))
      .filter(Boolean);

    if (citedChunks.length === 0) continue;

    const citedText = citedChunks
      .map((chunk) =>
        [
          chunk.text,
          chunk.title,
          chunk.file_name,
          ...(chunk.authors ?? []),
        ]
          .filter(Boolean)
          .join(" "),
      )
      .join(" ");

    const normalisedEvidence =
      normaliseForMatch(citedText);

    const names = properNounPhrases(claim);

    const missing = names.filter(
      (name) =>
        !normalisedEvidence.includes(
          normaliseForMatch(name),
        ),
    );

    if (missing.length > 0) {
      mismatches.push({
        claim,
        citations: citationNumbers,
        missing,
      });
    }
  }

  return mismatches;
}

/**
 * numbers in a claim that are not supported by the SPECIFIC chunk(s) that
 * claim actually cited -- not by everything the model was shown.
 *
 * findUnsupportedNumbers (whole-evidence, in citation.service.js) only
 * catches a number invented outright; a real number pulled from a different
 * retrieved chunk than the one cited next to it sails straight through that
 * check, because it does appear "somewhere" in the evidence. this is the
 * misattribution case instead: a genuine figure, attached to the wrong
 * source, which reads exactly as trustworthy as a correct citation until
 * someone actually opens the cited page and the number is not there
 * (observed live, 2026-09-17: an answer citing one source for five distinct
 * numeric claims that were not all in that source).
 *
 * kept separate from findCitationMismatches/citation_mismatch (names) rather
 * than folded into it: that check already blocks the answer via
 * shouldBlockAnswer, and this one is new and unproven at that severity. a
 * name absent from the cited source is close to unambiguous evidence of
 * invention; a number can legitimately be a derived or rounded figure that
 * does not appear character-for-character in any single passage, so
 * treating every miss here as equally serious risks reintroducing the
 * false-refusal problem this session's other fixes targeted. surfaced as its
 * own warning so it is visible and auditable without silently hiding
 * otherwise-good answers.
 */
function findNumberCitationMismatches(claims, evidence, question) {
  const byNumber = new Map(evidence.map((chunk) => [chunk.citationNumber, chunk]));
  const mismatches = [];

  for (const claim of claims) {
    const citationNumbers = [...claim.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));

    if (citationNumbers.length === 0) continue;

    const citedChunks = citationNumbers.map((number) => byNumber.get(number)).filter(Boolean);

    if (citedChunks.length === 0) continue;

    // the question itself is not evidence, but a number the USER wrote is not
    // a claim the model needs to prove either -- "performance at 16" answered
    // with "the table has no data linking rankings at younger ages to
    // performance at 16" is restating the question's own framing, not
    // inventing a fact. flagging it as unsupported reads like a hallucination
    // warning on an honest, correctly-hedged answer (observed live,
    // 2026-09-17: a table answer correctly said it could not assess
    // predictability, and "16" -- straight from the question -- was flagged
    // as appearing in no source).
    // chunk.date is included alongside chunk.text for the same reason as in
    // findUnsupportedNumbers (citation.service.js): a citation year often
    // names a source's own publication date, which is metadata, not
    // something repeated in the passage's body text.
    const citedText = [
      question,
      ...citedChunks.map((chunk) => `${chunk.text ?? ""} ${chunk.date ?? chunk.event_date ?? ""}`),
    ].join(" ");
    const missing = findUnsupportedNumberTokens(claim, citedText);

    if (missing.length > 0) {
      mismatches.push({ claim, citations: citationNumbers, missing });
    }
  }

  return mismatches;
}
// a real markdown heading ("### Contact Position"), or a line that is
// nothing but a bold section label ("1. **Spin and Technique
// Adaptation:**", "**Key Takeaways:**") -- a structural label, not a
// sentence making a claim. matched and dropped line-by-line, BEFORE
// sentence-splitting, because once split by punctuation alone a heading
// like "### **1. Contact Position During Serve Returns**" is
// indistinguishable from a real short claim: it has capitalised words
// (hasProperNoun) and no reliable way to tell it apart after the fact
// (reported directly, 2026-10-01: the citation-repair pass trying, and
// failing, to find evidence for the literal heading text "Contact Position
// During Serve Returns" as if it were a claim).
//
// requires the ENTIRE line to be the label (optional leading number/bullet,
// then one bold span, then an optional colon, nothing else) -- a bullet
// that leads with a bold phrase but continues with real sentence content
// after it, e.g. "- **Gender-Specific Adjustments:** Women benefit from
// net play...", is a genuine claim and must not be dropped.
const HEADING_LINE = /^#{1,6}\s+.*$/;
const LABEL_LINE = /^\s*(?:(?:\d+[.)]|[-*])\s*)?\*\*[^*]+\*\*:?\s*$/;

function stripStructuralLines(answer) {
  return String(answer)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      return !HEADING_LINE.test(trimmed) && !LABEL_LINE.test(trimmed);
    })
    .join("\n");
}

/**
 * splits an answer into sentences that make factual claims.
 *
 * a sentence with no digits, no proper nouns and no comparative wording is
 * usually framing ("This is worth considering in context") rather than a claim,
 * and demanding a citation on those produces noise that trains everyone to
 * ignore the warnings. headings and section labels are excluded before the
 * split even runs -- see stripStructuralLines.
 */
function claimSentences(answer) {
  return stripStructuralLines(answer)
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
export function verifyAnswer(answer, evidence, question = "") {
  const bound = bindCitations(answer, evidence);

  // a number the USER wrote in the question is not a claim the model needs
  // evidence for -- see findNumberCitationMismatches for the live case this
  // came from. treated as an extra, unnumbered piece of evidence here too,
  // so the whole-evidence check gets the same exemption as the per-citation
  // one.
  const unsupportedNumbers = findUnsupportedNumbers(answer, [...evidence, { text: question }]);

  const claims = claimSentences(answer);

  // a sentence naming a real author next to that author's real year --
  // "Ellenbecker et al. (1999)..." -- IS a citation, just not a bracket one.
  // see textCitesKnownAuthor in citation.service.js for why this matters:
  // penalising a model for citing correctly in its own words is exactly
  // backwards.
  const authorYearIndex = buildAuthorYearIndex(evidence);

  const uncited = claims.filter(
    (sentence) => !/\[\d+\]/.test(sentence) && !textCitesKnownAuthor(sentence, authorYearIndex),
  );

  // same recognition, but over the whole answer rather than per-sentence --
  // used only to soften the "cites nothing at all" warning below, which
  // would otherwise fire on an answer that names its sources correctly just
  // because none of those mentions happen to sit inside a claimSentences
  // sentence (e.g. a trailing "Evidence Sources: Author (Year)..." line,
  // which claimSentences' own filtering may or may not keep).
  const citesKnownAuthorSomewhere = textCitesKnownAuthor(answer, authorYearIndex);

  const citationMismatches =
    findCitationMismatches(claims, evidence);

  const numberCitationMismatches =
    findNumberCitationMismatches(claims, evidence, question);

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


  if (citationMismatches.length > 0) {
    warnings.push({
      kind: "citation_mismatch",
      severity: "high",
      detail: citationMismatches
        .map(
          (item) =>
            `citation [${item.citations.join(
              ", ",
            )}] does not contain: ${item.missing.join(", ")}`,
        )
        .join("; "),
    });
  }

  if (numberCitationMismatches.length > 0) {
    warnings.push({
      kind: "number_citation_mismatch",
      // not "high" -- see findNumberCitationMismatches for why this is kept
      // out of shouldBlockAnswer's blocking severity for now. still worth
      // seeing: it is the difference between "this number exists somewhere
      // in what was retrieved" and "this number is actually in the place
      // cited for it".
      severity: "medium",
      detail: numberCitationMismatches
        .map(
          (item) =>
            `citation [${item.citations.join(", ")}] does not contain: ${item.missing.join(", ")}`,
        )
        .join("; "),
    });
  }

  if (bound.citations.length === 0 && claims.length > 0) {
    warnings.push({
      kind: "ungrounded",
      // real prose attribution (a genuine author + year drawn from the
      // evidence) is a materially different, less serious problem than
      // citing nothing recognisable at all -- the claim is still checkable
      // by name, it just cannot be bound to a specific chunk or shown as a
      // clickable source. "high" is reserved for the latter.
      severity: citesKnownAuthorSomewhere ? "medium" : "high",
      detail: citesKnownAuthorSomewhere
        ? "sources are named in the text (e.g. \"Author, Year\") but not as [n] citations, so they cannot be bound to a specific passage or shown as a clickable source"
        : "the answer does not cite or name any source",
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
    // per-claim: which cited number wasn't actually in the chunk(s) cited for
    // it. this is what answers "is this number coming from where it says it
    // is" -- unsupportedNumbers alone only answers "does this number appear
    // anywhere at all".
    numberCitationMismatches,
    warnings,
  };
}

// policy, reversed 2026-09-17: nothing blocks on a grounding warning anymore.
//
// this briefly held citation_mismatch, ungrounded and dangling_citation --
// the reasoning at the time was that those are structural facts (a [n]
// marker either exists or it doesn't) rather than number-matching
// heuristics, so blocking on them seemed safe. it was wrong in a more
// important way: discarding the whole answer over an imperfect citation
// throws away real content the coach asked for and replaces it with nothing,
// on a question the corpus may well answer. the fix for "this citation looks
// wrong" is to say so next to the answer (every warning here still reaches
// `grounding.warnings` and is rendered, see messageRenderer.js and
// bin/ask.js), not to pretend nothing was retrieved. a full refusal is
// reserved for evidenceGrader deciding GRADES.INSUFFICIENT -- genuinely
// nothing relevant retrieved -- which happens upstream of this function
// entirely and never reaches it.
//
// kept as a real function rather than deleted outright: existing callers
// (the v2 agent pipeline's verification strategy) reference it for
// migration-comparison metadata, not for a live decision, and a toggle back
// to the old policy should be one line in this set, not a rewrite.
const BLOCKING_WARNING_KINDS = new Set([]);

/**
 * Decides whether a verification failure is serious enough
 * that the answer should not be shown to the coach.
 *
 * Always false under the current policy -- see BLOCKING_WARNING_KINDS.
 */
export function shouldBlockAnswer(verification) {
  return (
    verification?.warnings?.some(
      (warning) =>
        BLOCKING_WARNING_KINDS.has(warning.kind) &&
        warning.severity === "high",
    ) ?? false
  );
}
