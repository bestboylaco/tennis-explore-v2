// E2-07: the per-file-type chunking settings, and the one packing rule that
// makes record chunking a decision instead of an assumption.
//
// why so much of this runs in child processes: `retrievalConfig` is built from
// the environment and Object.freeze'd the first time it is imported, and
// chunking.service.js imports it by a plain specifier, so a cache-busting query
// string on a re-import gets the ALREADY CACHED config. there is no way to see a
// second value of CHUNK_ROWS_PER_CHUNK inside one process. a child process per
// setting is the same reason bin/eval.js spawns bin/eval-run.js, and it is also
// the only way to observe a config that throws at import time.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

import { splitText, verbaliseRow } from "../../src/modules/ingestion/chunking.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");

const CHUNKING = pathToFileURL(
  path.join(projectRoot, "src/modules/ingestion/chunking.service.js"),
).href;
const CONFIG = pathToFileURL(path.join(projectRoot, "src/config/retrieval.config.js")).href;

// a working directory with no .env in it. retrieval.config.js calls
// dotenv.config(), which reads .env RELATIVE TO THE CWD -- so running the child
// anywhere but the project root is what actually isolates it from whatever the
// developer happens to have configured. every import below is an absolute file
// URL, so the cwd costs nothing.
const sandboxCwd = fs.mkdtempSync(path.join(os.tmpdir(), "chunking-config-test-"));

after(() => {
  fs.rmSync(sandboxCwd, { recursive: true, force: true });
});

// dotenvx writes a banner to stdout on load, so the payload is fenced rather
// than assumed to be the whole of it.
const MARK = "<<<RESULT>>>";

/**
 * runs an ES module snippet in a fresh process with a pinned environment and
 * returns whatever it printed between the markers.
 *
 * the environment is pinned rather than extended: a developer's .env sets
 * CHUNK_* values of its own, and inheriting them would make this test pass or
 * fail depending on whose machine it runs on. PORT and MONGODB_URI are supplied
 * because env.js validates them eagerly at import and CI has no .env -- same
 * reason and same fix as test/unit/indexAppend.test.js.
 */
function runInChild(code, env = {}) {
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", code.replaceAll("__MARK__", MARK)],
    {
      cwd: sandboxCwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PORT: "3000",
        MONGODB_URI: "mongodb://unused-in-this-test/db",
        EMBEDDING_PROVIDER: "hash",
        CONTEXTUAL_ENABLED: "true",
        CONTEXTUAL_MODE: "template",
        CHUNK_TARGET_CHARS: "1600",
        CHUNK_OVERLAP_CHARS: "200",
        CHUNK_MIN_CHARS: "120",
        ...env,
      },
    },
  );

  const parts = output.split(MARK);

  assert.equal(parts.length, 3, `child printed no fenced result:\n${output}`);

  return parts[1];
}

// ---------------------------------------------------------------------------
// config validation
// ---------------------------------------------------------------------------

describe("chunking config -- rowsPerChunk validation", () => {
  /** the value the config ends up with, or the word "threw". */
  function loadRowsPerChunk(raw) {
    const code =
      `import("${CONFIG}")` +
      `.then((m) => String(m.retrievalConfig.chunking.rowsPerChunk))` +
      `.catch(() => "threw")` +
      `.then((r) => process.stdout.write("__MARK__" + r + "__MARK__"));`;

    return runInChild(code, raw === undefined ? {} : { CHUNK_ROWS_PER_CHUNK: raw });
  }

  // `num()` only falls back when the parsed value is NaN, so before this change
  // every one of these passed straight through. they are not tuning mistakes,
  // they are broken indexes: 0 produces no chunks at all, a negative loops
  // forever, and 2.5 silently drops part of every group out of the corpus.
  for (const bad of ["0", "-1", "-3", "2.5"]) {
    it(`refuses CHUNK_ROWS_PER_CHUNK=${bad}`, () => {
      assert.equal(loadRowsPerChunk(bad), "threw");
    });
  }

  it("accepts 1 and 5", () => {
    assert.equal(loadRowsPerChunk("1"), "1");
    assert.equal(loadRowsPerChunk("5"), "5");
  });

  it("defaults to 1 when unset, which is the behaviour it replaced", () => {
    assert.equal(loadRowsPerChunk(undefined), "1");
  });

  it("carries the defaults that used to be literals in chunking.service.js", () => {
    const code =
      `import("${CONFIG}").then((m) => process.stdout.write(` +
      `"__MARK__" + JSON.stringify(m.retrievalConfig.chunking) + "__MARK__"));`;

    assert.deepEqual(JSON.parse(runInChild(code)), {
      targetChars: 1600,
      overlapChars: 200,
      minChars: 120,
      rowsPerChunk: 1,
      recordMaxChars: 1400,
      fallbackMinChars: 40,
      slideMinChars: 40,
      tableHeadroomChars: 32,
    });
  });
});

// ---------------------------------------------------------------------------
// splitText invariants
//
// these need no child process at all: splitText takes its parameters as an
// argument rather than reading the config, which is exactly why it is reusable
// across the evaluation's cells without touching the environment.
// ---------------------------------------------------------------------------

