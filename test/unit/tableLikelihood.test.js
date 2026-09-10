import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_THRESHOLD,
  looksLikeTable,
  tableLikelihood,
} from "../../src/modules/ingestion/tableLikelihood.js";

// ---------------------------------------------------------------------------
// this filter decides whether a page gets a page of the 100/month TABLES
// allowance spent on it. the two mistakes are not symmetric: a false positive
// wastes one page and shows up in the log, a false negative silently drops a
// table and nothing downstream can tell. so the assertions below are lopsided
// on purpose -- the prose cases assert "skipped", and every case with even a
// hint of tabular structure asserts "sent".
// ---------------------------------------------------------------------------

/** a LINE block with the geometry DetectDocumentText returns. */
function line(text, { left, top, width, height = 0.02 }) {
  return {
    BlockType: "LINE",
    Text: text,
    Geometry: { BoundingBox: { Left: left, Top: top, Width: width, Height: height } },
  };
}

/** a page of ordinary prose: one wide line per band, top to bottom. */
function prosePage(count = 20) {
  return Array.from({ length: count }, (_, index) =>
    line(`This is an ordinary sentence of running prose number ${index}.`, {
      left: 0.1,
      top: 0.1 + index * 0.03,
      width: 0.8,
    }),
  );
}

/** a grid: `rows` bands of `columns` short cells at repeating left edges. */
function tablePage(rows, columns, { numeric = true } = {}) {
  const blocks = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const text = numeric && row > 0 ? String(100 + row * 7 + column) : `Head${column}`;

      blocks.push(line(text, { left: 0.1 + column * 0.2, top: 0.1 + row * 0.04, width: 0.12 }));
    }
  }

  return blocks;
}

describe("tableLikelihood -- pages that should NOT spend a TABLES page", () => {
  it("scores a page of running prose near zero", () => {
    const found = tableLikelihood(prosePage());

    assert.equal(found.rowLikeBands, 0, "no band of prose should read as a row of cells");
    assert.ok(found.score < DEFAULT_THRESHOLD, `expected below ${DEFAULT_THRESHOLD}, got ${found.score}`);
    assert.equal(looksLikeTable(prosePage()), false);
  });

  it("does not mistake a two-column page layout for a table", () => {
    // the classic false positive: each band holds one wide line from the left
    // column and one from the right. they are consistent and they repeat, but
    // they are paragraphs, and paying for them on every page of every report
    // would empty the allowance on prose.
    const blocks = [];

    for (let row = 0; row < 15; row += 1) {
      blocks.push(line(`left column sentence ${row} running on`, { left: 0.08, top: 0.1 + row * 0.03, width: 0.38 }));
      blocks.push(line(`right column sentence ${row} running on`, { left: 0.54, top: 0.1 + row * 0.03, width: 0.38 }));
    }

    assert.equal(looksLikeTable(blocks), false);
  });

  it("scores an almost-empty page zero rather than guessing", () => {
    const found = tableLikelihood([line("Figure 1", { left: 0.4, top: 0.5, width: 0.2 })]);

    assert.equal(found.score, 0);
  });

  it("treats a response with no blocks as nothing to send", () => {
    assert.equal(tableLikelihood([]).score, 0);
    assert.equal(tableLikelihood(null).score, 0);
    assert.equal(tableLikelihood(undefined).score, 0);
  });

  it("ignores blocks with no geometry rather than throwing on them", () => {
    // DetectDocumentText always returns geometry, but a malformed or truncated
    // response must not crash a run that has already been paid for.
    const blocks = [
      { BlockType: "LINE", Text: "no geometry here" },
      { BlockType: "PAGE" },
      ...prosePage(8),
    ];

    assert.equal(looksLikeTable(blocks), false);
  });
});

describe("tableLikelihood -- pages that MUST spend a TABLES page", () => {
  it("sends an obvious numeric grid", () => {
    const found = tableLikelihood(tablePage(6, 4));

    assert.ok(found.rowLikeBands >= 4, `expected banded rows, got ${found.rowLikeBands}`);
    assert.ok(found.columns >= 3, `expected repeating columns, got ${found.columns}`);
    assert.equal(looksLikeTable(tablePage(6, 4)), true);
  });

  it("sends a two-column table, which a naive 3-cells-per-row rule would drop", () => {
    // "Metric | Value" is a real and common shape. requiring three cells per row
    // to call something a table loses exactly the tables this is protecting.
    assert.equal(looksLikeTable(tablePage(8, 2)), true);
  });

  it("sends a small table of only three rows", () => {
    assert.equal(looksLikeTable(tablePage(3, 3)), true);
  });

  it("sends a table of words, not just a table of numbers", () => {
    // the numeric share is the smallest of the three weights precisely so that
    // a table of round names or player names still qualifies.
    assert.equal(looksLikeTable(tablePage(6, 4, { numeric: false })), true);
  });

  it("sends a page that is mostly prose with one small table in it", () => {
    // the expensive case to get wrong: the table is a minority of the page, and
    // it is the only thing on the page worth extracting.
    const blocks = [...prosePage(12), ...tablePage(4, 3)];

    assert.equal(looksLikeTable(blocks), true);
  });

  it("scores a real grid far above the threshold, not marginally above it", () => {
    // a decision this close to a hard budget should not rest on rounding.
    assert.ok(tableLikelihood(tablePage(8, 4)).score > 0.5);
  });
});

describe("looksLikeTable -- the threshold", () => {
  it("is low enough that ambiguity resolves toward spending", () => {
    assert.ok(DEFAULT_THRESHOLD <= 0.2, "the threshold must stay biased toward sending");
  });

  it("accepts an explicit threshold so a run can be forced wider or narrower", () => {
    // a threshold of 0 sends everything, which is the escape hatch for a
    // document the filter should not be trusted on. derived from the page's own
    // score rather than hardcoded, because a clean grid scores exactly 1.0 and
    // there is no constant above it to compare against.
    const grid = tablePage(6, 4);
    const { score } = tableLikelihood(grid);

    assert.equal(looksLikeTable(prosePage(), { threshold: 0 }), true);
    assert.equal(looksLikeTable(grid, { threshold: score }), true, "the threshold is inclusive");
    assert.equal(looksLikeTable(grid, { threshold: score + 0.01 }), false);
  });

  it("reports the parts behind the score so a skip can be explained", () => {
    // a silent filter over a paid resource is not reviewable. the CLI prints
    // these, so they are part of the contract.
    const found = tableLikelihood(tablePage(6, 4));

    assert.ok(Number.isFinite(found.score));
    assert.ok(Number.isInteger(found.lines));
    assert.ok(Number.isInteger(found.rowLikeBands));
    assert.ok(Number.isInteger(found.columns));
    assert.ok(found.numericRatio >= 0 && found.numericRatio <= 1);
  });
});
