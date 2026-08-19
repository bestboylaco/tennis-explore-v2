// runs the calculation, and shows its working.
//
// -------------------------------------------------------------------------
// why we do not let the model write sql
// -------------------------------------------------------------------------
// the obvious design is: ask the model for a sql string, run it, return the
// rows. al even asked for sql as one of the output formats. we do not do that,
// and the reason is not squeamishness about injection -- although a model that
// can be talked into writing `DROP TABLE` is a real problem when the same
// endpoint is reachable by a coach.
//
// the bigger reason is that an 8b model writes sql that is *syntactically* fine
// and *semantically* wrong: it averages a column of strings, joins on the wrong
// key, or silently drops the null rows that were the interesting ones. you get a
// number, it looks authoritative, and nothing anywhere says it is nonsense.
//
// so the model fills in a SPEC instead -- which table, which columns, which
// filters, which aggregate. every field is validated against the real schema
// before anything runs: unknown column, wrong type for the operation, unknown
// table, all rejected with a message naming what was wrong.
//
// then we render the equivalent sql as a STRING and return it alongside the
// result. al gets his sql output, the coach can see exactly what was computed,
// and no model-written sql was ever executed. the sql is documentation, not
// instruction.

const AGGREGATES = Object.freeze({
  count: { needsNumber: false, label: "COUNT" },
  sum: { needsNumber: true, label: "SUM" },
  avg: { needsNumber: true, label: "AVG" },
  median: { needsNumber: true, label: "MEDIAN" },
  min: { needsNumber: true, label: "MIN" },
  max: { needsNumber: true, label: "MAX" },
  count_distinct: { needsNumber: false, label: "COUNT(DISTINCT" },
});

const OPERATORS = Object.freeze({
  eq: "=",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  contains: "LIKE",
  in: "IN",
  is_not_null: "IS NOT NULL",
});

export class QuerySpecError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuerySpecError";
    this.code = "INVALID_QUERY_SPEC";
  }
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

/**
 * checks a spec against the real table schema before anything runs.
 *
 * every failure names the offending field AND lists what would have been valid,
 * because these messages are shown to the planner on a retry -- a message the
 * model can act on turns a failed query into a corrected one.
 */
