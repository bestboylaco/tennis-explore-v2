// citation binding (TENISE-21 / E4-15).
//
// the job: take the answer the model wrote and prove every claim in it points at
// a chunk that actually exists.
//
// this is not decoration. an ungrounded rag answer and a grounded one look
// identical to a reader -- both are fluent prose about tennis. the only thing
// that distinguishes them is whether the numbers can be traced back to a
// document, and a coach is not going to do that by hand. so we do it here, and
// we say plainly when it fails.

const CITATION_MARKER = /\[(\d+)\]/g;

// ---------------------------------------------------------------------------
// normalising citation phrasings that are not "[n]" but unambiguously mean it
// ---------------------------------------------------------------------------
//
// GROUNDING_RULES asks for "[n]" and forbids spelling it out, and most
// answers comply. when one does not, it is usually not vague about WHICH
// chunk it means -- "evidence block 6", "sources 4 and 6", "[Sources: 4, 6]"
// all name a real, specific chunk number, just in words or a trailing list
// instead of an inline bracket. that is a different, more reliable case
// than textCitesKnownAuthor's fuzzy author/year matching: there is no
// ambiguity to resolve, only a different spelling of the same bracket to
// convert, once, before bindCitations/verifyAnswer/toApaText ever see the
// text (observed live, 2026-09-17, three different phrasings of this across
// three different answers on the same model).
function numbersToBrackets(list) {
  return (list.match(/\d+/g) ?? []).map((number) => `[${number}]`).join("");
}

export function normaliseCitationPhrasing(answer) {
  return String(answer)
    // "[Sources: 4, 6]" or "(Sources: 4, 6)" -- a bracketed/parenthesised list.
    .replace(
      /[[(]\s*sources?\s*:\s*(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*[)\]]/gi,
      (_, list) => numbersToBrackets(list),
    )
    // "**Sources**: 3, 5, 6, 7." or "Sources: 3, 5, 6, 7" -- a trailing
    // unbracketed list, bold or not, as its own line at the very end of the
    // answer. GROUNDING_RULES explicitly forbids a separate sources section,
    // but the model still writes this one as a standalone recap sometimes
    // (observed live, 2026-10-01). anchored to the end of the string so an
    // ordinary sentence that happens to contain the word "sources" earlier
    // in the answer is never touched.
    .replace(
      /\*{0,2}sources?\*{0,2}\s*:\s*(\d+(?:\s*(?:,|and|&)\s*\d+)*)\.?\s*$/gi,
      (_, list) => numbersToBrackets(list),
    )
    // "[Evidence 1]", "[Evidence 4 and 6]" -- already wrapped in square
    // brackets, which is the model treating the brackets themselves as the
    // citation marker and just spelling the word out inside them. the whole
    // bracketed span is replaced, not just the word, so this becomes "[1]"
    // rather than the doubled-up "[[1]]" (observed live, 2026-09-18).
    .replace(
      /\[\s*(?:evidence(?:\s+blocks?)?|documents?|sources?)\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*\]/gi,
      (_, list) => numbersToBrackets(list),
    )
    // "evidence block 6", "evidence blocks 4 and 6", "evidence 6" (no
    // "block"), "source 6", "sources 4, 6", "document 6" -- the word instead
    // of the bracket, inline. any surrounding parentheses are prose
    // punctuation, not part of the citation, and are left alone -- only the
    // word+number span itself is replaced.
    .replace(
      /\b(?:evidence(?:\s+blocks?)?|documents?|sources?)\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\b/gi,
      (_, list) => numbersToBrackets(list),
    );
}

/**
 * drops every occurrence of a repeated [n] in `unit` except the last,
 * leaving distinct numbers and one-off citations untouched. the unit this
 * is given -- a sentence, a bullet line, a whole paragraph -- decides the
 * scope; this function only knows about positions within whatever string it
 * receives.
 */
function collapseRepeatedMarkers(unit) {
  const positions = [...unit.matchAll(/\[(\d+)\]/g)].map((match) => ({
    number: match[1],
    index: match.index,
    length: match[0].length,
  }));

  const lastIndexForNumber = new Map();
  const countForNumber = new Map();

  for (const position of positions) {
    lastIndexForNumber.set(position.number, position.index);
    countForNumber.set(position.number, (countForNumber.get(position.number) ?? 0) + 1);
  }

  let result = unit;

  for (let i = positions.length - 1; i >= 0; i -= 1) {
    const position = positions[i];
    const isRepeated = countForNumber.get(position.number) > 1;
    const isLastOccurrence = position.index === lastIndexForNumber.get(position.number);

    if (!isRepeated || isLastOccurrence) continue;

    let start = position.index;

    // absorb one preceding space, so removing "[4]" from "fact A [4], fact
    // B" leaves "fact A, fact B" rather than "fact A , fact B".
    if (start > 0 && result[start - 1] === " ") start -= 1;

    result = result.slice(0, start) + result.slice(position.index + position.length);
  }

  return result;
}

// a blank line -- the same boundary renderAnswer's appendBlock uses to split
// an answer into blocks client-side, so a "paragraph" here means the same
// thing it means on screen. captured so split() keeps the blank line itself
// in the result instead of discarding it.
const PARAGRAPH_SPLIT = /(\n{2,})/;

// a bullet ("- "/"* ") or ordered ("1. "/"1) ") line, the same shapes
// appendBlock in messageRenderer.js recognises as a list item.
const LIST_LINE = /^\s*(?:[-*]|\d+[.)])\s+/;

