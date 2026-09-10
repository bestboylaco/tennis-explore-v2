// splits documents into chunks and gives every chunk its context back.
//
// the interesting part of this file is not the splitting, it is
// `buildContextHeader`. a chunk cut out of the middle of a paper reads like
// this:
//
//   "this increased by 12% in the second block, which is consistent with the
//    earlier finding."
//
// there is nothing in that text to retrieve on. what increased? whose finding?
// which paper? the embedding lands in a vague region of space and bm25 has
// nothing distinctive to match. anthropic's contextual retrieval write-up
// measured a 49% drop in retrieval failures from fixing exactly this, and 67%
// once a reranker is added on top -- it is the highest-value single change in
// this whole pipeline, and it costs nothing at query time because the work
// happens at ingest.
//
// so before embedding, each chunk gets a short header naming the document, the
// section, the date and the authors. the header goes into the embedding and into
// the bm25 tokens. it is stored separately from `text` so that a citation still
// quotes what the document actually says, not our header.

import { retrievalConfig } from "../../config/retrieval.config.js";
import { tableRowToText, tableToText } from "./textractBlocks.js";

// ---------------------------------------------------------------------------
// splitting prose
// ---------------------------------------------------------------------------

/**
 * splits on paragraph boundaries first, sentence boundaries second, and only
 * cuts mid-sentence when a single sentence is longer than the target.
 *
 * why bother respecting boundaries: a chunk that starts halfway through a
 * sentence begins with a fragment that means nothing on its own, and that
 * fragment is part of what gets embedded.
 */
export function splitText(text, { targetChars, overlapChars, minChars }) {
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph !== "");

  const pieces = [];
  let current = "";

  const flush = () => {
    if (current.trim() !== "") pieces.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 1 <= targetChars) {
      current = current === "" ? paragraph : `${current} ${paragraph}`;
      continue;
    }

    flush();

    if (paragraph.length <= targetChars) {
      current = paragraph;
      continue;
    }

    // a paragraph bigger than the target on its own -- common in pdfs, where a
    // whole page often comes out as one block. fall back to sentences.
    const sentences = paragraph.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [paragraph];

    for (const sentence of sentences) {
      if (current.length + sentence.length <= targetChars) {
        current += sentence;
        continue;
      }

      flush();

      if (sentence.length <= targetChars) {
        current = sentence;
      } else {
        // one sentence longer than the target. rare, usually a table that lost
        // its line breaks. hard-cut it.
        for (let i = 0; i < sentence.length; i += targetChars) {
          pieces.push(sentence.slice(i, i + targetChars).trim());
        }
      }
    }
  }

  flush();

  // add the overlap tail. kept small on purpose -- a 2026 study found overlap
  // gave no measurable retrieval benefit and only grew the index; it is here
  // just to stop a sentence being severed at a boundary.
  const withOverlap = pieces.map((piece, index) => {
    if (index === 0 || overlapChars <= 0) return piece;

    const previous = pieces[index - 1];
    const tail = previous.slice(Math.max(0, previous.length - overlapChars));

    return `${tail} ${piece}`.trim();
  });

  // drop the scraps: page numbers, running headers, orphaned footnote markers.
  // they match weakly against everything and strongly against nothing.
  return withOverlap.filter((piece) => piece.length >= minChars);
}

// ---------------------------------------------------------------------------
// section detection
// ---------------------------------------------------------------------------

// research papers use a small, predictable set of headings, so a lookup beats a
// clever heuristic here. anything unrecognised returns null rather than a guess.
const SECTION_PATTERNS = [
  [/\babstract\b/i, "abstract"],
  [/\bintroduction\b/i, "introduction"],
  [/\b(methods?|methodology|materials and methods)\b/i, "methods"],
  [/\bresults?\b/i, "results"],
  [/\bdiscussion\b/i, "discussion"],
  [/\bconclusions?\b/i, "conclusion"],
  [/\breferences\b/i, "references"],
  [/\b(practical applications?)\b/i, "practical_applications"],
];

