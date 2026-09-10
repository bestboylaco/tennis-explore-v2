import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blocksToPage } from "../../src/modules/ingestion/textractBlocks.js";

// ---------------------------------------------------------------------------
// fixture builders
//
// the fixtures are hand-written rather than captured from a real response on
// purpose. a captured response is 400 KB of noise around the six fields that
// matter, and it cannot express the cases we most need to pin down -- a cell
// the source left blank, a header spanning two columns, a CELL with no
// children. building the blocks by hand makes each of those one line.
// ---------------------------------------------------------------------------

let nextId = 0;

function id() {
  nextId += 1;
  return `b${nextId}`;
}

function word(text, confidence = 99) {
  return { Id: id(), BlockType: "WORD", Text: text, Confidence: confidence };
}

function line(text, confidence = 99) {
  return { Id: id(), BlockType: "LINE", Text: text, Confidence: confidence };
}

/**
 * builds a CELL plus the WORD blocks it owns.
 *
 * `text: null` means the source cell was blank -- the CELL block exists with no
 * CHILD relationship at all, which is exactly what Textract emits and exactly
 * the case a naive "push each cell onto the row" implementation gets wrong.
 */
function cell({ row, column, text, rowSpan = 1, columnSpan = 1, confidence = 99 }) {
  const words = text === null ? [] : String(text).split(" ").map((part) => word(part, confidence));

  const block = {
    Id: id(),
    BlockType: "CELL",
    RowIndex: row,
    ColumnIndex: column,
    RowSpan: rowSpan,
    ColumnSpan: columnSpan,
    Confidence: confidence,
    Relationships:
      words.length > 0 ? [{ Type: "CHILD", Ids: words.map((each) => each.Id) }] : undefined,
  };

  return { block, words };
}

function table(cells, { confidence = 99 } = {}) {
  const built = cells.map((spec) => cell(spec));

  const tableBlock = {
    Id: id(),
    BlockType: "TABLE",
    Confidence: confidence,
    Relationships: [{ Type: "CHILD", Ids: built.map((each) => each.block.Id) }],
  };

  return [tableBlock, ...built.map((each) => each.block), ...built.flatMap((each) => each.words)];
}

// ---------------------------------------------------------------------------

describe("blocksToPage -- page text", () => {
  it("joins LINE blocks in the order Textract returned them", () => {
    const blocks = [line("Table 2. Serve speed by round"), line("Values are mean (SD).")];

    const page = blocksToPage(blocks, 4);

    assert.equal(page.text, "Table 2. Serve speed by round\nValues are mean (SD).");
  });

  it("ignores WORD and CELL blocks when building page text", () => {
    // WORD blocks duplicate every LINE. counting them as text would double the
    // whole page and put each word on its own line.
    const blocks = [line("Round one"), word("Round"), word("one")];

    const page = blocksToPage(blocks, 1);

    assert.equal(page.text, "Round one");
  });
});