/**
 * when the same [n] is repeated across several clauses of flowing prose --
 * one citation marker per fact it supports, even though every fact came
 * from the same source -- keeps only the last occurrence and drops the
 * earlier ones, so a paragraph ends with one citation rather than one after
 * every sentence (reported directly: the same reference appearing three
 * times across three consecutive sentences, all citing one source).
 *
 * scoped to one paragraph at a time, not the whole answer: citing the same
 * source again in a LATER paragraph, for a different point, is normal and
 * is left alone. a list block is handled per line instead of as a whole --
 * each bullet is its own scannable, independently-checkable claim (the
 * structure explicitly asked for elsewhere), so collapsing a citation out
 * of bullet two because bullet four cites the same source would make that
 * bullet look unsupported on its own.
 */
export function consolidateRepeatedCitations(answer) {
  const blocks = String(answer).split(PARAGRAPH_SPLIT);

  return blocks
    .map((block) => {
      if (/^\n{2,}$/.test(block)) return block;

      const lines = block.split("\n");
      const isList = lines.some((line) => LIST_LINE.test(line));

      return isList ? lines.map(collapseRepeatedMarkers).join("\n") : collapseRepeatedMarkers(block);
    })
    .join("");
}

/**
 * pulls the [n] markers out of an answer, in the order they appear.
 */
export function extractCitationMarkers(answer) {
  const numbers = [];

  for (const match of String(answer).matchAll(CITATION_MARKER)) {
    const number = Number(match[1]);

    if (!numbers.includes(number)) numbers.push(number);
  }

  return numbers;
}

// a specific, identifiable contamination pattern: 62 documents across the
// corpus have their "title" field extracted as the ResearchGate cover-page
// boilerplate ("See discussions, stats, and author profiles for this
// publication at: <url> <the real title>") rather than the paper's actual
// title, because that line sits above the real title on the page and the
// extraction took the first line of text. the real title reliably follows
// the url, so it is recovered by stripping everything up to and including
// it, rather than discarded outright -- a citation naming no source at all
// is worse than one with an ugly title (reported directly, 2026-09-28:
// citations reading `("See discussions, stats, and author profiles...,"
// 2015)`).
const RESEARCHGATE_BOILERPLATE =
  /^see discussions,?\s*stats,?\s*and author profiles for this publication at:?\s*https?:\/\/\S+\s*/i;

export function cleanTitle(title) {
  const value = String(title ?? "").trim();
  const stripped = value.replace(RESEARCHGATE_BOILERPLATE, "").trim();

  // never return an empty string -- if stripping the boilerplate leaves
  // nothing (the real title failed to extract too), showing the original
  // messy text is still more honest than showing "untitled source".
  return stripped || value;
}

/**
 * binds each marker back to the chunk it refers to.
 *
 * a marker with no matching chunk is a hallucinated citation -- the model wrote
 * [7] when only 5 chunks were supplied. it is reported rather than silently
 * dropped, because a model that invents citation numbers is also inventing the
 * claims attached to them, and that is worth knowing.
 */
