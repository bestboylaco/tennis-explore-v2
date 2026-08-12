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
      title: chunk.title,
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
export function findUnsupportedNumbers(answer, evidence) {
  const evidenceText = evidence.map((chunk) => chunk.text ?? "").join(" ");

  // ignore the citation markers themselves and small integers, which are
  // usually counts in ordinary prose ("in two of the three blocks").
  const stripped = String(answer).replace(CITATION_MARKER, " ");
  const numbers = stripped.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [];

  return [...new Set(numbers)].filter((number) => {
    const bare = number.replace(/%$/, "");

    if (Number(bare) < 10 && !number.endsWith("%")) return false;

    return !evidenceText.includes(bare);
  });
}
