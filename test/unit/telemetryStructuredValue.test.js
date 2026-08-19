import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderValue } from "../../public/scripts/ui/telemetry/structuredValue.js";

// The dashboard's raw-record block renders whatever shape the telemetry API
// returned, so a field added backend-side appears without a frontend change.
//
// This renderer used to be imported from the chat page's messageRenderer.js.
// When the chat UI was reskinned that module stopped exporting renderValue, and
// because a missing named export fails at module-link time rather than at call
// time, the whole telemetry page went blank -- no error on the page, just no
// script at all. The import above is the regression test for that: this file
// fails to load if the export goes away again.
//
// jsdom is skipped rather than thrown on, matching sourcePanel.test.js: a
// missing devDependency should report a skipped suite, not silently drop tests.
let JSDOM = null;

try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  JSDOM = null;
}

/*
 * createElement reads a global document, so unlike sourcePanel.test.js there is
 * nothing to hand the document to. It is assigned once and the tests only read
 * from the nodes they are given.
 */
if (JSDOM) {
  globalThis.document = new JSDOM("<!doctype html>").window.document;
}

describe("telemetry structured value", {
  skip: JSDOM ? false : "jsdom is not installed -- run npm install",
}, () => {
  it("turns an object into one field per key, with readable labels", () => {
    const result = renderValue({ runType: "query", source_id: "abc" });

    assert.equal(result.className, "structured-object");

    // camelCase splits into capitalised words; snake_case only gets its first
    // letter, so sourceId and source_id do not produce the same label. Record
    // keys are camelCase in practice, which is why that has never mattered.
    assert.deepEqual(
      [...result.querySelectorAll(".structured-field__key")]
        .map((element) => element.textContent),
      ["Run Type", "Source id"],
    );
  });

  it("keeps nested objects nested rather than stringifying them", () => {
    const result = renderValue({ stages: { retrieval: { ms: 42 } } });

    const nested = result.querySelector(
      ".structured-field__value .structured-object",
    );

    assert.ok(nested, "expected a nested object, not [object Object]");
    assert.equal(
      nested.querySelector(".structured-field__key").textContent,
      "Retrieval",
    );
  });

  it("turns an array into a list item per entry", () => {
    const result = renderValue(["alpha", "beta"]);

    assert.equal(result.tagName, "UL");
    assert.equal(result.className, "structured-list");
    assert.deepEqual(
      [...result.querySelectorAll("li")].map((item) => item.textContent),
      ["alpha", "beta"],
    );
  });

  it("says a collection is empty instead of rendering nothing", () => {
    // An empty stage map and a missing one look identical otherwise, and on a
    // debugging page that difference is often the thing being debugged.
    for (const value of [[], {}]) {
      const result = renderValue(value);

      assert.equal(result.className, "structured-value--empty");
      assert.notEqual(result.textContent.trim(), "");
    }
  });

  it("reports a null field rather than printing null", () => {
    assert.equal(renderValue(null).textContent, "No value returned.");
    assert.equal(renderValue(undefined).textContent, "No value returned.");
  });

  it("renders primitives as text, never as markup", () => {
    // The page uses no innerHTML anywhere, so a value from the database cannot
    // be interpreted as markup. This holds that line for the raw block.
    const result = renderValue("<script>alert(1)</script>");

    assert.equal(result.className, "structured-value");
    assert.equal(result.textContent, "<script>alert(1)</script>");
    assert.equal(result.querySelector("script"), null);
  });

  it("keeps falsy numbers and booleans visible", () => {
    // 0 ms and false are meaningful readings on this page, not blanks.
    assert.equal(renderValue(0).textContent, "0");
    assert.equal(renderValue(false).textContent, "false");
  });
});