export function bindCitations(answer, evidence) {
  const byNumber = new Map(evidence.map((chunk) => [chunk.citationNumber, chunk]));
  const markers = extractCitationMarkers(answer);

  const citations = [];
  const dangling = [];

  for (const number of markers) {
    const chunk = byNumber.get(number);

    if (!chunk) {
      dangling.push(number);
      continue;
    }

    citations.push({
      number,
      chunkId: chunk.chunk_id,
      docId: chunk.doc_id,
      title: cleanTitle(chunk.title),
      // the filename is shown next to the title because title extraction from a
      // pdf is a best effort -- across 2,300 partner files plenty have no usable
      // title page at all. the filename always identifies the document exactly,
      // so a citation stays verifiable even when the title guess is poor.
      fileName: chunk.file_name ?? null,
      // everything a reader needs to go and check the claim themselves.
      section: chunk.section ?? null,
      page: chunk.page ?? null,
      authors: chunk.authors ?? [],
      date: chunk.event_date ?? null,
      sourceType: chunk.source_type,
      sourceUri: chunk.source_uri ?? null,
      sensitivity: chunk.sensitivity,
      // the exact text the claim was drawn from. trimmed, because a citation
      // panel showing 1600 characters is a citation panel nobody reads.
      quote: buildQuote(chunk.text),
      // `excerpt` and `url` are aliases of `quote` and `link.href`. they exist
      // because the frontend was written against an earlier citation shape and
      // reads those names -- without them the citation buttons render but the
      // preview and the link are silently empty, which is a failure that looks
      // exactly like "no source available".
      excerpt: buildQuote(chunk.text),
      // which arms found it, carried through from ranking. useful in a review:
      // "this came from the vector arm only" explains a lot about a wrong answer.
      foundBy: chunk.foundBy ?? [],
    });
  }

  const cited = new Set(citations.map((citation) => citation.number));

  return {
    citations,
    dangling,
    // evidence we retrieved and the model did not use. a consistently high
    // number here means topN is set larger than the model can actually absorb.
    unusedEvidence: evidence
      .filter((chunk) => !cited.has(chunk.citationNumber))
      .map((chunk) => chunk.citationNumber),
    grounded: citations.length > 0 && dangling.length === 0,
  };
}

