import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunkTables } from "../../src/modules/ingestion/chunking.service.js";
import { enforceSchema } from "../../src/modules/ingestion/metadata.service.js";
import { NO_PROGRAM, grantsForDocument } from "../../src/shared/constants/accessControl.js";

function table({ page = 4, index = 0, grid, title = null }) {
  return {
    page,
    index,
    title,
    rowCount: grid.length,
    columnCount: grid[0]?.length ?? 0,
    grid,
    cells: [],
    lowConfidenceCells: 0,
  };
}

function extracted(tables, overrides = {}) {
  return {
    docId: "serve-speed-study",
    title: "Serve speed across tournament rounds",
    sourceType: "research_paper",
    pages: [],
    tables,
    ...overrides,
  };
}

const SAMPLE = [
  ["Round", "Speed", "Aces"],
  ["R1", "182", "7"],
  ["R2", "191", "11"],
];

describe("chunkTables -- structure survives", () => {
  it("keeps every row on its own line", () => {
    // the failure this exists to prevent: splitText() collapses runs of
    // whitespace and then hard-cuts by character count, so a table routed
    // through it arrives as one flat line of numbers with no way to tell which
    // column any of them belonged to.
    const [chunk] = chunkTables(extracted([table({ grid: SAMPLE })]));

    const rows = chunk.text.split("\n").filter((line) => line.startsWith("|"));

    // three data rows plus the markdown separator row.
    assert.equal(rows.length, 4);
  });

  it("keeps a value in the same column it started in", () => {
    // the acceptance condition, checked on the serialised form rather than on
    // the grid -- getting the grid right and then flattening it wrongly would
    // pass every test in textractBlocks and still ship a broken table.
    const [chunk] = chunkTables(extracted([table({ grid: SAMPLE })]));

    const lines = chunk.text.split("\n").filter((line) => line.startsWith("|"));
    const cells = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim());

    assert.deepEqual(cells(lines[0]), ["Round", "Speed", "Aces"]);
    // lines[1] is the markdown separator.
    assert.deepEqual(cells(lines[3]), ["R2", "191", "11"]);
  });

  it("escapes a pipe inside a cell so it cannot forge a column", () => {
    const grid = [
      ["Round", "Notes"],
      ["R1", "won | retired"],
    ];

    const [chunk] = chunkTables(extracted([table({ grid })]));
    const row = chunk.text.split("\n").find((line) => line.startsWith("| R1"));

    // split on UNESCAPED pipes only -- an escaped one is content, not a column
    // boundary, and counting it as one is exactly the confusion the escape
    // exists to prevent.
    const cells = row.split(/(?<!\\)\|/).slice(1, -1);

    assert.deepEqual(
      cells.map((cell) => cell.trim()),
      ["R1", "won \\| retired"],
    );
  });

  it("names the table and its page in the first line", () => {
    // a chunk that opens with a bare grid of numbers is unreadable in a
    // citation and nearly unretrievable. the caption is what a coach searches.
    const [chunk] = chunkTables(extracted([table({ grid: SAMPLE, page: 4, index: 1 })]));

    assert.match(chunk.text.split("\n")[0], /^Table 2 \(page 4\)/);
    assert.match(chunk.text.split("\n")[0], /Serve speed across tournament rounds/);
  });

  it("prefers the caption Textract read off the page over a generated one", () => {
    const withTitle = table({ grid: SAMPLE, title: "Table 3. Mean serve speed by round" });

    const [chunk] = chunkTables(extracted([withTitle]));

    assert.match(chunk.text.split("\n")[0], /Table 3\. Mean serve speed by round/);
  });
});

