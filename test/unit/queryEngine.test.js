import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { QuerySpecError, renderSql, runQuery, validateSpec } from "../../src/modules/structured/queryEngine.service.js";
import { Table } from "../../src/modules/structured/tableStore.service.js";

const table = new Table({
  name: "matches",
  title: "Matches",
  sourceUri: "/tmp/matches.csv",
  columns: [
    { name: "date", type: "date" },
    { name: "surface", type: "string" },
    { name: "player", type: "string" },
    { name: "ranking", type: "number" },
    { name: "aces", type: "number" },
  ],
  rows: [
    { date: "2025-01-10", surface: "Hard", player: "A", ranking: 10, aces: 5 },
    { date: "2025-02-10", surface: "Hard", player: "B", ranking: 20, aces: 7 },
    { date: "2025-03-10", surface: "Clay", player: "A", ranking: 30, aces: 1 },
    { date: "2026-01-10", surface: "Clay", player: "C", ranking: 40, aces: null },
  ],
  classification: { domain: "performance", sensitivity: "internal", program: "*" },
});

describe("query spec validation", () => {
  it("refuses to average a text column", () => {
    // the classic silent failure. sql returns null or 0 and nobody notices.
    assert.throws(
      () => validateSpec({ metrics: [{ fn: "avg", column: "surface" }] }, table),
      /not a number/,
    );
  });

  it("refuses an unknown column and says what is available", () => {
    assert.throws(
      () => validateSpec({ metrics: [{ fn: "avg", column: "serve_speed" }] }, table),
      /which is not in matches.*available/s,
    );
  });

  it("refuses an unknown aggregate", () => {
    assert.throws(() => validateSpec({ metrics: [{ fn: "stddev", column: "aces" }] }, table), QuerySpecError);
  });

  it("allows count with no column", () => {
    assert.doesNotThrow(() => validateSpec({ metrics: [{ fn: "count" }] }, table));
  });

  it("refuses a spec that asks for nothing", () => {
    assert.throws(() => validateSpec({ metrics: [], select: [] }, table), /either select columns or metrics/);
  });
});

describe("aggregation", () => {
  it("groups and counts", () => {
    const result = runQuery(
      { groupBy: ["surface"], metrics: [{ fn: "count", alias: "n" }], select: [], filters: [] },
      table,
    );

    assert.deepEqual(
      result.rows.map((row) => [row.surface, row.n]).sort(),
      [["Clay", 2], ["Hard", 2]],
    );
  });

  it("computes a median correctly on an even count", () => {
    // the case naive implementations get wrong: they return the lower of the two
    // middle values instead of their mean.
    const result = runQuery({ metrics: [{ fn: "median", column: "ranking", alias: "m" }], select: [], filters: [] }, table);

    assert.equal(result.rows[0].m, 25);
  });

  it("drops nulls rather than treating them as zero", () => {
    // counting a missing value as 0 would drag the average down and look like a
    // real decline rather than missing data.
    const result = runQuery({ metrics: [{ fn: "avg", column: "aces", alias: "a" }], select: [], filters: [] }, table);

    assert.equal(result.rows[0].a, (5 + 7 + 1) / 3);
  });

  it("groups by year when asked for a time grain", () => {
    const result = runQuery(
      { groupBy: ["date"], timeGrain: "year", metrics: [{ fn: "count", alias: "n" }], select: [], filters: [] },
      table,
    );

    assert.deepEqual(result.rows.map((row) => row.date_year), ["2025", "2026"]);
  });

  it("reports what the answer rests on", () => {
    const result = runQuery(
      { filters: [{ column: "surface", op: "eq", value: "Clay" }], metrics: [{ fn: "count", alias: "n" }], select: [] },
      table,
    );

    assert.equal(result.rowsScanned, 4);
    assert.equal(result.rowsMatched, 2);
  });
});

describe("filters", () => {
  it("matches case-insensitively on equality", () => {
    const result = runQuery(
      { filters: [{ column: "surface", op: "eq", value: "hard" }], metrics: [{ fn: "count", alias: "n" }], select: [] },
      table,
    );

    assert.equal(result.rows[0].n, 2);
  });

  it("excludes nulls from comparisons rather than ranking them", () => {
    const result = runQuery(
      { filters: [{ column: "aces", op: "gt", value: 0 }], metrics: [{ fn: "count", alias: "n" }], select: [] },
      table,
    );

    assert.equal(result.rows[0].n, 3);
  });
});

describe("sql rendering", () => {
  it("describes what was actually run", () => {
    const sql = renderSql(
      {
        groupBy: ["date"],
        timeGrain: "year",
        metrics: [{ fn: "median", column: "ranking", alias: "median_rank" }],
        filters: [{ column: "surface", op: "eq", value: "Hard" }],
        select: [],
      },
      table,
    );

    assert.match(sql, /SELECT YEAR\(date\), MEDIAN\(ranking\) AS median_rank/);
    assert.match(sql, /WHERE surface = 'Hard'/);
    assert.match(sql, /GROUP BY YEAR\(date\)/);
  });
});
