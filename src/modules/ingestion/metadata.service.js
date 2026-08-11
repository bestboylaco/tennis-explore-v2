// metadata + schema enforcement for every chunk (TENISE-15 / E3-09).
//
// this module is the gate. nothing reaches the index without passing through
// `enforceSchema`, and that function throws rather than repairing. the reason it
// throws: a chunk that quietly loses its acl_groups is a chunk that is either
// invisible to everyone or visible to everyone, and both of those are worse than
// a build that stops and tells you which document is broken.

import {
  DOMAINS,
  NO_PROGRAM,
  SENSITIVITY_ORDER,
  grantsForDocument,
} from "../../shared/constants/accessControl.js";

export const SCHEMA_VERSION = 2;

// keys every chunk must carry. `event_date` and `authors` must be PRESENT even
// when we could not work out a value -- null and [] are fine, missing is not.
// that distinction matters: a missing key means ingestion forgot, a null value
// means ingestion looked and there was nothing there.
const REQUIRED_KEYS = [
  "chunk_id",
  "doc_id",
  "modality",
  "source_type",
  "title",
  "text",
  "acl_groups",
  "data_domain",
  "sensitivity",
  "program",
  "authors",
  "event_date",
  "ingested_at",
];

const MODALITIES = ["document", "record", "media"];

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

// the partner's csvs use dd-mm-yyyy and dd/mm/yyyy, the pdfs use whatever the
// journal used, and javascript's Date() will happily read "01-02-2025" as the
// 2nd of january in american order. so we parse explicitly instead of trusting
// Date(), because getting a match date silently wrong by ten months is the kind
// of bug nobody notices until a coach does.
const DATE_PATTERNS = [
  { re: /^(\d{4})-(\d{2})-(\d{2})/, order: ["y", "m", "d"] },
  { re: /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/, order: ["d", "m", "y"] },
  { re: /^(\d{4})[/](\d{1,2})[/](\d{1,2})/, order: ["y", "m", "d"] },
];

export function normaliseDate(raw) {
  if (raw === null || raw === undefined) return null;

  // spreadsheets give us real Date objects (see extraction.service). those are
  // already unambiguous, so take them straight rather than restringing and
  // re-parsing, which is where day/month order gets lost.
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }

  const value = String(raw).trim();

  if (value === "" || /^(not available|n\/a|na|unknown|-)$/i.test(value)) {
    return null;
  }

  for (const { re, order } of DATE_PATTERNS) {
    const match = value.match(re);

    if (!match) continue;

    const parts = {};
    order.forEach((key, index) => {
      parts[key] = Number(match[index + 1]);
    });

    const { y, m, d } = parts;

    // a real calendar check, so 31-02-2025 is rejected rather than rolling over
    // into march.
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;

    const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const check = new Date(`${iso}T00:00:00Z`);

    if (Number.isNaN(check.getTime()) || check.getUTCDate() !== d) return null;

    return iso;
  }

  // a bare year, which is what most papers give us.
  const yearOnly = value.match(/^(19|20)\d{2}$/);

  if (yearOnly) return `${value}-01-01`;

  return null;
}

// ---------------------------------------------------------------------------
// authors
// ---------------------------------------------------------------------------

// academic front matter is messy: the title, the journal banner, the authors and
// the affiliations all run together, and every one of them is title-case, so a
// naive "find capitalised word pairs" pass returns the title as if it were a
// list of people.
//
// so this works line by line and picks the ONE line that looks like an author
// line: several personal names, joined by commas or "and". a title has
// capitalised words but almost never that punctuation pattern, and the words in
// a title are overwhelmingly ordinary nouns and verbs rather than names.
//
// it is a heuristic and it will miss some. that is the intended trade -- a
// missing author is a gap, an invented one is a false attribution printed next
// to a citation.

