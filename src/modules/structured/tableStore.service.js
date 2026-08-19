// keeps the tables as tables.
//
// the retrieval index turns every spreadsheet row into a sentence so it can be
// ranked next to a paragraph. that is the right thing for "show me the match
// where he beat kumasaka", and it is useless for "what is the median change in
// serve speed year on year" -- because no chunk contains that median. no amount
// of better retrieval will find a number that was never written down.
//
// so the same csv is loaded twice, for two different jobs:
//
//   index  -> verbalised rows, for finding and citing individual records
//   here   -> typed columns, for actually computing over them
//
// this file is the second one. it does no ranking and no embedding; it parses
// types and hands back arrays.

import fsp from "node:fs/promises";
import path from "node:path";

import { extractFile, listIngestableFiles } from "../ingestion/extraction.service.js";
import { classifyDocument, normaliseDate } from "../ingestion/metadata.service.js";
import { grantsForDocument, isPermitted } from "../../shared/constants/accessControl.js";

// values that mean "no data". the partner's exports use several of these
// interchangeably, sometimes in the same column.
const NULL_VALUES = new Set(["", "nan", "none", "null", "n/a", "na", "not available", "-", "unknown"]);

function isNull(value) {
  return value === null || value === undefined || NULL_VALUES.has(String(value).trim().toLowerCase());
}

/**
 * works out what a column holds by looking at the values in it.
 *
 * this matters more than it sounds. if `player_singles_ranking` is read as text
 * then sorting it puts 113 before 58, and an average of it is impossible. the
 * check is majority-based rather than all-or-nothing because real exports
 * always have a few stray "Not available" strings in an otherwise numeric
 * column, and those should not demote the whole column to text.
 */
function inferType(values) {
  const present = values.filter((value) => !isNull(value));

  if (present.length === 0) return "empty";

  let numeric = 0;
  let dates = 0;

  for (const value of present) {
    if (value instanceof Date) {
      dates += 1;
      continue;
    }

    const text = String(value).trim();

    // a bare 4-digit number is ambiguous -- 2025 is both a year and a number.
    // we call it numeric, because treating it as a date breaks arithmetic while
    // treating it as a number only costs us date grouping.
    if (text !== "" && Number.isFinite(Number(text.replace(/,/g, "")))) {
      numeric += 1;
    } else if (normaliseDate(text)) {
      dates += 1;
    }
  }

  if (numeric / present.length >= 0.8) return "number";
  if (dates / present.length >= 0.8) return "date";

  return "string";
}

function coerce(value, type) {
  if (isNull(value)) return null;

  if (type === "number") {
    const parsed = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (type === "date") return normaliseDate(value);

  return String(value).trim();
}

export class Table {
  constructor({ name, title, sourceUri, columns, rows, classification }) {
    this.name = name;
    this.title = title;
    this.sourceUri = sourceUri;
    this.columns = columns; // [{ name, type }]
    this.rows = rows; // array of objects, values already coerced
    this.classification = classification;
    this.aclGroups = grantsForDocument(classification);
  }

  get columnNames() {
    return this.columns.map((column) => column.name);
  }

  column(name) {
    return this.columns.find((column) => column.name === name) ?? null;
  }

  /** a compact description, used to tell the planner what it may query. */
  describe({ maxColumns = 40 } = {}) {
    const columns = this.columns
      .slice(0, maxColumns)
      .map((column) => `${column.name}:${column.type}`)
      .join(", ");

    return `${this.name} (${this.rows.length} rows) [${columns}]`;
  }
}

/**
 * loads every table under the given folders.
 *
 * kept separate from the index build on purpose: rebuilding the index means
 * re-embedding everything and takes twenty minutes, whereas re-reading the
 * tables takes a second. you should be able to fix a column type and re-run a
 * query without paying for the gpu again.
 */
export async function loadTables(sourceDirs) {
  const tables = [];

  for (const directory of sourceDirs) {
    for (const filePath of await listIngestableFiles(directory)) {
      const extension = path.extname(filePath).toLowerCase();

      if (![".csv", ".xlsx", ".xls"].includes(extension)) continue;

      const extracted = await extractFile(filePath);

      if (!extracted || extracted.kind !== "records" || extracted.records.length === 0) continue;

      const headers = extracted.headers.length > 0 ? extracted.headers : Object.keys(extracted.records[0]);

      const columns = headers.map((name) => ({
        name,
        type: inferType(extracted.records.map((row) => row[name])),
      }));

      const rows = extracted.records.map((row) => {
        const typed = {};

        for (const column of columns) {
          typed[column.name] = coerce(row[column.name], column.type);
        }

        return typed;
      });

      const classification = classifyDocument({
        sourceType: extracted.sourceType,
        fileName: path.basename(filePath),
      });

      tables.push(
        new Table({
          name: extracted.docId,
          title: extracted.title,
          sourceUri: filePath,
          columns,
          rows,
          classification,
        }),
      );
    }
  }

  return tables;
}

// tables are cached like the index is -- parsing 500 rows is fast but doing it
// on every message is still waste.
let cache = null;

export async function getTables({ sourceDirs, force = false } = {}) {
  if (cache && !force) return cache;

  if (!sourceDirs || sourceDirs.length === 0) {
    // fall back to whatever the index was built from, so a normal chat request
    // does not have to know where the raw files live.
    const manifestPath = path.join(process.env.INDEX_DIR || "data/index", "manifest.json");

    try {
      const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
      sourceDirs = manifest.sourceDirs ?? [];
    } catch {
      sourceDirs = [];
    }
  }

  cache = await loadTables(sourceDirs);

  return cache;
}

export function clearTableCache() {
  cache = null;
}

/**
 * the tables a given role may query.
 *
 * table-level rather than row-level. that is honest about what it does: it can
 * say "you may not query the match records at all", not "you may query them but
 * only for your own squad". row-level scoping is the next story, and until it
 * exists a table with mixed ownership has to be classified at its most
 * restrictive.
 */
export function visibleTables(tables, grants) {
  return tables.filter((table) => isPermitted(table.aclGroups, grants));
}