const PROSE = "The serve is the only stroke a player has complete control over. "
  + "Ball toss consistency separates reliable servers from erratic ones. "
  + "Trunk rotation contributes measurably to racquet head speed at contact. "
  + "Leg drive generates the vertical component of the kinetic chain. ";

const LONG_PROSE = Array.from({ length: 40 }, (_, i) => `${PROSE}Paragraph ${i} ends here.`).join(
  "\n\n",
);

describe("splitText -- the invariants span matching depends on", () => {
  for (const params of [
    { targetChars: 1600, overlapChars: 200, minChars: 120 },
    { targetChars: 800, overlapChars: 200, minChars: 120 },
    { targetChars: 1600, overlapChars: 0, minChars: 120 },
  ]) {
    const name = `t${params.targetChars}-o${params.overlapChars}`;

    it(`${name}: every piece is at least minChars`, () => {
      for (const piece of splitText(LONG_PROSE, params)) {
        assert.ok(piece.length >= params.minChars, `piece of ${piece.length} chars`);
      }
    });

    it(`${name}: no piece exceeds targetChars + overlapChars`, () => {
      for (const piece of splitText(LONG_PROSE, params)) {
        assert.ok(
          piece.length <= params.targetChars + params.overlapChars,
          `piece of ${piece.length} chars exceeds the budget`,
        );
      }
    });
  }

  it("overlap=200: stripping the overlap tail recovers the original text", () => {
    // this is the property the whole span-matching design rests on. if the
    // overlap tail were anything other than a verbatim copy of the previous
    // piece's last overlapChars characters, a span found across a boundary
    // would not be attributable to the boundary.
    const params = { targetChars: 800, overlapChars: 200, minChars: 1 };
    const pieces = splitText(LONG_PROSE, params);

    assert.ok(pieces.length > 2, "the fixture must actually split");

    const rebuilt = pieces
      .map((piece, index) => {
        if (index === 0) return piece;

        const tail = Math.min(params.overlapChars, pieces[index - 1].length);

        // +1 for the single space splitText joins the tail on.
        return piece.slice(tail + 1);
      })
      .join(" ");

    const normalise = (value) => value.replace(/\s+/g, " ").trim();

    assert.equal(normalise(rebuilt), normalise(LONG_PROSE.replace(/\n{2,}/g, " ")));
  });

  it("overlap=0 drops short fragments that overlap=200 would have kept", () => {
    // the known confound in the overlap cell, asserted rather than only
    // described: minChars is applied AFTER the tail is prepended
    // (chunking.service.js:93-104), so a short trailing fragment survives at
    // overlap=200 and is discarded at overlap=0. the overlap cell therefore
    // does not isolate overlap perfectly, and it biases AGAINST overlap=0 by
    // removing content rather than by failing to retrieve it.
    // sized so the short paragraph cannot be absorbed into the piece before it:
    // 795 + 11 + 1 exceeds the 800 target, so "Short tail." is flushed as a
    // piece of its own. that is the only arrangement in which the filter can
    // see it at all -- splitText packs greedily, so a short trailing paragraph
    // is otherwise merged into its predecessor and the confound is invisible.
    const filler = (n) => `${"Racquet head speed measurement note. ".repeat(40).slice(0, n - 1)}.`;
    const text = `${filler(700)}\n\n${filler(795)}\n\nShort tail.`;

    const withOverlap = splitText(text, { targetChars: 800, overlapChars: 200, minChars: 120 });
    const without = splitText(text, { targetChars: 800, overlapChars: 0, minChars: 120 });

    assert.ok(
      withOverlap.some((piece) => piece.includes("Short tail.")),
      "overlap=200 should rescue the short trailing fragment",
    );
    assert.ok(
      !without.some((piece) => piece.includes("Short tail.")),
      "overlap=0 should drop it -- this is the confound being documented",
    );
  });
});

// ---------------------------------------------------------------------------
// chunkRecords packing
// ---------------------------------------------------------------------------

const ROW_COUNT = 12;

/** twelve rows, each with its own distinct date, so packing is observable. */
const RECORDS_FIXTURE = `
  const rows = Array.from({ length: ${ROW_COUNT} }, (_, i) => ({
    Date: "2025-01-" + String(i + 1).padStart(2, "0"),
    event_name: "Event " + i,
    score: "6-" + (i % 7) + " 6-0",
    notes: "",
  }));
  const extracted = {
    docId: "match-data-example",
    title: "match data example",
    tableId: "match-data-example",
    sourceType: "match_record",
    records: rows,
  };
`;

function chunkRecordsWith(rowsPerChunk) {
  const code =
    `const { chunkRecords } = await import("${CHUNKING}");` +
    RECORDS_FIXTURE +
    `process.stdout.write("__MARK__" + JSON.stringify(chunkRecords(extracted, ` +
    `{ label: "Match record", eventDateColumns: ["Date"] })) + "__MARK__");`;

  return JSON.parse(runInChild(code, { CHUNK_ROWS_PER_CHUNK: String(rowsPerChunk) }));
}

