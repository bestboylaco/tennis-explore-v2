// decides whether a page is worth a TABLES page of the monthly budget.
//
// this exists so DetectDocumentText can stand in front of AnalyzeDocument.
// detection bills a separate, far larger allowance (1,000 pages a month against
// TABLES' 100, and roughly a tenth the price beyond it), so a page can be read
// cheaply first and only escalated to table analysis when there is actually a
// table on it. a twelve-page scan with three table pages then costs three pages
// of the scarce allowance instead of twelve.
//
// the asymmetry of the two mistakes is the whole design:
//
//   a false positive  spends one page of budget on a page of prose. annoying,
//                     visible in the log, and self-correcting next run.
//
//   a false negative  silently drops a real table. nothing downstream can tell
//                     the difference between "this page had no table" and "we
//                     never looked", and the numbers just quietly are not in
//                     the index.
//
// so the threshold is deliberately low and every ambiguous signal is resolved
// toward sending. this is not a table DETECTOR -- Textract is the detector.
// it is a cheap filter that only has to be right about the obvious no's.
//
// pure: no network, no filesystem, no clock. it reads the LINE blocks a
// DetectDocumentText response already contains and returns a number.

/**
 * pages scoring below this go no further than detection.
 *
 * set low on purpose. see the asymmetry above -- at 0.15 a page needs to look
 * almost nothing like a table to be skipped, and the scoring below gives a page
 * with even two consistent short-celled rows roughly 0.5.
 */
export const DEFAULT_THRESHOLD = 0.15;

/** a page with almost nothing on it cannot be judged, so it is not judged. */
const MIN_LINES = 6;

/** two lines are on the same row if their vertical centres are this close. */
const BAND_TOLERANCE = 0.6;

/** left edges within this fraction of the page width are the same column. */
const COLUMN_TOLERANCE = 0.025;

/** a "cell" is short. a line wider than this is prose, not a table cell. */
const CELL_MAX_WIDTH = 0.35;

const clamp = (value) => Math.max(0, Math.min(1, value));

function linesWithGeometry(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.BlockType === "LINE" && block?.Geometry?.BoundingBox)
    .map((block) => ({
      text: String(block.Text ?? ""),
      left: block.Geometry.BoundingBox.Left ?? 0,
      top: block.Geometry.BoundingBox.Top ?? 0,
      width: block.Geometry.BoundingBox.Width ?? 0,
      height: block.Geometry.BoundingBox.Height ?? 0,
    }));
}

/**
 * groups lines into horizontal bands -- the candidate rows.
 *
 * banding by vertical centre rather than by Top, because cells in one row are
 * often set at slightly different heights and a taller heading cell would
 * otherwise land in a band of its own.
 */
function toBands(lines) {
  const sorted = [...lines].sort((a, b) => a.top + a.height / 2 - (b.top + b.height / 2));
  const medianHeight = median(sorted.map((line) => line.height)) || 0.01;
  const tolerance = medianHeight * BAND_TOLERANCE;

  const bands = [];

  for (const line of sorted) {
    const centre = line.top + line.height / 2;
    const band = bands.at(-1);

    if (band && Math.abs(centre - band.centre) <= tolerance) {
      band.lines.push(line);
      // a running mean, so a band does not drift away from the line that opened it
      band.centre = band.lines.reduce((sum, each) => sum + each.top + each.height / 2, 0) / band.lines.length;
      continue;
    }

    bands.push({ centre, lines: [line] });
  }

  return bands;
}

function median(values) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * whether a band reads as a row of cells rather than a line of prose.
 *
 * three or more separate runs of text on one line is already unusual enough in
 * prose to count. two is only accepted when both are SHORT -- otherwise a
 * two-column page layout, where each band holds one wide line from each column,
 * would score as a table on every page of a report. a two-column table like
 * "Metric | Value" is a real and common shape, so refusing to count two would
 * lose exactly the kind of table this is meant to protect.
 */
function isRowLike(band) {
  if (band.lines.length >= 3) return true;

  return band.lines.length === 2 && band.lines.every((line) => line.width < CELL_MAX_WIDTH);
}

/** how many left edges recur down the page -- a column is a repeated x. */
function countConsistentColumns(rowLike) {
  const edges = rowLike.flatMap((band) => band.lines.map((line) => line.left)).sort((a, b) => a - b);

  const clusters = [];

  for (const edge of edges) {
    const last = clusters.at(-1);

    if (last && edge - last.at(-1) <= COLUMN_TOLERANCE) last.push(edge);
    else clusters.push([edge]);
  }

  // a column has to appear on at least two rows to be a column rather than a
  // one-off indent.
  return clusters.filter((cluster) => cluster.length >= 2).length;
}

const NUMERIC = /^[-+(]?\$?\d[\d,.']*\s*%?\)?$/;

/** the share of tokens in the candidate rows that are numbers. */
function numericRatio(rowLike) {
  const tokens = rowLike.flatMap((band) => band.lines.flatMap((line) => line.text.split(/\s+/))).filter(Boolean);

  if (tokens.length === 0) return 0;

  return tokens.filter((token) => NUMERIC.test(token)).length / tokens.length;
}

/**
 * scores how much a page looks like it holds a table.
 *
 * @returns { score, lines, rowLikeBands, columns, numericRatio } -- the parts
 *          are returned alongside the score so the CLI can say WHY a page was
 *          skipped. a silent filter over a paid resource is not reviewable.
 */
export function tableLikelihood(blocks) {
  const lines = linesWithGeometry(blocks);

  if (lines.length < MIN_LINES) {
    return { score: 0, lines: lines.length, rowLikeBands: 0, columns: 0, numericRatio: 0 };
  }

  const rowLike = toBands(lines).filter(isRowLike);
  const columns = countConsistentColumns(rowLike);
  const numeric = numericRatio(rowLike);

  // four banded rows is already a table; three columns is already a table. the
  // numeric share only ever adds -- a table of words is still a table, so it
  // carries the smallest weight of the three.
  const rowScore = clamp(rowLike.length / 4);
  const columnScore = clamp((columns - 1) / 2);
  const numericScore = clamp(numeric / 0.3);

  return {
    score: 0.45 * rowScore + 0.35 * columnScore + 0.2 * numericScore,
    lines: lines.length,
    rowLikeBands: rowLike.length,
    columns,
    numericRatio: numeric,
  };
}

/** the decision itself: is this page worth a page of the TABLES allowance. */
export function looksLikeTable(blocks, { threshold = DEFAULT_THRESHOLD } = {}) {
  return tableLikelihood(blocks).score >= threshold;
}