// words that appear in paper titles, journal banners and section headings. a
// candidate "name" containing any of these is not a person.
const NOT_A_NAME = new RegExp(
  "\\b(Original|Research|Article|Review|Study|Studies|Journal|International|Full|Terms|" +
    "Conditions|Access|Volume|Issue|Abstract|Introduction|Methods|Results|Discussion|" +
    "Determining|Differentiating|Comparing|Assessing|Effects?|Impact|Analysis|Profiles?|" +
    "Movement|Stroke|Competitive|Tennis|Match|Play|Wearable|Sensor|Accelerometry|Training|" +
    "Tournament|Periodisation|Periodization|Distribution|Microtechnology|Insights?|Athlete|" +
    "Women|Men|Long|Term|Development|Load|Serve|Sport|Sports|Science|Performance|" +
    "University|School|Faculty|Department|Institute|College|Centre|Center|Laboratory|" +
    "Australia|Melbourne|Sydney|Correspondence|Address|Received|Accepted|Published|Copyright)\\b",
  "i",
);

// a person's name here is two to four capitalised words. initials with a dot
// ("M. Reid") are allowed because journals use them constantly.
const NAME_PATTERN = /\b((?:[A-Z]\.|[A-Z][a-z'\u2019-]+)(?:\s+(?:[A-Z]\.|[A-Z][a-z'\u2019-]+)){1,3})\b/g;

function namesInLine(line) {
  const found = [];

  for (const match of line.matchAll(NAME_PATTERN)) {
    const candidate = match[1].replace(/\s+/g, " ").trim();

    // a lone pair of initials is not a name we can use.
    if (!/[a-z]/.test(candidate)) continue;
    if (NOT_A_NAME.test(candidate)) continue;
    if (found.includes(candidate)) continue;

    found.push(candidate);
  }

  return found;
}