describe("blocksToPage -- grid positioning", () => {
  it("puts a value from row 3, column 2 at grid[2][1]", () => {
    // the single most important assertion in this file. the acceptance
    // condition is that row and column structure survives, and every other
    // guarantee here is downstream of this one.
    const blocks = table([
      { row: 1, column: 1, text: "Round" },
      { row: 1, column: 2, text: "Speed" },
      { row: 2, column: 1, text: "R1" },
      { row: 2, column: 2, text: "182" },
      { row: 3, column: 1, text: "R2" },
      { row: 3, column: 2, text: "191" },
    ]);

    const [found] = blocksToPage(blocks, 4).tables;

    assert.equal(found.grid[2][1], "191");
    assert.equal(found.rowCount, 3);
    assert.equal(found.columnCount, 2);
  });

  it("leaves a blank source cell empty instead of shifting the row left", () => {
    // the failure this exists to prevent: building rows with push() means a
    // missing cell pulls every later value one column to the left, and the
    // table still LOOKS fine -- it is just wrong from that point on.
    const blocks = table([
      { row: 1, column: 1, text: "Round" },
      { row: 1, column: 2, text: "Speed" },
      { row: 1, column: 3, text: "Aces" },
      { row: 2, column: 1, text: "R1" },
      { row: 2, column: 2, text: null },
      { row: 2, column: 3, text: "7" },
    ]);

    const [found] = blocksToPage(blocks, 4).tables;

    assert.deepEqual(found.grid[1], ["R1", "", "7"]);
  });

  it("joins the words of a multi-word cell with single spaces", () => {
    const blocks = table([{ row: 1, column: 1, text: "First serve won" }]);

    const [found] = blocksToPage(blocks, 1).tables;

    assert.equal(found.grid[0][0], "First serve won");
  });

  it("renders a checkbox cell as [X] or [ ]", () => {
    const selected = { Id: id(), BlockType: "SELECTION_ELEMENT", SelectionStatus: "SELECTED", Confidence: 98 };
    const cleared = { Id: id(), BlockType: "SELECTION_ELEMENT", SelectionStatus: "NOT_SELECTED", Confidence: 98 };

    const cellOne = {
      Id: id(),
      BlockType: "CELL",
      RowIndex: 1,
      ColumnIndex: 1,
      Confidence: 98,
      Relationships: [{ Type: "CHILD", Ids: [selected.Id] }],
    };
    const cellTwo = {
      Id: id(),
      BlockType: "CELL",
      RowIndex: 1,
      ColumnIndex: 2,
      Confidence: 98,
      Relationships: [{ Type: "CHILD", Ids: [cleared.Id] }],
    };
    const tableBlock = {
      Id: id(),
      BlockType: "TABLE",
      Confidence: 98,
      Relationships: [{ Type: "CHILD", Ids: [cellOne.Id, cellTwo.Id] }],
    };

    const [found] = blocksToPage([tableBlock, cellOne, cellTwo, selected, cleared], 1).tables;

    assert.deepEqual(found.grid[0], ["[X]", "[ ]"]);
  });
});

describe("blocksToPage -- merged cells", () => {
  it("repeats a merged header across every column it spans", () => {
    // a deliberate decision, pinned here so it cannot drift: flattening
    // "Serve speed" spanning columns 2-3 into column 2 alone leaves column 3
    // headed by nothing, and a reader of the serialised table cannot tell what
    // the third column holds. repeating it is redundant and readable.
    const blocks = table([
      { row: 1, column: 1, text: "Round" },
      { row: 1, column: 2, text: "Serve speed", columnSpan: 2 },
      { row: 2, column: 1, text: "R1" },
      { row: 2, column: 2, text: "182" },
      { row: 2, column: 3, text: "191" },
    ]);

    const [found] = blocksToPage(blocks, 4).tables;

    assert.equal(found.columnCount, 3);
    assert.deepEqual(found.grid[0], ["Round", "Serve speed", "Serve speed"]);
  });

  it("repeats a merged row label down every row it spans", () => {
    const blocks = table([
      { row: 1, column: 1, text: "Men", rowSpan: 2 },
      { row: 1, column: 2, text: "R1" },
      { row: 2, column: 2, text: "R2" },
    ]);

    const [found] = blocksToPage(blocks, 4).tables;

    assert.deepEqual(found.grid[0], ["Men", "R1"]);
    assert.deepEqual(found.grid[1], ["Men", "R2"]);
  });

  /**
   * builds the merged-header case, filing the MERGED_CELL id under whichever
   * relationship type the caller names.
   *
   * the two callers below are the whole point: the real API files merges under
   * their own MERGED_CELL relationship, and reading them from CHILD instead
   * finds nothing and leaves the spanned columns blank. the shape is the
   * difference between a correct table and a plausible wrong one, so both are
   * pinned rather than assumed.
   */
  function mergedHeaderBlocks(relationshipType) {
    const built = [
      { row: 1, column: 1, text: "Serve speed" },
      { row: 1, column: 2, text: null },
    ].map((spec) => cell(spec));

    const merged = {
      Id: id(),
      BlockType: "MERGED_CELL",
      RowIndex: 1,
      ColumnIndex: 1,
      RowSpan: 1,
      ColumnSpan: 2,
      Relationships: [{ Type: "CHILD", Ids: built.map((each) => each.block.Id) }],
    };

    const cellIds = built.map((each) => each.block.Id);

    const tableBlock = {
      Id: id(),
      BlockType: "TABLE",
      Relationships:
        relationshipType === "CHILD"
          ? [{ Type: "CHILD", Ids: [...cellIds, merged.Id] }]
          : [
              { Type: "CHILD", Ids: cellIds },
              { Type: "MERGED_CELL", Ids: [merged.Id] },
            ],
    };

    return [
      tableBlock,
      merged,
      ...built.map((each) => each.block),
      ...built.flatMap((each) => each.words),
    ];
  }

  it("applies a MERGED_CELL filed under the MERGED_CELL relationship", () => {
    // the shape Textract actually returns for a merged header: the individual
    // CELLs stay in the grid with span 1 and only ONE of them carries the text,
    // and a separate MERGED_CELL block -- referenced from its OWN relationship
    // type, not from CHILD -- records what was joined to what. reading only the
    // CELLs leaves the second column blank.
    const [found] = blocksToPage(mergedHeaderBlocks("MERGED_CELL"), 4).tables;

    assert.deepEqual(found.grid[0], ["Serve speed", "Serve speed"]);
  });

  it("also applies a MERGED_CELL filed under CHILD", () => {
    // tolerance, not the documented shape. the BlockType guard makes scanning
    // both relationships free, and a response that files merges the other way
    // should not silently lose them.
    const [found] = blocksToPage(mergedHeaderBlocks("CHILD"), 4).tables;

    assert.deepEqual(found.grid[0], ["Serve speed", "Serve speed"]);
  });

  it("keeps the original span on the cell record even though the grid repeats it", () => {
    // the grid is a rendering. the cell list is the source of truth, and the
    // checklist reviewer needs to know a value was written once, not twice.
    const blocks = table([{ row: 1, column: 1, text: "Serve speed", columnSpan: 2 }]);

    const [found] = blocksToPage(blocks, 4).tables;

    assert.equal(found.cells.length, 1);
    assert.equal(found.cells[0].columnSpan, 2);
    assert.equal(found.cells[0].row, 1);
    assert.equal(found.cells[0].column, 1);
  });
});