export function validateSpec(spec, table) {
  if (!spec || typeof spec !== "object") throw new QuerySpecError("spec must be an object");

  const known = new Set(table.columnNames);

  const requireColumn = (name, where) => {
    if (!known.has(name)) {
      throw new QuerySpecError(
        `${where} refers to column "${name}", which is not in ${table.name}. ` +
          `available: ${table.columnNames.slice(0, 25).join(", ")}`,
      );
    }
  };

  const filters = Array.isArray(spec.filters) ? spec.filters : [];

  for (const filter of filters) {
    requireColumn(filter.column, "filter");

    if (!(filter.op in OPERATORS)) {
      throw new QuerySpecError(
        `filter uses operator "${filter.op}". valid: ${Object.keys(OPERATORS).join(", ")}`,
      );
    }
  }

  const groupBy = Array.isArray(spec.groupBy) ? spec.groupBy : [];

  for (const column of groupBy) requireColumn(column, "groupBy");

  const metrics = Array.isArray(spec.metrics) ? spec.metrics : [];

  for (const metric of metrics) {
    if (!(metric.fn in AGGREGATES)) {
      throw new QuerySpecError(
        `metric uses function "${metric.fn}". valid: ${Object.keys(AGGREGATES).join(", ")}`,
      );
    }

    // count(*) is the one aggregate that needs no column.
    if (!(metric.fn === "count" && !metric.column)) {
      requireColumn(metric.column, "metric");

      // this is the check that catches the classic failure: averaging a text
      // column. sql would happily return null or 0; we refuse and say why.
      if (AGGREGATES[metric.fn].needsNumber && table.column(metric.column).type !== "number") {
        throw new QuerySpecError(
          `cannot apply ${metric.fn} to "${metric.column}" because it is ` +
            `${table.column(metric.column).type}, not a number. ` +
            `numeric columns: ${table.columns.filter((c) => c.type === "number").map((c) => c.name).slice(0, 15).join(", ")}`,
        );
      }
    }
  }

  const select = Array.isArray(spec.select) ? spec.select : [];

  for (const column of select) requireColumn(column, "select");

  if (metrics.length === 0 && select.length === 0) {
    throw new QuerySpecError("spec must ask for either select columns or metrics");
  }

  if (spec.orderBy?.column) {
    const orderColumn = spec.orderBy.column;
    const aliases = new Set(metrics.map((metric) => metric.alias ?? `${metric.fn}_${metric.column ?? "all"}`));

    if (!known.has(orderColumn) && !aliases.has(orderColumn)) {
      throw new QuerySpecError(
        `orderBy refers to "${orderColumn}", which is neither a column nor a metric alias`,
      );
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

function matches(row, filter) {
  const value = row[filter.column];

  if (filter.op === "is_not_null") return value !== null && value !== undefined;
  if (value === null || value === undefined) return false;

  switch (filter.op) {
    case "eq":
      return String(value).toLowerCase() === String(filter.value).toLowerCase();
    case "ne":
      return String(value).toLowerCase() !== String(filter.value).toLowerCase();
    case "gt":
      return value > filter.value;
    case "gte":
      return value >= filter.value;
    case "lt":
      return value < filter.value;
    case "lte":
      return value <= filter.value;
    case "contains":
      return String(value).toLowerCase().includes(String(filter.value).toLowerCase());
    case "in":
      return (Array.isArray(filter.value) ? filter.value : [filter.value])
        .map((item) => String(item).toLowerCase())
        .includes(String(value).toLowerCase());
    default:
      return false;
  }
}

/**
 * median, done properly.
 *
 * worth writing out rather than reaching for a library, because the even-length
 * case is where naive implementations quietly return the lower of the two middle
 * values instead of their mean -- and al asked for a median specifically.
 */
function median(values) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function aggregate(rows, metric) {
  const alias = metric.alias ?? `${metric.fn}_${metric.column ?? "all"}`;

  if (metric.fn === "count") return [alias, rows.length];

  const raw = rows.map((row) => row[metric.column]);

  if (metric.fn === "count_distinct") {
    return [alias, new Set(raw.filter((value) => value !== null && value !== undefined)).size];
  }

  // nulls are dropped, not treated as zero. counting a missing serve speed as
  // 0 km/h would drag every average down and the result would look like a real
  // decline rather than missing data.
  const numbers = raw.filter((value) => typeof value === "number" && Number.isFinite(value));

  if (numbers.length === 0) return [alias, null];

  switch (metric.fn) {
    case "sum":
      return [alias, numbers.reduce((total, value) => total + value, 0)];
    case "avg":
      return [alias, numbers.reduce((total, value) => total + value, 0) / numbers.length];
    case "median":
      return [alias, median(numbers)];
    case "min":
      return [alias, Math.min(...numbers)];
    case "max":
      return [alias, Math.max(...numbers)];
    default:
      return [alias, null];
  }
}

/**
 * groups by the year of a date column, for "year on year" questions.
 *
 * kept as an explicit spec option rather than something the planner has to
 * express, because asking a small model to write a date-truncation expression
 * is asking for a bad time.
 */
function groupKeyFor(row, groupBy, timeGrain) {
  return groupBy
    .map((column) => {
      const value = row[column];

      if (timeGrain && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        if (timeGrain === "year") return value.slice(0, 4);
        if (timeGrain === "month") return value.slice(0, 7);
      }

      return value === null || value === undefined ? "(none)" : String(value);
    })
    .join(" | ");
}

export function renderSql(spec, table) {
  const metrics = spec.metrics ?? [];
  const groupBy = spec.groupBy ?? [];
  const select = spec.select ?? [];

  const groupExpressions = groupBy.map((column) =>
    spec.timeGrain ? `${spec.timeGrain.toUpperCase()}(${column})` : column,
  );

  const metricExpressions = metrics.map((metric) => {
    const alias = metric.alias ?? `${metric.fn}_${metric.column ?? "all"}`;

    if (metric.fn === "count" && !metric.column) return `COUNT(*) AS ${alias}`;
    if (metric.fn === "count_distinct") return `COUNT(DISTINCT ${metric.column}) AS ${alias}`;

    return `${AGGREGATES[metric.fn].label}(${metric.column}) AS ${alias}`;
  });

  // a column that is grouped AND selected must appear once, not twice. the
  // planner routinely emits both, and the rendered sql came out as
  // "SELECT surface_c, COUNT(*) AS count_all, surface_c" -- not valid sql, and
  // since this string is the audit trail shown to the user it made a correct
  // answer look untrustworthy.
  const grouped = new Set(groupBy);
  const selectOnly = select.filter((column) => !grouped.has(column));

  const projection = [...groupExpressions, ...metricExpressions, ...selectOnly];

  const where = (spec.filters ?? []).map((filter) => {
    if (filter.op === "is_not_null") return `${filter.column} IS NOT NULL`;
    if (filter.op === "contains") return `${filter.column} LIKE '%${filter.value}%'`;
    if (filter.op === "in") {
      return `${filter.column} IN (${(Array.isArray(filter.value) ? filter.value : [filter.value])
        .map((item) => `'${item}'`)
        .join(", ")})`;
    }

    return `${filter.column} ${OPERATORS[filter.op]} ${typeof filter.value === "number" ? filter.value : `'${filter.value}'`}`;
  });

  return [
    `SELECT ${projection.length > 0 ? projection.join(", ") : "*"}`,
    `FROM ${table.name}`,
    where.length > 0 ? `WHERE ${where.join("\n  AND ")}` : null,
    groupExpressions.length > 0 ? `GROUP BY ${groupExpressions.join(", ")}` : null,
    spec.orderBy?.column
      ? `ORDER BY ${spec.orderBy.column} ${spec.orderBy.direction === "asc" ? "ASC" : "DESC"}`
      : null,
    spec.limit ? `LIMIT ${spec.limit}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * runs a validated spec against a table.
 *
 * returns the rows, the columns, the sql that describes what happened, and the
 * counts needed to say how much data the answer rests on -- "median of 4 rows"
 * and "median of 4000 rows" deserve very different amounts of trust, and the
 * answer should be able to say which it was.
 */
export function runQuery(spec, table) {
  validateSpec(spec, table);

  const filters = spec.filters ?? [];
  const filtered = table.rows.filter((row) => filters.every((filter) => matches(row, filter)));

  const metrics = spec.metrics ?? [];
  const groupBy = spec.groupBy ?? [];

  let columns;
  let rows;

  if (metrics.length === 0) {
    // a plain lookup: no maths, just the rows.
    const select = spec.select.length > 0 ? spec.select : table.columnNames;

    columns = [...select];
    rows = filtered.map((row) => Object.fromEntries(select.map((column) => [column, row[column]])));
  } else if (groupBy.length === 0) {
    // one aggregate over everything.
    columns = metrics.map((metric) => metric.alias ?? `${metric.fn}_${metric.column ?? "all"}`);
    rows = [Object.fromEntries(metrics.map((metric) => aggregate(filtered, metric)))];
  } else {
    const groups = new Map();

    for (const row of filtered) {
      const key = groupKeyFor(row, groupBy, spec.timeGrain);

      if (!groups.has(key)) groups.set(key, []);

      groups.get(key).push(row);
    }

    const groupLabel = spec.timeGrain ? `${groupBy.join("_")}_${spec.timeGrain}` : groupBy.join("_");

    columns = [groupLabel, ...metrics.map((metric) => metric.alias ?? `${metric.fn}_${metric.column ?? "all"}`)];

    rows = [...groups.entries()].map(([key, groupRows]) => ({
      [groupLabel]: key,
      ...Object.fromEntries(metrics.map((metric) => aggregate(groupRows, metric))),
    }));
  }

  if (spec.orderBy?.column) {
    const { column, direction } = spec.orderBy;
    const sign = direction === "asc" ? 1 : -1;

    rows.sort((a, b) => {
      const left = a[column];
      const right = b[column];

      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      if (typeof left === "number" && typeof right === "number") return sign * (left - right);

      return sign * String(left).localeCompare(String(right));
    });
  } else if (spec.timeGrain && rows.length > 0) {
    // a trend with no explicit ordering should still come out in time order,
    // otherwise the "year on year" table is in map insertion order and the shape
    // of the trend is invisible.
    const [first] = columns;
    rows.sort((a, b) => String(a[first]).localeCompare(String(b[first])));
  }

  const limited = spec.limit ? rows.slice(0, spec.limit) : rows;

  return {
    columns,
    rows: limited,
    sql: renderSql(spec, table),
    table: table.name,
    tableTitle: table.title,
    sourceUri: table.sourceUri,
    rowsScanned: table.rows.length,
    rowsMatched: filtered.length,
    rowsReturned: limited.length,
    truncated: limited.length < rows.length,
  };
}

export { AGGREGATES, OPERATORS };