export function detectSection(text, fallback = null) {
  const head = text.slice(0, 200);

  for (const [pattern, name] of SECTION_PATTERNS) {
    if (pattern.test(head)) return name;
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// the contextual header
// ---------------------------------------------------------------------------

/**
 * builds the situating prefix that goes in front of a chunk before embedding.
 *
 * template mode, which is the default, assembles it from metadata we already
 * have. it is free and instant. llm mode asks the local model to write a
 * one-sentence summary per chunk instead -- better, but that is one model call
 * per chunk, so roughly an hour or two for a corpus this size. both write into
 * the same field, so nothing downstream needs to know which was used.
 */
export function buildContextHeader({ title, section, authors = [], eventDate, sourceType }) {
  if (!retrievalConfig.contextual.enabled) return "";

  const parts = [];

  if (title) parts.push(title);

  // the source type is worth a word because "research" versus "match record" is
  // often exactly the distinction a query is drawing.
  if (sourceType) parts.push(sourceType.replace(/_/g, " "));

  if (section) parts.push(`section: ${section.replace(/_/g, " ")}`);

  if (authors.length > 0) {
    // first three is enough to identify the paper. a full nine-author list would
    // dominate the chunk's tokens and start matching on the authors instead of
    // on what the chunk says.
    parts.push(`by ${authors.slice(0, 3).join(", ")}`);
  }

  if (eventDate) parts.push(eventDate);

  return parts.length > 0 ? `[${parts.join(" | ")}]` : "";
}

// ---------------------------------------------------------------------------
// structured rows
// ---------------------------------------------------------------------------

// values that mean "nothing here". dropped rather than verbalised, because
// otherwise every row says "not available" fifteen times and they all end up
// looking identical to the embedding model.
const NULL_VALUES = new Set([
  "", "nan", "none", "null", "n/a", "na", "not available", "-", "unknown",
]);

// columns that are pure machine identifiers. a uuid contributes nothing an
// embedding can use and crowds out the words that matter.
const NOISE_COLUMN = /uuid|_id$|^id$|guid/i;

function humanise(column) {
  return String(column)
    .replace(/[_-]+/g, " ")
    .replace(/(?<=[a-z])(?=[A-Z])/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * rewrites one row of a spreadsheet as a sentence.
 *
 *   { Date: "24-11-2025", event_name: "Playford Challenger", score: "6-2 6-0" }
 *   -> "Match record. date 24-11-2025. event name Playford Challenger. score 6-2 6-0."
 *
 * this is what lets one query rank a spreadsheet row and a paragraph from a
 * paper in the same list -- they are both just text by the time the embedding
 * model sees them.
 *
 * what this deliberately does NOT do: answer aggregation questions. "what was
 * the squad average" is a database job, not a retrieval job. row_id and table_id
 * are kept on the chunk so a later story can hand the real numbers to something
 * that can do arithmetic.
 */
export function verbaliseRow(row, { label = "Record", maxChars = 1400 } = {}) {
  const parts = [];

  for (const [column, value] of Object.entries(row)) {
    if (NOISE_COLUMN.test(column)) continue;

    // a Date stringifies to "Wed Apr 22 2026 00:00:00 GMT+0000 (...)", which is
    // a lot of tokens saying very little and does not match how dates appear
    // anywhere else in the corpus. iso, same as every other date we index.
    const text =
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value ?? "").trim();

    if (NULL_VALUES.has(text.toLowerCase())) continue;

    parts.push(`${humanise(column)} ${text}`);
  }

  const sentence = `${label}. ${parts.join(". ")}.`;

  return sentence.length > maxChars ? `${sentence.slice(0, maxChars).trim()}...` : sentence;
}

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

/**
 * chunks one extracted document into records ready for metadata and embedding.
 *
 * returns partial chunks -- text, section, page, context header. the caller adds
 * classification, acl and dates, because those are policy decisions and this
 * file should not be making policy decisions.
 */
export function chunkDocument(extracted, { authors = [], eventDate = null } = {}) {
  const { targetChars, overlapChars, minChars } = retrievalConfig.chunking;
  const chunks = [];

  let lastSection = null;

  extracted.pages.forEach((pageText, pageIndex) => {
    const pieces = splitText(pageText, { targetChars, overlapChars, minChars });

    pieces.forEach((text, pieceIndex) => {
      // a section heading carries forward until a new one appears -- most pages
      // in the middle of a section do not repeat its name.
      const section = detectSection(text, lastSection);
      lastSection = section;

      const contextHeader = buildContextHeader({
        title: extracted.title,
        section,
        authors,
        eventDate,
        sourceType: extracted.sourceType,
      });

      chunks.push({
        chunk_id: `${extracted.docId}#p${String(pageIndex).padStart(4, "0")}_${pieceIndex}`,
        doc_id: extracted.docId,
        modality: "document",
        title: extracted.title,
        section,
        page: pageIndex + 1,
        text,
        context_header: contextHeader,
        embedding_text: contextHeader ? `${contextHeader}\n${text}` : text,
      });
    });
  });

  // a document whose pages are all shorter than minChars produces nothing at
  // all above, and would be dropped entirely. that is wrong: conference
  // handouts and slide printouts routinely carry ~90 characters a page, and
  // "Lecture Presentation: Darren Roberts, 'Action sports athletes'" is exactly
  // the sort of line someone will search for.
  //
  // so if per-page chunking found nothing, join the pages and chunk that
  // instead. the page number is lost -- the content is spread across all of
  // them -- and saying so with page: null is more honest than claiming page 1.
  if (chunks.length === 0) {
    const joined = extracted.pages.join("\n\n").replace(/\s+/g, " ").trim();

    if (joined.length >= 40) {
      const pieces = splitText(joined, { targetChars, overlapChars, minChars: 40 });

      pieces.forEach((text, index) => {
        const contextHeader = buildContextHeader({
          title: extracted.title,
          section: null,
          authors,
          eventDate,
          sourceType: extracted.sourceType,
        });

        chunks.push({
          chunk_id: `${extracted.docId}#w${String(index).padStart(4, "0")}`,
          doc_id: extracted.docId,
          modality: "document",
          title: extracted.title,
          section: null,
          page: null,
          text,
          context_header: contextHeader,
          embedding_text: contextHeader ? `${contextHeader}\n${text}` : text,
          // records that this document was too sparse to keep page numbers, so
          // a missing page in a citation is explainable rather than a bug.
          whole_document: true,
        });
      });
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// tables read out of scanned pages
// ---------------------------------------------------------------------------

/**
 * this is deliberately NOT `chunkDocument` with a different input. a table must
 * never reach `splitText`, and the reason is visible in that function: it joins
 * on `\s+`, which flattens every row onto one line, and then hard-cuts by
 * character count when a "sentence" is longer than the target. a table put
 * through it comes out as an undifferentiated run of numbers -- the columns are
 * gone, the rows are gone, and nothing downstream can tell that anything was
 * lost. so tables are cut on row boundaries here and never handed over.
 */
export function chunkTables(extracted, { authors = [], eventDate = null } = {}) {
  const { targetChars } = retrievalConfig.chunking;
  const tables = extracted.tables ?? [];
  const chunks = [];

  for (const table of tables) {
    if (!Array.isArray(table.grid) || table.grid.length === 0) continue;

    const body = tableToText(table);

    if (body === "") continue;

    // Textract's own caption when it read one off the page, because "Table 3.
    // Mean serve speed by round" is what someone actually searches for. failing
    // that, a generated label -- a chunk opening on a bare grid of numbers is
    // both unreadable in a citation and nearly unretrievable.
    const caption = table.title ?? `Table ${table.index + 1}`;
    const heading = `${caption} (page ${table.page}) — ${extracted.title}`;

    // the header row is repeated into every part, so it counts against the
    // budget of each. the separator row costs the same again.
    const [header] = table.grid;
    const headerText = tableToText({ grid: [header] });
    // serialise each row directly. this used to build a whole two-row markdown
    // table per row just to take its third line, which re-escaped the entire
    // header once for every row in the table -- 200 redundant header
    // serialisations on a 200-row table, for a string that is already computed
    // on the line above.
    const rowTexts = table.grid.slice(1).map((row) => tableRowToText(row));

    // rows per part, from what is actually left after the heading and the
    // repeated header. floored at one so a single enormous row still lands
    // somewhere rather than looping forever.
    const budget = targetChars - heading.length - headerText.length - 32;
    const parts = [];

    let current = [];
    let currentChars = 0;

    for (const rowText of rowTexts) {
      if (current.length > 0 && currentChars + rowText.length > budget) {
        parts.push(current);
        current = [];
        currentChars = 0;
      }

      current.push(rowText);
      currentChars += rowText.length + 1;
    }

    if (current.length > 0) parts.push(current);
    // a table of nothing but a header row is still worth keeping -- the column
    // names alone answer "what was measured".
    if (parts.length === 0) parts.push([]);

    parts.forEach((rows, partIndex) => {
      const label =
        parts.length > 1 ? `${heading} — part ${partIndex + 1} of ${parts.length}` : heading;

      const text = [label, headerText, ...rows].join("\n");

      const contextHeader = buildContextHeader({
        title: extracted.title,
        section: "table",
        authors,
        eventDate,
        sourceType: extracted.sourceType,
      });

      chunks.push({
        // padded like the page chunk ids in chunkDocument, so table chunks from
        // page 12 sort after page 4's rather than before them.
        chunk_id:
          `${extracted.docId}#t${String(table.page).padStart(4, "0")}_${table.index}` +
          (parts.length > 1 ? `_${partIndex}` : ""),
        doc_id: extracted.docId,
        modality: "document",
        title: extracted.title,
        section: "table",
        page: table.page,
        text,
        context_header: contextHeader,
        embedding_text: contextHeader ? `${contextHeader}\n${text}` : text,
        // says plainly that this text was read off a scanned image by OCR
        // rather than lifted from a text layer, so a quoted figure can be
        // framed with the honest caveat that it was machine-read.
        derived_from_ocr: true,
        ocr_engine: "textract",
        // carried through for the accuracy checklist, which sorts the cells a
        // human reviews by how unsure Textract was about them.
        low_confidence_cells: table.lowConfidenceCells ?? 0,
      });
    });
  }

  return chunks;
}

/**
 * chunks a table: one chunk per row, verbalised.
 */
export function chunkRecords(extracted, { label = "Record", eventDateColumns = [] } = {}) {
  return extracted.records.map((row, rowIndex) => {
    const text = verbaliseRow(row, { label });

    // several columns could hold the date and which one is populated varies row
    // by row -- the partner's match csv has both `match_date` and `Date`, and
    // `match_date` is literally the string "Not available" on every row we have.
    // so we collect every candidate in preference order and let the caller take
    // the first that parses, rather than picking one column for the whole file
    // and getting nulls everywhere.
    const eventDateCandidates = eventDateColumns
      .map((column) => row[column])
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== "");

    const contextHeader = buildContextHeader({
      title: extracted.title,
      section: null,
      authors: [],
      // only a Date or an iso-looking string is worth putting in the header;
      // anything else is noise the embedding model does not need.
      eventDate: eventDateCandidates[0] instanceof Date
        ? eventDateCandidates[0].toISOString().slice(0, 10)
        : eventDateCandidates[0] ?? null,
      sourceType: extracted.sourceType,
    });

    return {
      chunk_id: `${extracted.docId}#r${String(rowIndex).padStart(6, "0")}`,
      doc_id: extracted.docId,
      modality: "record",
      title: extracted.title,
      section: null,
      page: null,
      table_id: extracted.tableId,
      row_id: String(rowIndex),
      text,
      context_header: contextHeader,
      embedding_text: contextHeader ? `${contextHeader}\n${text}` : text,
      raw_event_candidates: eventDateCandidates,
    };
  });
}

/**
 * chunks a slide deck: one chunk per slide.
 *
 * slides are not split further even when wordy. a slide is already the author's
 * own unit of meaning -- they decided what belongs together -- and cutting one
 * in half produces two fragments that each make less sense than the whole. it
 * also keeps the slide number exact, which is what a citation needs.
 */
export function chunkSlides(extracted, { authors = [], eventDate = null } = {}) {
  const { minChars } = retrievalConfig.chunking;

  return extracted.slides
    // a slide holding only a number or a stray label is a section divider.
    .filter((slide) => slide.text.length >= Math.min(minChars, 40))
    .map((slide) => {
      const contextHeader = buildContextHeader({
        title: extracted.title,
        section: `slide ${slide.number}`,
        authors,
        eventDate,
        sourceType: extracted.sourceType,
      });

      return {
        chunk_id: `${extracted.docId}#s${String(slide.number).padStart(3, "0")}`,
        doc_id: extracted.docId,
        modality: "document",
        title: extracted.title,
        section: `slide ${slide.number}`,
        page: slide.number,
        slide: slide.number,
        text: slide.text,
        context_header: contextHeader,
        embedding_text: contextHeader ? `${contextHeader}\n${slide.text}` : slide.text,
      };
    });
}

/**
 * chunks a video manifest: one chunk per described segment.
 *
 * we are indexing the description of what happens, not the footage. that is an
 * honest limitation and worth stating plainly rather than implying the system
 * watches video -- but it is also the thing that makes a clip findable at all,
 * and the timestamp means the citation opens at the right second rather than at
 * the start.
 */
export function chunkVideo(extracted) {
  return extracted.segments.map((segment) => {
    const where = segment.start ? `${segment.start}-${segment.end ?? ""}` : null;

    const contextHeader = buildContextHeader({
      title: extracted.title,
      section: where ? `segment ${where}` : null,
      authors: [],
      eventDate: null,
      sourceType: "video",
    });

    return {
      chunk_id: `${extracted.docId}#v${String(segment.index).padStart(3, "0")}`,
      doc_id: extracted.docId,
      modality: "media",
      title: segment.title ?? extracted.title,
      section: where ? `segment ${where}` : null,
      page: null,
      start_time: segment.start,
      end_time: segment.end,
      external_url: segment.url,
      media_path: segment.sourcePath ?? null,
      text: segment.text,
      context_header: contextHeader,
      embedding_text: contextHeader ? `${contextHeader}\n${segment.text}` : segment.text,
    };
  });
}

/**
 * chunks a picture manifest: one chunk per image.
 *
 * what is indexed is a description of the picture, not the picture. that is a
 * real limitation and worth naming rather than implying the system can see --
 * but it is also what makes a chart findable at all. the 11.5 GB slide library
 * averages 412 characters of text per slide; the substance is in the figures,
 * and until they were captioned the index held only the remainder.
 */
export function chunkImages(extracted) {
  return extracted.images.map((image) => {
    const contextHeader = buildContextHeader({
      title: image.sourceDocument ?? extracted.title,
      section: image.title,
      authors: [],
      eventDate: null,
      sourceType: "image",
    });

    return {
      chunk_id: `${extracted.docId}#i${String(image.index).padStart(4, "0")}`,
      doc_id: extracted.docId,
      modality: "media",
      title: image.title || extracted.title,
      section: null,
      page: image.page ?? null,
      image_path: image.path,
      text: image.text,
      context_header: contextHeader,
      embedding_text: contextHeader ? `${contextHeader}\n${image.text}` : image.text,
      // says plainly that this text was generated from a picture rather than
      // read off a page, so a quote drawn from it can be framed honestly.
      derived_from_image: true,
    };
  });
}