function buildQuote(text, maxChars = 320) {
  const clean = String(text).replace(/\s+/g, " ").trim();

  if (clean.length <= maxChars) return clean;

  // cut at a word boundary so the quote does not end mid-word.
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");

  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars)}...`;
}

/**
 * a blunt check that the answer did not invent numbers.
 *
 * every number in the answer should appear somewhere in the evidence. this is
 * intentionally crude -- it will flag a model that correctly writes "just over
 * half" as "51%" -- but on a corpus of match scores and load figures, a number
 * in the answer that appears nowhere in the evidence is nearly always the model
 * filling in from memory, which is the exact failure the grounding prompt exists
 * to prevent.
 */
// the trailing boundary is a lookahead, not `\b`, on purpose: source prose
// routinely glues a unit straight onto the number ("≈900m disparity",
// "2110m") with no space, and digit-then-letter is not a `\b` boundary at
// all -- `\b` silently refused to match "900" in exactly that sentence,
// which is how a real, correctly-cited figure ended up reported as
// appearing in no source at all (observed live, 2026-09-18).
const NUMBER_TOKEN = /\b\d[\d,]*(?:\.\d+)?%?(?!\d)/g;

function parseNumberToken(token) {
  const bare = token.replace(/%$/, "").replace(/,/g, "");
  const dot = bare.indexOf(".");

  return { value: Number(bare), decimals: dot === -1 ? 0 : bare.length - dot - 1 };
}

/**
 * which of the numbers actually written in `text` are NOT supported by
 * `evidenceText` -- compared by VALUE, at the precision `text` actually used,
 * not by exact substring and not by exact numeric equality either.
 *
 * two real failures showed up from exact-substring matching: the
 * structured/table path shows the model a 2-decimal-formatted table (141.70)
 * while the underlying evidence was JSON.stringify'd raw numbers (141.7), and
 * a model writing prose adds its own thousands separators
 * (10760 -> "10,760") that never appear verbatim anywhere. both are the same
 * number, faithfully reported, not a hallucination -- exact-string matching
 * flagged both as "unsupported" regardless (observed live, 2026-09-17, a
 * fully correct table answer shown to the user with a false "these figures
 * appear in no source" warning attached).
 *
 * exact numeric equality does not work either: a statistic computed as
 * 94.22222222222223 and reported as "94.22" is a correct rounding, not a
 * different number. so an evidence number counts as supporting an answer
 * number if rounding the EVIDENCE number to the precision the answer
 * actually used reproduces the answer's value.
 *
 * small numbers (<10, not a percentage) are excluded -- they are usually
 * counts in ordinary prose ("in two of the three blocks") rather than a
 * figure worth tracing.
 */
export function findUnsupportedNumberTokens(text, evidenceText) {
  const evidenceValues = (String(evidenceText).match(NUMBER_TOKEN) ?? [])
    .map(parseNumberToken)
    .map(({ value }) => value);

  const stripped = String(text).replace(CITATION_MARKER, " ");
  const tokens = stripped.match(NUMBER_TOKEN) ?? [];

  return [...new Set(tokens)].filter((token) => {
    const { value, decimals } = parseNumberToken(token);

    if (value < 10 && !token.endsWith("%")) return false;

    return !evidenceValues.some((ev) => Number(ev.toFixed(Math.min(decimals, 10))) === value);
  });
}

/**
 * a blunt check that the answer did not invent numbers, scoped to ALL
 * supplied evidence at once.
 *
 * this is the weakest form of the check: a number counts as supported if it
 * appears ANYWHERE among the evidence shown to the model, even in a chunk the
 * answer never actually cited for that claim. it catches outright invention
 * (a number nowhere in anything retrieved) but not misattribution (a real
 * number, attached to the wrong citation). findCitationMismatches in
 * verifier.service.js catches the latter by scoping this same check to the
 * specific chunk(s) each claim actually cited.
 */
export function findUnsupportedNumbers(answer, evidence) {
  const evidenceText = evidence
    .map((chunk) => {
      // a citation year ("Ellenbecker ... 1999") often names a chunk's own
      // publication date rather than anything repeated in its body text --
      // chunk.date exists precisely so a citation can be built without the
      // year appearing twice. leaving it out of what this checks against
      // meant a correctly-cited year read as an invented figure (observed
      // live, 2026-09-17: "1999" flagged as "appears in no source" for a
      // source dated 1999).
      const year = chunk.date ?? chunk.event_date ?? chunk.publication_year ?? "";

      return `${chunk.text ?? ""} ${year}`;
    })
    .join(" ");

  return findUnsupportedNumberTokens(answer, evidenceText);
}

// ---------------------------------------------------------------------------
// APA-style display
// ---------------------------------------------------------------------------
//
// the [n] markers stay the internal, machine-checked format -- everything
// above this line binds, verifies and scores against them, and that only
// works because a small model can reliably produce "[3]" but not a fully
// correct "(Smith et al., 2023, p. 12)" on the first try. this section is
// purely a DISPLAY transform on top of that, run once here so the CLI and
// the browser render the identical thing rather than each reimplementing
// citation formatting.
//
// deliberately informal APA rather than strict APA: author strings extracted
// from partner PDFs are frequently truncated or incomplete ("Amador Garc",
// not "Garcia, A.") -- reformatting broken data into a stricter shape would
// just make the breakage look authoritative. shown as-is instead.

function apaYear(date) {
  const match = String(date ?? "").match(/\b(1[89]|20)\d{2}\b/);

  return match ? match[0] : "n.d.";
}

function apaShortAuthor(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return null;
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;

  return `${authors[0]} et al.`;
}

function apaShortTitle(citation, maxWords = 6) {
  const title = citation.title || citation.fileName || citation.docId || "untitled source";
  const words = String(title).trim().split(/\s+/);

  const short = words.slice(0, maxWords).join(" ");

  return words.length > maxWords ? `${short}...` : short;
}

/**
 * the short, in-text form for one citation -- "(Author, Year)" when an
 * author is known, or "("Title," Year)" when it is not. never returns
 * nothing: even a source with neither an author nor a usable title still
 * gets a year (or "n.d.") and its source type, so the reader always sees
 * something to check the claim against.
 */
export function apaInText(citation) {
  const author = apaShortAuthor(citation.authors);
  const year = apaYear(citation.date);

  if (author) return `${author}, ${year}`;

  return `"${apaShortTitle(citation)}," ${year}`;
}

/**
 * the full reference-list form for one citation. kept numbered
 * ([3] Author...) alongside the APA-ish prose, not instead of it -- the
 * number is what a citation button and an in-text marker both still key
 * off, and two sources that legitimately share the same short author/year
 * form (two papers by the same author in the same year) would otherwise be
 * indistinguishable in the reference list.
 */
export function apaReference(citation) {
  const author = Array.isArray(citation.authors) && citation.authors.length > 0
    ? citation.authors.join(", ")
    : null;

  const year = apaYear(citation.date);
  const title = citation.title || citation.fileName || citation.docId || "Untitled source";

  const parts = [];

  if (author) parts.push(`${author}.`);
  parts.push(`(${year}).`);
  parts.push(`${title}.`);
  if (citation.sourceType) parts.push(`[${citation.sourceType}]`);

  return `[${citation.number}] ${parts.join(" ")}`;
}

/**
 * rewrites the [n] markers in an answer into APA-style in-text citations,
 * for display only -- the verification and citation-binding above this line
 * always run against the original [n] text, before this is called.
 *
 * a run of consecutive markers ("[2][5]") becomes one parenthetical with
 * both sources separated by a semicolon ("(Author2, 2021; Author5, 2019)"),
 * matching how APA groups multiple sources for the same claim rather than
 * stacking separate parentheticals.
 *
 * a marker with no matching citation (a dangling one -- see bindCitations)
 * is left as the bare "[n]" rather than silently dropped: an invented
 * citation number should stay visible, not disappear into clean-looking
 * prose.
 */
export function toApaText(answer, citations) {
  const byNumber = new Map(citations.map((citation) => [citation.number, citation]));

  return String(answer).replace(/(?:\[\d+\])+/g, (group) => {
    const numbers = [...group.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
    const known = numbers.map((number) => byNumber.get(number)).filter(Boolean);

    if (known.length === 0) return group;

    return `(${known.map(apaInText).join("; ")})`;
  });
}

/**
 * the reference list for one answer, numbered and in citation order.
 */
export function buildReferenceList(citations) {
  return [...citations].sort((a, b) => a.number - b.number).map(apaReference);
}

// ---------------------------------------------------------------------------
// recognising a citation the model wrote in its own words
// ---------------------------------------------------------------------------
//
// GROUNDING_RULES asks for [n] brackets, and most answers use them. but a
// model that has read a lot of academic writing sometimes cites the way
// academic writing does instead -- "Ellenbecker et al. (1999, 2003)... all
// corroborate these findings" -- correctly naming a real author and a real
// year from the evidence it was actually given, just not in bracket form
// (observed live, 2026-09-17). treating that as "cited nothing" is wrong: it
// IS a citation, and a verifiable one, since the author/year pair can still
// be checked against the evidence actually supplied. it is a weaker one than
// a bracket -- there is no chunk-level binding, so no "Sources" button can
// point at it -- which is why this is used to soften the wording of a
// warning, never to suppress it outright.

/**
 * every (surname, year) pair that is actually true of the supplied evidence.
 * built once per answer and reused across sentences.
 */
export function buildAuthorYearIndex(evidence) {
  const index = new Map();

  for (const chunk of evidence) {
    const year = apaYear(chunk.date ?? chunk.event_date ?? chunk.publication_year);

    if (year === "n.d.") continue;

    for (const author of chunk.authors ?? []) {
      // the surname is assumed to be the last word of whatever string this
      // extraction pipeline recorded ("Thomas Perri" -> "Perri"). this is a
      // guess, not a real name parser -- good enough to recognise a mention,
      // not precise enough to lean on for anything that needs to be exactly
      // right.
      const surname = String(author).trim().split(/\s+/).pop();

      if (!surname || surname.length < 3) continue;

      if (!index.has(surname)) index.set(surname, new Set());
      index.get(surname).add(year);
    }
  }

  return index;
}

/**
 * does this piece of text name a real author next to a real year for that
 * same author, per the index above -- "Ellenbecker ... 1999" anywhere in the
 * text, not necessarily adjacent, since "et al. (1999, 2003)" separates the
 * name from at least one of its years.
 */
export function textCitesKnownAuthor(text, authorYearIndex) {
  const value = String(text);

  for (const [surname, years] of authorYearIndex) {
    if (!value.includes(surname)) continue;

    for (const year of years) {
      if (value.includes(year)) return true;
    }
  }

  return false;
}
