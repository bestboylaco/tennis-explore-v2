// turns one Textract response into page text and table grids (TENISE-12 / E2-06).
//
// this is the only part of the Textract story that can be wrong in a way nobody
// notices. a failed API call is loud; a table whose third column quietly holds
// the fourth column's numbers looks completely normal and is read as fact. so
// all the correctness risk is concentrated here, in a pure function with no
// network and no filesystem, and pinned by test/unit/textractBlocks.test.js.
//
// Textract does not return a table. it returns a flat list of blocks that
// reference each other by id:
//
//   TABLE ──CHILD──> CELL ──CHILD──> WORD
//         └─CHILD──> MERGED_CELL ──CHILD──> CELL
//         └─TABLE_TITLE──> TABLE_TITLE ──CHILD──> WORD
//
// rebuilding the grid means following those edges and, crucially, placing each
// cell at the coordinates it declares rather than in the order it arrived.

/**
 * cells below this are worth a human's attention first.
 *
 * not a rejection threshold -- a low-confidence cell is still the best reading
 * available and dropping it would leave a hole. it only decides what the
 * checklist puts at the top of the page for review.
 */
export const LOW_CONFIDENCE = 90;

/**
 * pulls the ids on one relationship type off a block.
 *
 * every access into a Textract response goes through here because the optional
 * fields really are optional: a TABLE detected around a figure has no CHILD at
 * all, and reaching into `.Relationships[0].Ids` on one of those throws in the
 * middle of a document we have already paid to process.
 */
function relatedIds(block, type) {
  const relationships = Array.isArray(block?.Relationships) ? block.Relationships : [];

  return relationships.filter((each) => each?.Type === type).flatMap((each) => each.Ids ?? []);
}

/**
 * reads the text out of a block's children.
 *
 * WORD is the ordinary case. SELECTION_ELEMENT is a checkbox, which has no text
 * at all -- rendered as [X] or [ ] so a tick survives into the indexed text
 * instead of becoming a blank cell that reads as "no data".
 */
function childText(block, byId) {
  const parts = [];
  const confidences = [];

  for (const childId of relatedIds(block, "CHILD")) {
    const child = byId.get(childId);

    // an id pointing at a block that is not in the response. should not happen,
    // but the alternative to checking is a crash on a paid-for page.
    if (!child) continue;

    if (child.BlockType === "WORD") {
      const text = String(child.Text ?? "").trim();

      if (text === "") continue;

      parts.push(text);
      if (typeof child.Confidence === "number") confidences.push(child.Confidence);
      continue;
    }

    if (child.BlockType === "SELECTION_ELEMENT") {
      parts.push(child.SelectionStatus === "SELECTED" ? "[X]" : "[ ]");
      if (typeof child.Confidence === "number") confidences.push(child.Confidence);
    }
  }

  return {
    text: parts.join(" "),
    // the weakest word, not the average. one misread digit is enough to make a
    // cell wrong, and averaging it against four confident words hides it.
    confidence: confidences.length > 0 ? Math.min(...confidences) : null,
  };
}

/**
 * flattens one TABLE block into a rectangular grid.
 *
 * two decisions worth stating plainly, because both are visible in the output
 * and both would look like bugs to someone who did not know they were chosen:
 *
 *  1. the grid is allocated at its full size and filled by coordinate. it is
 *     never built by appending. Textract omits nothing -- it emits a CELL for a
 *     blank cell too -- but it does not promise an order, and appending would
 *     turn a single missing cell into every later value in that row sitting one
 *     column to the left. that is the failure mode this whole function is
 *     shaped to avoid.
 *
 *  2. a merged cell's value is REPEATED into every position it spans. a header
 *     reading "Serve speed" across columns 2 and 3 is written into both. the
 *     alternative leaves column 3 headed by an empty string, and a reader of
 *     the serialised table -- or the embedding model -- cannot tell what that
 *     column holds. the unrepeated truth is kept on `cells`, so nothing is
 *     lost; only the flat rendering is redundant.
 */
