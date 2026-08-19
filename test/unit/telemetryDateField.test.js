import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatAuDateTime,
  parseAuDateTime,
} from "../../public/scripts/ui/telemetry/dateTimeField.js";

// The From and To filters are typed rather than picked from a native
// datetime-local control, which the browser paints in its own locale: a Chinese
// browser shows 年/月/日 in year-first order whatever the page declares.
//
// That makes the parser the load-bearing part. Day-first reading is the whole
// point (12/08 is August, not December), and a date that cannot be read has to
// be told apart from an empty field, because an empty field is "no filter"
// while a typo that silently became one would show the wrong runs.
//
// createDateTimeField itself needs a DOM and is not covered here.

test("parseAuDateTime reads day-first text into the value the API takes", () => {
  assert.equal(parseAuDateTime("18/08/2026 09:30"), "2026-08-18T09:30");
});

test("parseAuDateTime keeps the Australian reading of an ambiguous date", () => {
  // 12/08 is 12 August. Read month-first it would be 8 December, four months
  // out, and the filter would look like it simply matched nothing.
  assert.equal(parseAuDateTime("12/08/2026 00:00"), "2026-08-12T00:00");
});

test("parseAuDateTime treats a date with no time as midnight", () => {
  assert.equal(parseAuDateTime("18/08/2026"), "2026-08-18T00:00");
});

test("parseAuDateTime accepts single digits, hyphens and a comma", () => {
  assert.equal(parseAuDateTime("1/8/2026 9:05"), "2026-08-01T09:05");
  assert.equal(parseAuDateTime("01-08-2026"), "2026-08-01T00:00");
  assert.equal(parseAuDateTime("01/08/2026, 09:05"), "2026-08-01T09:05");
});

test("parseAuDateTime reads a blank field as no filter, not as a mistake", () => {
  assert.equal(parseAuDateTime(""), "");
  assert.equal(parseAuDateTime("   "), "");
  assert.equal(parseAuDateTime(null), "");
  assert.equal(parseAuDateTime(undefined), "");
});

test("parseAuDateTime rejects text it cannot read", () => {
  assert.equal(parseAuDateTime("2026-08-18"), null);
  assert.equal(parseAuDateTime("18 August 2026"), null);
  assert.equal(parseAuDateTime("18/08/26"), null);
  assert.equal(parseAuDateTime("yesterday"), null);
});

test("parseAuDateTime rejects a day that does not exist", () => {
  // Date rolls 31/02 forward to 3 March rather than refusing it, so a range
  // typed by mistake would otherwise select a different month.
  assert.equal(parseAuDateTime("31/02/2026"), null);
  assert.equal(parseAuDateTime("31/04/2026"), null);
  assert.equal(parseAuDateTime("29/02/2027"), null);
  assert.equal(parseAuDateTime("29/02/2028"), "2028-02-29T00:00");
});

test("parseAuDateTime rejects a time outside the 24-hour clock", () => {
  assert.equal(parseAuDateTime("18/08/2026 24:00"), null);
  assert.equal(parseAuDateTime("18/08/2026 09:60"), null);
  assert.equal(parseAuDateTime("18/08/2026 23:59"), "2026-08-18T23:59");
});

test("formatAuDateTime renders a stored value day-first", () => {
  assert.equal(formatAuDateTime("2026-08-18T09:30"), "18/08/2026 09:30");
  assert.equal(formatAuDateTime("2026-08-18T09:30:45"), "18/08/2026 09:30");
});

test("formatAuDateTime renders nothing for an absent or unreadable value", () => {
  assert.equal(formatAuDateTime(""), "");
  assert.equal(formatAuDateTime(null), "");
  assert.equal(formatAuDateTime("18/08/2026"), "");
});

test("a value survives a round trip through the field", () => {
  // What the calendar writes into the field has to read back as the same
  // filter, or picking a day would change the range it was picked for.
  const typed = "18/08/2026 09:30";

  assert.equal(formatAuDateTime(parseAuDateTime(typed)), typed);
});
