// turns a question into a query spec the engine can run.
//
// this is the second constrained-form call in the system (the first picks the
// intent). same principle: the model fills in fields, our code decides what
// happens with them. nothing here is executed as code.
//
// the one interesting bit is the retry. when validation rejects a spec it throws
// a message that names the bad field AND lists the valid options -- "cannot
// apply avg to tournament_name because it is string, not a number. numeric
// columns: Player_age, Player_ranking, ...". that message is fed straight back
// to the model as a correction. a small model gets this right on the second go
// far more often than you would expect, because the failure is usually "guessed
// a plausible column name" rather than "did not understand the question".

import { retrievalConfig } from "../../config/retrieval.config.js";
import { AGGREGATES, OPERATORS, QuerySpecError, validateSpec } from "./queryEngine.service.js";

const SPEC_SCHEMA = {
  type: "object",
  properties: {
    table: { type: "string" },
    select: { type: "array", items: { type: "string" } },
    filters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          column: { type: "string" },
          op: { type: "string", enum: Object.keys(OPERATORS) },
          value: { type: ["string", "number"] },
        },
        required: ["column", "op"],
      },
    },
    groupBy: { type: "array", items: { type: "string" } },
    timeGrain: { type: "string", enum: ["", "year", "month"] },
    metrics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fn: { type: "string", enum: Object.keys(AGGREGATES) },
          column: { type: "string" },
          alias: { type: "string" },
        },
        required: ["fn"],
      },
    },
    orderBy: {
      type: "object",
      properties: {
        column: { type: "string" },
        direction: { type: "string", enum: ["asc", "desc"] },
      },
    },
    limit: { type: "number" },
  },
  required: ["table", "select", "filters", "groupBy", "metrics"],
};

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Narrows the tables shown to the planner before it ever sees a question.
 *
 * The ranking corpus alone is ~50 near-identical weekly tables (itf/atp/wta/utr
 * x many dates), differing only in circuit and week. Dumping every one of
 * their schemas into a single system prompt for an 8B model to pick from is
 * exactly the setup that made it answer "Who is ranked number 1 in the ITF
 * rankings dated 2026-01-05?" from utr-international-2026-01-07 instead of
 * the itf-2026-01-05 table that matches the question verbatim -- the right
 * table was one candidate lost among fifty near-duplicates, and the closest
 * date won over the right circuit.
 *
 * This is a plain lexical pre-filter, not a second model call: a table's name
 * (e.g. "itf-2026-01-05" -> tokens "itf", "2026", "01", "05") is scored by how
 * many of its tokens appear in the question. "ITF rankings dated 2026-01-05"
 * scores itf-2026-01-05 at 4 and utr-international-2026-01-07 at 2 (just the
 * shared year and month), which is enough to keep the right table off the
 * ambiguity floor entirely. Below the size where that ambiguity can occur,
 * or when nothing in a table's name matches the question at all, every table
 * is still shown -- this only narrows an already-oversized candidate set, it
 * never removes the only table capable of answering a normal question.
 */