function buildTable(tableBlock, byId, { page, index }) {
  const cellBlocks = relatedIds(tableBlock, "CHILD")
    .map((cellId) => byId.get(cellId))
    .filter((block) => block?.BlockType === "CELL");

  if (cellBlocks.length === 0) return null;

  const cells = cellBlocks.map((block) => {
    const { text, confidence } = childText(block, byId);

    return {
      row: block.RowIndex ?? 1,
      column: block.ColumnIndex ?? 1,
      rowSpan: block.RowSpan ?? 1,
      columnSpan: block.ColumnSpan ?? 1,
      text,
      confidence,
    };
  });

  // MERGED_CELL is the shape Textract actually uses for most merges: the
  // underlying CELLs keep span 1 and only one of them carries the text, with a
  // separate block recording what was joined. reading the CELLs alone leaves
  // the rest of the merge blank, so the span is copied onto the cell that has
  // the text. cells already carrying their own span are unaffected.
  //
  // the ids live under a relationship of their OWN type -- the API's valid
  // types are VALUE | CHILD | COMPLEX_FEATURES | MERGED_CELL | TITLE | ANSWER |
  // TABLE | TABLE_TITLE | TABLE_FOOTER, and a TABLE's CHILD carries only plain
  // CELLs. looking for merges under CHILD finds nothing on a real response and
  // leaves every merged header blank in the columns it spans, which is exactly
  // the silently-plausible wrong answer this file exists to prevent. CHILD is
  // still scanned as well: the BlockType guard below makes the union free, and
  // it costs nothing to tolerate a response that files them the other way.
  const mergedIds = new Set([
    ...relatedIds(tableBlock, "MERGED_CELL"),
    ...relatedIds(tableBlock, "CHILD"),
  ]);

  for (const mergedId of mergedIds) {
    const merged = byId.get(mergedId);

    if (merged?.BlockType !== "MERGED_CELL") continue;

    const covered = relatedIds(merged, "CHILD")
      .map((cellId) => byId.get(cellId))
      .filter(Boolean);

    // the one cell in the merge that actually holds text. if none of them do,
    // the merge is empty and there is nothing to spread.
    const source = covered.find((block) => {
      const position = cells.find(
        (each) => each.row === (block.RowIndex ?? 1) && each.column === (block.ColumnIndex ?? 1),
      );

      return position && position.text !== "";
    });

    if (!source) continue;

    const carrier = cells.find(
      (each) => each.row === (source.RowIndex ?? 1) && each.column === (source.ColumnIndex ?? 1),
    );

    carrier.row = merged.RowIndex ?? carrier.row;
    carrier.column = merged.ColumnIndex ?? carrier.column;
    carrier.rowSpan = Math.max(carrier.rowSpan, merged.RowSpan ?? 1);
    carrier.columnSpan = Math.max(carrier.columnSpan, merged.ColumnSpan ?? 1);
  }

  // sized from where the cells say they end, spans included -- a table whose
  // last column exists only as the right half of a merged header is still that
  // many columns wide.
  const rowCount = Math.max(...cells.map((each) => each.row + each.rowSpan - 1));
  const columnCount = Math.max(...cells.map((each) => each.column + each.columnSpan - 1));

  const grid = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));

  for (const each of cells) {
    if (each.text === "") continue;

    for (let row = each.row; row < each.row + each.rowSpan; row += 1) {
      for (let column = each.column; column < each.column + each.columnSpan; column += 1) {
        // Textract indexes from 1, javascript from 0. the single -1 on each
        // axis is the entire translation, and getting it wrong is the other way
        // this function could silently produce a plausible wrong answer.
        const target = grid[row - 1]?.[column - 1];

        if (target === undefined) continue;

        grid[row - 1][column - 1] = each.text;
      }
    }
  }

  // a ruled box drawn around a figure is detected as a table with no text in
  // it. indexing that produces a chunk which says nothing and matches
  // everything, which is worse than not indexing it.
  if (cells.every((each) => each.text === "")) return null;

  const [titleId] = relatedIds(tableBlock, "TABLE_TITLE");
  const titleBlock = titleId ? byId.get(titleId) : null;
  const title = titleBlock ? childText(titleBlock, byId).text : "";

  return {
    // stamped from the argument. see blocksToPage for why the block's own Page
    // property is not to be trusted here.
    page,
    index,
    title: title === "" ? null : title,
    rowCount,
    columnCount,
    grid,
    cells,
    lowConfidenceCells: cells.filter(
      (each) => each.text !== "" && each.confidence !== null && each.confidence < LOW_CONFIDENCE,
    ).length,
    confidence: typeof tableBlock.Confidence === "number" ? tableBlock.Confidence : null,
  };
}

/**
 * turns one page's Textract blocks into its text and its tables.
 *
 * `pageNumber` is not optional and is not a hint. under the synchronous
 * AnalyzeDocument API we send one rendered PNG per call, so the response
 * describes a single image and its blocks either carry `Page: 1` or carry no
 * Page at all -- regardless of which page of the document the image came from.
 * only the caller knows the real page number, so the caller supplies it and
 * this function never reads `block.Page`. believing the block would file page
 * seven's tables under page one and point every citation drawn from them at the
 * wrong page.
 */
export function blocksToPage(blocks, pageNumber) {
  const list = Array.isArray(blocks) ? blocks : [];
  const byId = new Map(list.filter((block) => block?.Id).map((block) => [block.Id, block]));

  // block order is Textract's reading order, which is what we want -- sorting
  // by geometry would reorder a two-column page into nonsense.
  const text = list
    .filter((block) => block?.BlockType === "LINE")
    .map((block) => String(block.Text ?? "").trim())
    .filter((line) => line !== "")
    .join("\n");

  const tables = [];

  for (const block of list) {
    if (block?.BlockType !== "TABLE") continue;

    const built = buildTable(block, byId, { page: pageNumber, index: tables.length });

    if (built) tables.push(built);
  }

  return { text, tables };
}

/**
 * renders a grid as a markdown pipe table.
 *
 * pipe format rather than the whitespace alignment pdftotext -layout produces,
 * because the chunker collapses runs of whitespace and alignment would not
 * survive the trip. a pipe is a character, and characters survive.
 */
export function tableRowToText(cells) {
  const escape = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

  return `| ${cells.map(escape).join(" | ")} |`;
}

export function tableToText(table) {
  const [header, ...body] = table.grid;

  if (!header) return "";

  return [
    tableRowToText(header),
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((cells) => tableRowToText(cells)),
  ].join("\n");
}