// some publishers (mdpi especially) print a citation block instead of a normal
// author line: "Perri, T.; Reid, M.; Murphy, A.; Howle, K.". that is
// surname-first with initials and semicolons, and it is usually wrapped across
// several short lines, so the line-by-line pass above never sees it whole.
// this pass joins the head of the page back together and reads that form
// directly.
const CITATION_STYLE = /\b([A-Z][a-z'\u2019-]{1,})\s*,\s*((?:[A-Z]\.\s*){1,3})/g;

function citationStyleAuthors(headText) {
  const found = [];

  for (const match of headText.matchAll(CITATION_STYLE)) {
    const surname = match[1];

    if (NOT_A_NAME.test(surname)) continue;

    const initials = match[2].replace(/\s+/g, " ").trim();
    const name = `${initials} ${surname}`;

    if (!found.includes(name)) found.push(name);
  }

  // two or more, for the same reason as the line pass: one match is far more
  // likely to be "Sensors 2022, 22" style noise than a real author.
  return found.length >= 2 ? found : [];
}

export function extractAuthors(frontMatter, { max = 12 } = {}) {
  if (!frontMatter) return [];

  // affiliation superscripts are glued to surnames (Perri,1,2) and would
  // otherwise split "Perri" off from "Thomas". strip digits first, everywhere.
  const lines = String(frontMatter)
    .split(/\n|(?<=[a-z])\s{2,}(?=[A-Z])/)
    .map((line) => line.replace(/\d+(\s*,\s*\d+)*/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .slice(0, 25); // the author line is never far down the first page

  let best = [];

  for (const line of lines) {
    // an author line is punctuated like a list. a title is not.
    const looksLikeAList = /,|\band\b|&/.test(line);

    if (!looksLikeAList) continue;

    // cut at the first affiliation word: author lists run straight into
    // "School of Sport..." with no punctuation once the digits are gone.
    const affiliationStart =
      /\b(School|Faculty|Department|Institute|University|College|Centre|Center|Laboratory|Sports|Hospital|Academy|Correspondence)\b/;
    const cut = line.search(affiliationStart);
    const head = cut > 0 ? line.slice(0, cut) : line;

    const names = namesInLine(head);

    // require at least two, so a single stray capitalised phrase in the journal
    // banner cannot win.
    if (names.length >= 2 && names.length > best.length) best = names;
  }

  // fall back to the citation-block form only if the normal author line was not
  // found -- a real author line is cleaner when both are present.
  if (best.length === 0) {
    best = citationStyleAuthors(lines.slice(0, 12).join(" "));
  }

  return best.slice(0, max);
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

/**
 * decides a document's (domain, sensitivity, program) from what we know about
 * it. this is the one place classification happens, so changing the policy means
 * changing one function and rebuilding, not hunting through the ingestion code.
 *
 * the defaults are deliberately conservative: anything we do not recognise is
 * treated as internal rather than public.
 */
export function classifyDocument({ sourceType, fileName = "", text = "" }) {
  const haystack = `${fileName} ${text.slice(0, 2000)}`.toLowerCase();

  // published research is public by definition -- it is already in a journal.
  if (sourceType === "research_paper") {
    return { domain: "research", sensitivity: "public", program: NO_PROGRAM };
  }

  // a presentation given internally is internal by default. the catapult deck
  // literally carries "Confidential | July 2023" on its footer, and treating a
  // deck as public because it is not a csv would be exactly the sort of quiet
  // mistake the classification axis exists to prevent.
  if (sourceType === "presentation") {
    return {
      domain: /injur|lumbar|bone stress|medical/.test(haystack) ? "physiological" : "performance",
      sensitivity: /confidential/.test(haystack) ? "confidential" : "internal",
      program: "national-academy",
    };
  }

  if (sourceType === "policy" || /policy|acceptable usage|information security/.test(haystack)) {
    return { domain: "administrative", sensitivity: "internal", program: NO_PROGRAM };
  }

  if (sourceType === "ranking_data") {
    return { domain: "performance", sensitivity: "internal", program: NO_PROGRAM };
  }

  if (sourceType === "match_report" || sourceType === "player_report") {
    return { domain: "performance", sensitivity: "confidential", program: "pro-tour" };
  }

  // wearable and load monitoring data is physiological, not clinical -- it is
  // monitoring, and a coach is entitled to it. injury notes would be clinical
  // and only the physiotherapist role reaches those.
  if (/heart rate|training load|accelerometer|wearable|gps|rpe/.test(haystack)) {
    return { domain: "physiological", sensitivity: "confidential", program: "national-academy" };
  }

  return { domain: "administrative", sensitivity: "internal", program: NO_PROGRAM };
}

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

export function enforceSchema(chunk, { strict = true } = {}) {
  const problems = [];

  for (const key of REQUIRED_KEYS) {
    if (!(key in chunk)) problems.push(`missing required key '${key}'`);
  }

  if (typeof chunk.text !== "string" || chunk.text.trim() === "") {
    problems.push("text is empty");
  }

  if (!MODALITIES.includes(chunk.modality)) {
    problems.push(`modality '${chunk.modality}' is not one of ${MODALITIES.join(", ")}`);
  }

  if (!DOMAINS.includes(chunk.data_domain)) {
    problems.push(`data_domain '${chunk.data_domain}' is not a known domain`);
  }

  if (!SENSITIVITY_ORDER.includes(chunk.sensitivity)) {
    problems.push(`sensitivity '${chunk.sensitivity}' is not a known level`);
  }

  if (!Array.isArray(chunk.acl_groups) || chunk.acl_groups.length === 0) {
    problems.push(
      "acl_groups is empty. every chunk must carry at least one grant string, " +
        "or the filter has nothing to match and the chunk is unreachable",
    );
  }

  if (!Array.isArray(chunk.authors)) {
    problems.push("authors must be an array (empty is fine, missing is not)");
  }

  if (chunk.event_date !== null && normaliseDate(chunk.event_date) !== chunk.event_date) {
    problems.push(`event_date '${chunk.event_date}' is not iso yyyy-mm-dd or null`);
  }

  // the acl_groups on the chunk must be exactly what the classification implies.
  // this catches the case where someone edits data_domain by hand and forgets
  // that the grant string is a denormalised copy of it.
  if (chunk.data_domain && chunk.sensitivity && chunk.program) {
    try {
      const expected = grantsForDocument({
        domain: chunk.data_domain,
        sensitivity: chunk.sensitivity,
        program: chunk.program,
      });

      if (JSON.stringify(expected) !== JSON.stringify(chunk.acl_groups)) {
        problems.push(
          `acl_groups ${JSON.stringify(chunk.acl_groups)} does not match the ` +
            `classification, which implies ${JSON.stringify(expected)}`,
        );
      }
    } catch (error) {
      problems.push(error.message);
    }
  }

  if (problems.length > 0 && strict) {
    throw new Error(
      `chunk ${chunk.chunk_id ?? "(no id)"} failed schema v${SCHEMA_VERSION}:\n  - ${problems.join("\n  - ")}`,
    );
  }

  return { valid: problems.length === 0, problems };
}
