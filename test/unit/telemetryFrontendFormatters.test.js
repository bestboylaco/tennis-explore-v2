import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dash,
  formatBoolean,
  formatBytes,
  formatCount,
  formatDateTime,
  formatMs,
  formatNumber,
  formatPercent,
} from "../../public/scripts/ui/telemetry/formatters.js";
import { buildTelemetryQuery } from "../../public/scripts/ui/telemetry/filterBar.js";

// The telemetry dashboard renders aggregation output that is null far more often
// than it is populated: percentiles are null on MongoDB < 7.0, per-run averages
// are null at zero runs, and every ingestion counter is null outside ingestion
// runs. A formatter that confuses "no value" with zero would make an empty
// cluster look like a fast one, so the null handling is what these cover.
//
// These two modules are the only frontend code with no DOM dependency, which is
// why they are the only part under automated test.

test("dash marks absent values rather than printing them", () => {
  assert.equal(dash(null), "—");
  assert.equal(dash(undefined), "—");
  assert.equal(dash(""), "—");
  assert.equal(dash("query"), "query");
});

test("dash keeps zero, which is a measurement and not an absence", () => {
  assert.equal(dash(0), "0");
});

test("formatMs renders milliseconds with a thousands separator", () => {
  assert.equal(formatMs(1234.56), "1,235 ms");
  assert.equal(formatMs(30000), "30,000 ms");
});

test("formatMs keeps one decimal for sub-10ms stages", () => {
  // Routing is sub-millisecond today. Rounding it to "0 ms" would read as
  // uninstrumented rather than fast.
  assert.equal(formatMs(4.24), "4.2 ms");
  assert.equal(formatMs(0.4), "0.4 ms");
});

test("formatMs distinguishes a zero duration from a missing one", () => {
  assert.equal(formatMs(0), "0 ms");
  assert.equal(formatMs(null), "—");
  assert.equal(formatMs(undefined), "—");
  assert.equal(formatMs(Number.NaN), "—");
});

test("formatPercent scales a 0-1 rate to a percentage", () => {
  assert.equal(formatPercent(0.0345), "3.5%");
  assert.equal(formatPercent(1), "100.0%");
  assert.equal(formatPercent(0), "0.0%");
});

test("formatPercent dashes a missing rate", () => {
  // coldStartRate is null at zero runs, which must not render as 0%.
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPercent(Number.NaN), "—");
});

test("formatBytes steps up through binary units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(3221225472), "3.0 GB");
});

test("formatBytes dashes a missing byte count", () => {
  assert.equal(formatBytes(null), "—");
});

test("formatCount groups large counts", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(12345), "12,345");
  assert.equal(formatCount(null), "—");
});

test("formatNumber keeps the requested decimals", () => {
  assert.equal(formatNumber(1.23456, 2), "1.23");
  assert.equal(formatNumber(0, 2), "0.00");
  assert.equal(formatNumber(1234.5, 1), "1,234.5");
  assert.equal(formatNumber(null, 2), "—");
});

test("formatDateTime renders a sortable local timestamp", () => {
  // Built and formatted in local time, so the assertion holds in any timezone.
  const moment = new Date(2026, 7, 17, 4, 5, 6);

  assert.equal(formatDateTime(moment), "2026-08-17 04:05:06");
  assert.equal(formatDateTime(moment.toISOString()), "2026-08-17 04:05:06");
});

test("formatDateTime dashes a value that is not a date", () => {
  assert.equal(formatDateTime(null), "—");
  assert.equal(formatDateTime("not a date"), "—");
});

test("formatBoolean separates false from unknown", () => {
  // coldStart.detected is false on a warm run and absent on a record written
  // before the field existed. The table has to show which one it is.
  assert.equal(formatBoolean(true), "✓");
  assert.equal(formatBoolean(false), "✗");
  assert.equal(formatBoolean(null), "—");
});

test("buildTelemetryQuery returns an empty string when nothing is filtered", () => {
  // An empty string keeps the caller from appending a bare "?" to the URL.
  assert.equal(buildTelemetryQuery({}), "");
  assert.equal(buildTelemetryQuery(), "");
});

test("buildTelemetryQuery emits only the fields that were set", () => {
  assert.equal(
    buildTelemetryQuery({ runType: "query", limit: 25 }),
    "runType=query&limit=25",
  );
});

test("buildTelemetryQuery drops blank selections", () => {
  // The filter form uses "" for its "any" option, which must not be sent as a
  // filter for the empty string.
  assert.equal(
    buildTelemetryQuery({
      runType: "",
      queryClass: null,
      status: undefined,
      limit: 25,
    }),
    "limit=25",
  );
});

test("buildTelemetryQuery sends both cold start states but omits the unset one", () => {
  // coldStart=false is a real filter (warm runs only), so it cannot be dropped
  // the way a blank select is.
  assert.equal(buildTelemetryQuery({ coldStart: true }), "coldStart=true");
  assert.equal(buildTelemetryQuery({ coldStart: false }), "coldStart=false");
  assert.equal(buildTelemetryQuery({ coldStart: undefined }), "");
});

test("buildTelemetryQuery percent-encodes values", () => {
  assert.equal(
    buildTelemetryQuery({ correlationId: "run 1/2&3" }),
    "correlationId=run+1%2F2%263",
  );
});

test("buildTelemetryQuery orders keys predictably", () => {
  // Stable ordering keeps the address bar readable and makes a shared debugging
  // URL comparable to another one.
  assert.equal(
    buildTelemetryQuery({
      limit: 25,
      status: "failed",
      from: "2026-08-01",
      runType: "query",
    }),
    "runType=query&status=failed&from=2026-08-01&limit=25",
  );
});

test("buildTelemetryQuery ignores keys the telemetry API does not accept", () => {
  // The summary view passes the same filter object with no limit or coldStart,
  // and the record detail view adds page state that is not a backend filter.
  assert.equal(
    buildTelemetryQuery({ runType: "query", recordId: "abc", page: 2 }),
    "runType=query",
  );
});