export function selectCandidateTables(question, tables, { maxCandidates = 8, minTablesToFilter = 12 } = {}) {
  if (tables.length <= minTablesToFilter) return tables;

  const questionTokens = new Set(tokenize(question));

  const scored = tables
    .map((table) => ({
      table,
      score: tokenize(table.name).filter((token) => questionTokens.has(token)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return tables;

  return scored.slice(0, maxCandidates).map((entry) => entry.table);
}

function systemPrompt(tables) {
  const schemas = tables
    .map((table) => `  ${table.describe({ maxColumns: 60 })}`)
    .join("\n");

  return `You translate a question into a query specification over these tables:

${schemas}

Rules:
- Pick exactly ONE table: the one whose columns can answer the question.
- Use column names EXACTLY as written above, including capitalisation. Never invent a column.
- Only apply sum, avg, median, min or max to columns marked :number.
- For "per year" or "year on year", set groupBy to the date column and timeGrain to "year". Use "month" for monthly.
- Leave groupBy empty unless the user's question explicitly asks for results grouped by a category, entity, year, month, or other dimension.
- Do not invent a grouping column merely because a date column exists; only group by time when the question explicitly asks for a trend, per-year, year-on-year, monthly, or similar breakdown.
- For a lookup of specific rows, leave metrics empty and list the columns in select.
- For a count of rows, use {"fn":"count"} with no column.
- select may contain ONLY raw column names exactly as listed in the table schema.
- NEVER put calculations or expressions such as avg(column), max(column), min(column), sum(column), median(column), or count(column) inside select.
- All calculations must be represented through metrics.
- For an average, use a metric with fn "avg" and the raw numeric column name.
- For minimum, maximum, median, sum, count, or count distinct, use the corresponding metric function rather than writing an expression in select.
- Set limit when the question asks for a top N.
- If nothing here can answer the question, set table to "" and leave everything else empty.`;
}

async function callSpecPlanner(messages, { signal }) {
  const response = await fetch(`${retrievalConfig.generation.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: retrievalConfig.query.plannerModel,
      stream: false,
      format: SPEC_SCHEMA,
      options: { temperature: 0, num_predict: 500 },
      messages,
    }),
    signal,
  });

  if (!response.ok) throw new Error(`spec planner returned ${response.status}`);

  const payload = await response.json();

  return JSON.parse(payload.message?.content ?? "{}");
}

function normalise(raw) {
  return {
    table: typeof raw.table === "string" ? raw.table.trim() : "",
    select: Array.isArray(raw.select) ? raw.select.filter((c) => typeof c === "string") : [],
    filters: Array.isArray(raw.filters)
      ? raw.filters.filter((f) => f && typeof f.column === "string" && typeof f.op === "string")
      : [],
    groupBy: Array.isArray(raw.groupBy) ? raw.groupBy.filter((c) => typeof c === "string") : [],
    // the schema forces timeGrain to be a string, so "" means "not set" -- an
    // empty string would otherwise reach groupKeyFor and be truthy-checked wrong.
    timeGrain: raw.timeGrain === "year" || raw.timeGrain === "month" ? raw.timeGrain : null,
    metrics: Array.isArray(raw.metrics) ? raw.metrics.filter((m) => m && typeof m.fn === "string") : [],
    orderBy: raw.orderBy?.column ? raw.orderBy : null,
    limit: Number.isFinite(raw.limit) && raw.limit > 0 ? Math.min(raw.limit, 500) : null,
  };
}

function alignSpecToTable(spec, table) {
  const canonicalColumn = (name) => {
    if (typeof name !== "string") {
      return name;
    }

    const exact =
      table.columnNames.find(
        (column) =>
          column === name
      );

    if (exact) {
      return exact;
    }

    const caseInsensitive =
      table.columnNames.find(
        (column) =>
          column.toLowerCase() ===
          name.toLowerCase()
      );

    return (
      caseInsensitive ??
      name
    );
  };


  const filters =
    (spec.filters ?? []).map(
      (filter) => ({
        ...filter,

        column:
          canonicalColumn(
            filter.column
          ),
      })
    );


  const groupBy =
    (spec.groupBy ?? []).map(
      canonicalColumn
    );


  const metrics =
    (spec.metrics ?? []).map(
      (metric) => ({
        ...metric,

        column:
          metric.column
            ? canonicalColumn(
                metric.column
              )
            : metric.column,
      })
    );


  let select =
    (spec.select ?? []).map(
      canonicalColumn
    );


  /*
   * Aggregate queries cannot select arbitrary
   * raw columns alongside aggregate results.
   *
   * A raw column is valid here only when it
   * is explicitly part of the grouping.
   */
  if (metrics.length > 0) {
    select =
      select.filter(
        (column) =>
          groupBy.includes(
            column
          )
      );
  }


  const orderBy =
    spec.orderBy?.column
      ? {
          ...spec.orderBy,

          column:
            canonicalColumn(
              spec.orderBy.column
            ),
        }
      : spec.orderBy;


  return {
    ...spec,
    select,
    filters,
    groupBy,
    metrics,
    orderBy,
  };
}





/**
 * builds and validates a spec, retrying once with the validation error.
 *
 * returns { spec, table } on success, or { unanswerable: true, reason } when the
 * model says no table fits or the second attempt still fails. that second case
 * is important and must not be swallowed -- "the tables cannot answer this" is
 * a legitimate, useful answer, and far better than returning a number computed
 * from the wrong column.
 */
export async function buildQuerySpec(question, tables, { signal = null } = {}) {
  if (tables.length === 0) {
    return { unanswerable: true, reason: "no tables are visible to this role" };
  }

  const candidates = selectCandidateTables(question, tables);

  const messages = [
    { role: "system", content: systemPrompt(candidates) },
    { role: "user", content: question },
  ];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw;

    try {
      raw = normalise(await callSpecPlanner(messages, { signal }));
    } catch (error) {
      return { unanswerable: true, reason: `query planner unavailable: ${error.message}` };
    }

    if (!raw.table) {
      return { unanswerable: true, reason: "no table in the knowledge base holds this information" };
    }

    // the model sometimes returns a near-miss on the table name -- a trailing
    // underscore, or the title instead of the id. match loosely before failing.
    const table =
      tables.find((candidate) => candidate.name === raw.table) ??
      tables.find((candidate) =>
        candidate.name.toLowerCase().includes(raw.table.toLowerCase().replace(/\W+/g, "")),
      ) ??
      tables.find((candidate) => candidate.title.toLowerCase() === raw.table.toLowerCase());

    if (!table) {
      if (attempt === 2) {
        return { unanswerable: true, reason: `no table called "${raw.table}"` };
      }

      messages.push(
        { role: "assistant", content: JSON.stringify(raw) },
        {
          role: "user",
          content: `There is no table called "${raw.table}". Choose one of: ${tables
            .map((candidate) => candidate.name)
            .join(", ")}`,
        },
      );

      continue;
    }

    try {
      raw =
        alignSpecToTable(
          raw,
          table
        );
      validateSpec(raw, table);

      return { spec: raw, table };
    } catch (error) {
      if (!(error instanceof QuerySpecError) || attempt === 2) {
        return { unanswerable: true, reason: error.message };
      }

      // hand the validator's message back verbatim. it already names the bad
      // field and lists the valid alternatives, which is exactly the correction
      // the model needs and much better than "that was wrong, try again".
      messages.push(
        { role: "assistant", content: JSON.stringify(raw) },
        { role: "user", content: `That specification is invalid: ${error.message}\n\nCorrect it.` },
      );
    }
  }

  return { unanswerable: true, reason: "could not build a valid query after two attempts" };
}

export { SPEC_SCHEMA };