describe("blocksToPage -- table titles", () => {
  it("keeps a TABLE_TITLE as the table's caption", () => {
    // "Table 2. Serve speed by round" is the single most useful string for
    // finding this table again, and it is the one line a chunk header should
    // lead with. Textract hands it over as its own relationship type.
    const titleWord = word("Table");
    const titleWordTwo = word("2.");
    const titleBlock = {
      Id: id(),
      BlockType: "TABLE_TITLE",
      Relationships: [{ Type: "CHILD", Ids: [titleWord.Id, titleWordTwo.Id] }],
    };
    const built = cell({ row: 1, column: 1, text: "R1" });
    const tableBlock = {
      Id: id(),
      BlockType: "TABLE",
      Relationships: [
        { Type: "CHILD", Ids: [built.block.Id] },
        { Type: "TABLE_TITLE", Ids: [titleBlock.Id] },
      ],
    };

    const [found] = blocksToPage(
      [tableBlock, titleBlock, titleWord, titleWordTwo, built.block, ...built.words],
      4,
    ).tables;

    assert.equal(found.title, "Table 2.");
  });

  it("reports a null title when the table has no caption", () => {
    const blocks = table([{ row: 1, column: 1, text: "R1" }]);

    const [found] = blocksToPage(blocks, 4).tables;

    assert.equal(found.title, null);
  });
});

describe("blocksToPage -- page numbers", () => {
  it("stamps the caller's page number on every table", () => {
    // the whole point of plan B. one PNG per call means the response describes
    // a single image, so Textract has no idea which page of the document it
    // came from -- only the caller does.
    const blocks = table([{ row: 1, column: 1, text: "R1" }]);

    const [found] = blocksToPage(blocks, 7).tables;

    assert.equal(found.page, 7);
  });

  it("ignores the Page property on a block and trusts the caller instead", () => {
    // synchronous single-image responses carry Page: 1 on everything, or omit
    // it. believing it would file page 7's tables under page 1 and every
    // citation drawn from them would point at the wrong page.
    const blocks = table([{ row: 1, column: 1, text: "R1" }]).map((block) => ({ ...block, Page: 1 }));

    const [found] = blocksToPage(blocks, 7).tables;

    assert.equal(found.page, 7);
  });
});

