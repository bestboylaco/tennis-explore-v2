/**
 * Enriches the pipeline with structural metadata.
 *
 * @param {import("./pipeline.types.js").IngestionPipeline} pipeline
 * @returns {import("./pipeline.types.js").IngestionPipeline}
 */
export function enrichStructuralMetadata(pipeline) {
  if (!pipeline?.document?.text) {
    throw new Error(
      "Document text is required before structural metadata."
    );
  }

  const text = pipeline.document.text;

  const lines = text.split(/\r?\n/);

  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const headings = detectHeadings(lines);

  pipeline.document.structuralMetadata = {
    headingCount: headings.length,

    headings,

    paragraphCount: paragraphs.length,

    sectionCount: headings.length,

    blankLineCount: lines.filter(
      (line) => line.trim() === ""
    ).length,

    bulletListCount: lines.filter(
      (line) => /^\s*[-*•]\s+/.test(line)
    ).length,

    numberedListCount: lines.filter(
      (line) => /^\s*\d+[.)]\s+/.test(line)
    ).length,
  };

  return pipeline;
}

/**
 * Detects Markdown headings such as:
 *
 * # Match Report
 * ## Serving
 * ### Pressure Situations
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function detectHeadings(lines) {
  return lines
    .map((line) => line.match(
      /^\s{0,3}#{1,6}\s+(.+?)\s*$/
    ))
    .filter(Boolean)
    .map((match) => match[1].trim());
}