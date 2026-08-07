import {
  DEFAULT_CHUNK_OPTIONS,
} from "./chunk.types.js";

/**
 * Normalises extracted text before chunking.
 *
 * @param {string} text
 * @returns {string}
 */
function normaliseText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits a Markdown-style document into sections while
 * retaining the relevant heading.
 *
 * @param {string} text
 * @returns {{sectionTitle: string|null, text: string}[]}
 */
function splitIntoSections(text) {
  const lines = normaliseText(text).split("\n");

  const sections = [];

  let currentTitle = null;
  let currentLines = [];

  function saveCurrentSection() {
    const sectionText = currentLines
      .join("\n")
      .trim();

    if (!sectionText) {
      return;
    }

    sections.push({
      sectionTitle: currentTitle,
      text: sectionText,
    });
  }

  for (const line of lines) {
    const headingMatch = line.match(
      /^\s{0,3}#{1,6}\s+(.+?)\s*$/
    );

    if (headingMatch) {
      saveCurrentSection();

      currentTitle = headingMatch[1].trim();
      currentLines = [];

      continue;
    }

    currentLines.push(line);
  }

  saveCurrentSection();

  if (sections.length === 0 && text.trim()) {
    sections.push({
      sectionTitle: null,
      text: normaliseText(text),
    });
  }

  return sections;
}

/**
 * Splits one section into chunks while preferring
 * paragraph boundaries.
 *
 * @param {string} text
 * @param {Object} options
 * @returns {string[]}
 */
function splitSectionText(text, options) {
  const {
    maxCharacters,
    overlapCharacters,
  } = options;

  const paragraphs = normaliseText(text)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks = [];
  let currentChunk = "";

  function saveCurrentChunk() {
    const cleanedChunk = currentChunk.trim();

    if (!cleanedChunk) {
      return;
    }

    chunks.push(cleanedChunk);
    currentChunk = "";
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      saveCurrentChunk();

      let start = 0;

      while (start < paragraph.length) {
        const end = Math.min(
          start + maxCharacters,
          paragraph.length
        );

        const piece = paragraph
          .slice(start, end)
          .trim();

        if (piece) {
          chunks.push(piece);
        }

        if (end >= paragraph.length) {
          break;
        }

        start = Math.max(
          end - overlapCharacters,
          start + 1
        );
      }

      continue;
    }

    const candidate = currentChunk
      ? `${currentChunk}\n\n${paragraph}`
      : paragraph;

    if (candidate.length <= maxCharacters) {
      currentChunk = candidate;
      continue;
    }

    saveCurrentChunk();
    currentChunk = paragraph;
  }

  saveCurrentChunk();

  return chunks;
}

/**
 * Default strategy for PDFs, reports, research papers,
 * transcripts and other extracted text documents.
 *
 * @param {string} text
 * @param {Object} [options]
 * @returns {{
 *   text: string,
 *   sectionTitle: string|null
 * }[]}
 */
export function chunkDocumentText(
  text,
  options = DEFAULT_CHUNK_OPTIONS
) {
  const sections = splitIntoSections(text);
  const results = [];

  for (const section of sections) {
    const sectionChunks = splitSectionText(
      section.text,
      options
    );

    for (const chunkText of sectionChunks) {
      results.push({
        text: chunkText,
        sectionTitle: section.sectionTitle,
      });
    }
  }

  return results;
}

/**
 * Selects a chunking strategy based on the source type.
 *
 * Initially all textual sources use the same reliable
 * section-aware strategy.
 *
 * @param {string} sourceType
 * @returns {Function}
 */
export function getChunkingStrategy(sourceType) {
  const strategies = {
    research_paper: chunkDocumentText,
    conference_transcript: chunkDocumentText,
    coach_interview: chunkDocumentText,
    match_report: chunkDocumentText,
    player_report: chunkDocumentText,
    internal_note: chunkDocumentText,
  };

  return strategies[sourceType] || chunkDocumentText;
}