describe("chunkTables -- chunk identity and metadata", () => {
  it("gives each table a page-and-index chunk id", () => {
    const chunks = chunkTables(
      extracted([
        table({ grid: SAMPLE, page: 4, index: 0 }),
        table({ grid: SAMPLE, page: 4, index: 1 }),
      ]),
    );

    assert.deepEqual(
      chunks.map((chunk) => chunk.chunk_id),
      ["serve-speed-study#t0004_0", "serve-speed-study#t0004_1"],
    );
  });

  it("uses modality 'document', not 'table'", () => {
    // "table" is not in MODALITIES, so it would fail enforceSchema and the
    // chunk would be dropped. adding it there is backwards compatible in
    // itself, but SCHEMA_VERSION is part of the build fingerprint -- bumping it
    // declares the existing 99,496-chunk index invalid and forces a multi-hour
    // full rebuild. section:"table" carries the same information for free.
    const [chunk] = chunkTables(extracted([table({ grid: SAMPLE })]));

    assert.equal(chunk.modality, "document");
    assert.equal(chunk.section, "table");
  });

  it("carries the page number through for citation", () => {
    const [chunk] = chunkTables(extracted([table({ grid: SAMPLE, page: 7 })]));

    assert.equal(chunk.page, 7);
  });

  it("builds an embedding text with the contextual header in front", () => {
    const [chunk] = chunkTables(extracted([table({ grid: SAMPLE })]), { authors: ["M. Reid"] });

    assert.ok(chunk.context_header.includes("Serve speed across tournament rounds"));
    assert.equal(chunk.embedding_text, `${chunk.context_header}\n${chunk.text}`);
  });

  it("produces chunks that pass the schema gate once classified", () => {
    // the real test of the modality decision. if this fails, every table chunk
    // is silently dropped at build time and the story delivers nothing.
    const [chunk] = chunkTables(extracted([table({ grid: SAMPLE })]));

    // exactly what classifyDocument returns for a research paper, which is what
    // these scanned PDFs are classified as.
    const classification = { domain: "research", sensitivity: "public", program: NO_PROGRAM };

    const { valid, problems } = enforceSchema(
      {
        ...chunk,
        source_type: "research_paper",
        authors: [],
        event_date: null,
        ingested_at: new Date().toISOString(),
        content_hash: "abcd1234",
        data_domain: classification.domain,
        sensitivity: classification.sensitivity,
        program: classification.program,
        acl_groups: grantsForDocument(classification),
      },
      { strict: false },
    );

    assert.deepEqual(problems, []);
    assert.equal(valid, true);
  });
});

describe("chunkTables -- oversized tables", () => {
  const wideGrid = [
    ["Player", "Round", "Speed", "Aces", "Double faults"],
    ...Array.from({ length: 200 }, (_, row) => [
      `Player number ${row}`,
      `Round ${row % 7}`,
      String(180 + (row % 30)),
      String(row % 15),
      String(row % 6),
    ]),
  ];

  it("splits a table too long for one chunk", () => {
    const chunks = chunkTables(extracted([table({ grid: wideGrid })]));

    assert.ok(chunks.length > 1, `expected the table to be split, got ${chunks.length} chunk(s)`);
  });

  it("repeats the header row in every part", () => {
    // a middle slice of a table with no header is a wall of numbers whose
    // columns mean nothing -- to a reader or to the embedding model.
    const chunks = chunkTables(extracted([table({ grid: wideGrid })]));

    for (const chunk of chunks) {
      assert.match(chunk.text, /\| Player \| Round \| Speed \| Aces \| Double faults \|/);
    }
  });

  it("gives each part its own chunk id", () => {
    const chunks = chunkTables(extracted([table({ grid: wideGrid })]));
    const ids = chunks.map((chunk) => chunk.chunk_id);

    assert.equal(new Set(ids).size, ids.length);
  });

  it("says which part of the table each chunk is", () => {
    const chunks = chunkTables(extracted([table({ grid: wideGrid })]));

    assert.match(chunks[0].text.split("\n")[0], /part 1 of \d+/);
  });

  it("puts every data row in exactly one part", () => {
    // nothing lost at the seams and nothing duplicated -- the split has to be a
    // partition, or a total read off the table will not match its rows.
    const chunks = chunkTables(extracted([table({ grid: wideGrid })]));

    const dataRows = chunks.flatMap((chunk) =>
      chunk.text
        .split("\n")
        .filter((line) => line.startsWith("| Player number ")),
    );

    assert.equal(dataRows.length, 200);
    assert.equal(new Set(dataRows).size, 200);
  });
});

describe("chunkTables -- nothing to do", () => {
  it("returns nothing when the document has no tables", () => {
    assert.deepEqual(chunkTables(extracted([])), []);
    assert.deepEqual(chunkTables(extracted(undefined)), []);
  });

  it("skips a table with no rows", () => {
    assert.deepEqual(chunkTables(extracted([table({ grid: [] })])), []);
  });
});