describe("chunkRecords -- rowsPerChunk = 1 is the behaviour it replaced", () => {
  const chunks = chunkRecordsWith(1);

  it("produces one chunk per row", () => {
    assert.equal(chunks.length, ROW_COUNT);
  });

  it("produces exactly the chunk the old code produced, key for key", () => {
    // NOTE: `row_count` and `raw_event_candidates_by_row` are the two keys this
    // change adds, and they are asserted separately below. neither reaches the
    // vector: `text`, `context_header` and `embedding_text` are byte-identical
    // to the old output, so a rebuild at the defaults embeds the same strings
    // and the committed index stays comparable.
    const { row_count: rowCount, raw_event_candidates_by_row: byRow, ...asItWas } = chunks[0];

    assert.deepEqual(asItWas, {
      chunk_id: "match-data-example#r000000",
      doc_id: "match-data-example",
      modality: "record",
      title: "match data example",
      section: null,
      page: null,
      table_id: "match-data-example",
      row_id: "0",
      text: "Match record. date 2025-01-01. event name Event 0. score 6-0 6-0.",
      context_header: "[match data example | match record | 2025-01-01]",
      embedding_text:
        "[match data example | match record | 2025-01-01]\n" +
        "Match record. date 2025-01-01. event name Event 0. score 6-0 6-0.",
      raw_event_candidates: ["2025-01-01"],
    });

    assert.equal(rowCount, 1);
    assert.deepEqual(byRow, [["2025-01-01"]]);
  });

  it("keeps the zero-padded row ids that citations are built from", () => {
    assert.deepEqual(
      chunks.slice(0, 3).map((chunk) => chunk.chunk_id),
      [
        "match-data-example#r000000",
        "match-data-example#r000001",
        "match-data-example#r000002",
      ],
    );
    assert.deepEqual(chunks.slice(0, 3).map((chunk) => chunk.row_id), ["0", "1", "2"]);
  });
});

describe("chunkRecords -- rowsPerChunk = 5 packs without rewriting rows", () => {
  const packed = chunkRecordsWith(5);
  const single = chunkRecordsWith(1);

  it("groups 12 rows into 3 chunks of 5, 5 and 2", () => {
    assert.equal(packed.length, 3);
    assert.deepEqual(packed.map((chunk) => chunk.row_count), [5, 5, 2]);
  });

  it("ids by FIRST row index, not by group index", () => {
    // a group index would renumber every id in the file, making ids
    // incomparable between settings for no benefit at all.
    assert.deepEqual(
      packed.map((chunk) => chunk.chunk_id),
      [
        "match-data-example#r000000",
        "match-data-example#r000005",
        "match-data-example#r000010",
      ],
    );
    assert.deepEqual(packed.map((chunk) => chunk.row_id), ["0", "5", "10"]);
  });

  it("each row's verbalised sentence is byte-identical to rowsPerChunk=1", () => {
    // this is what lets one set of record ground truth hold across every cell
    // of the comparison. if packing rewrote the rows even slightly, a span
    // derived at one setting would not be findable at another, and the
    // comparison would be measuring the harness rather than the chunking.
    assert.equal(packed[0].text, single.slice(0, 5).map((chunk) => chunk.text).join("\n"));
    assert.equal(packed[1].text, single.slice(5, 10).map((chunk) => chunk.text).join("\n"));
    assert.equal(packed[2].text, single.slice(10, 12).map((chunk) => chunk.text).join("\n"));
  });

  it("keeps every row's own Record. label", () => {
    assert.equal(packed[0].text.match(/Match record\./g).length, 5);
  });

  it("takes the FIRST row's date and reports the range the chunk really spans", () => {
    // the real cost of packing, stated rather than hidden. indexBuilder writes
    // one `event_date` per chunk and that date drives the query-time date
    // filter, so this chunk is filed under 2025-01-01 while also containing
    // rows dated up to 2025-01-05.
    assert.deepEqual(packed[0].raw_event_candidates, ["2025-01-01"]);
    assert.deepEqual(packed[0].raw_event_candidates_by_row, [
      ["2025-01-01"],
      ["2025-01-02"],
      ["2025-01-03"],
      ["2025-01-04"],
      ["2025-01-05"],
    ]);
  });

  it("does not truncate the packed chunk", () => {
    // a cap here would reintroduce an interaction with targetChars and this
    // would stop being a single-variable comparison.
    assert.ok(!packed[0].text.endsWith("..."));
    assert.ok(packed[0].text.length > single[0].text.length * 4);
  });
});

// ---------------------------------------------------------------------------
// verbaliseRow still bounds a ROW, not a chunk
// ---------------------------------------------------------------------------

describe("verbaliseRow -- recordMaxChars", () => {
  it("truncates one row at the configured limit", () => {
    const row = { notes: "x".repeat(500) };

    assert.equal(verbaliseRow(row, { maxChars: 100 }).length, 100 + 3);
    assert.ok(verbaliseRow(row, { maxChars: 100 }).endsWith("..."));
  });

  it("defaults to 1400, the literal it replaced", () => {
    const row = { notes: "x".repeat(4000) };

    assert.equal(verbaliseRow(row).length, 1400 + 3);
  });
});