describe("blocksToPage -- confidence", () => {
  it("keeps each cell's confidence so low ones can be checked first", () => {
    const blocks = table([
      { row: 1, column: 1, text: "R1", confidence: 99.4 },
      { row: 1, column: 2, text: "182", confidence: 61.2 },
    ]);

    const [found] = blocksToPage(blocks, 4).tables;
    const weakest = found.cells.find((each) => each.column === 2);

    assert.equal(weakest.confidence, 61.2);
  });

  it("takes a cell's confidence from its words, not the CELL block", () => {
    // the CELL block's own confidence says how sure Textract is that a cell
    // exists there, which is nearly always high. how sure it is of the TEXT is
    // on the words, and that is the number a reviewer needs.
    const badWord = word("l82", 44.5);
    const cellBlock = {
      Id: id(),
      BlockType: "CELL",
      RowIndex: 1,
      ColumnIndex: 1,
      Confidence: 99.9,
      Relationships: [{ Type: "CHILD", Ids: [badWord.Id] }],
    };
    const tableBlock = {
      Id: id(),
      BlockType: "TABLE",
      Relationships: [{ Type: "CHILD", Ids: [cellBlock.Id] }],
    };

    const [found] = blocksToPage([tableBlock, cellBlock, badWord], 1).tables;

    assert.equal(found.cells[0].confidence, 44.5);
  });
});

describe("blocksToPage -- degenerate input", () => {
  it("returns empty results for an empty block list", () => {
    assert.deepEqual(blocksToPage([], 1), { text: "", tables: [] });
  });

  it("survives a TABLE with no Relationships at all", () => {
    const tableBlock = { Id: id(), BlockType: "TABLE", Confidence: 90 };

    const page = blocksToPage([tableBlock], 1);

    assert.deepEqual(page.tables, []);
  });

  it("survives a CELL whose CHILD ids point at blocks that are not present", () => {
    // a dangling id must not throw. by the time this function runs we have
    // already paid for the page, and crashing here loses it along with every
    // other page in the document.
    const missingWord = word("kept");
    const brokenCell = {
      Id: id(),
      BlockType: "CELL",
      RowIndex: 1,
      ColumnIndex: 1,
      Relationships: [{ Type: "CHILD", Ids: ["missing-block-id"] }],
    };
    const goodCell = {
      Id: id(),
      BlockType: "CELL",
      RowIndex: 1,
      ColumnIndex: 2,
      Relationships: [{ Type: "CHILD", Ids: [missingWord.Id] }],
    };
    const tableBlock = {
      Id: id(),
      BlockType: "TABLE",
      Relationships: [{ Type: "CHILD", Ids: [brokenCell.Id, goodCell.Id] }],
    };

    const [found] = blocksToPage([tableBlock, brokenCell, goodCell, missingWord], 1).tables;

    // the unreadable cell is blank, the readable one beside it still arrives.
    assert.deepEqual(found.grid[0], ["", "kept"]);
  });

  it("drops a table whose cells are all empty", () => {
    // a ruled box around a figure is detected as a table with no text in it.
    // indexing it produces a chunk that says nothing and matches everything.
    const blocks = table([
      { row: 1, column: 1, text: null },
      { row: 1, column: 2, text: null },
    ]);

    assert.deepEqual(blocksToPage(blocks, 1).tables, []);
  });

  it("numbers tables within the page from 0 in the order they appear", () => {
    const blocks = [...table([{ row: 1, column: 1, text: "first" }]), ...table([{ row: 1, column: 1, text: "second" }])];

    const { tables } = blocksToPage(blocks, 3);

    assert.equal(tables.length, 2);
    assert.deepEqual(
      tables.map((each) => [each.index, each.grid[0][0]]),
      [
        [0, "first"],
        [1, "second"],
      ],
    );
  });
});
