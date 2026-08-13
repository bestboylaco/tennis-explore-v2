import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSourcePanel } from "../../public/scripts/ui/sourcePanel.js";

// jsdom is a devDependency, and a teammate who cloned before it was added --
// or whose install of it failed -- should get a skipped suite with a clear
// reason, not a whole test file that errors on load and silently removes nine
// tests from the run. that is exactly what happened: the suite reported 104
// passing instead of 112 and looked healthy.
let JSDOM = null;

try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  JSDOM = null;
}

const MARKUP = `<body>
  <main class="workspace"><div id="conversation"></div></main>
  <aside id="source-panel" hidden>
    <h2 id="source-panel-title"></h2>
    <p id="source-panel-meta" hidden></p>
    <div id="source-panel-body"></div>
    <button id="source-panel-close"></button>
    <a id="source-panel-download"></a>
  </aside>
</body>`;

/**
 * a fresh panel and document per test.
 *
 * nothing is assigned to globalThis. the panel derives its document from the
 * element it was handed, which is what makes this work identically on every
 * platform and inside an iframe.
 */
function mount() {
  const dom = new JSDOM(MARKUP, { url: "http://localhost:3000" });
  const { document } = dom.window;
  const $ = (selector) => document.querySelector(selector);

  const panel = createSourcePanel({
    panel: $("#source-panel"),
    titleNode: $("#source-panel-title"),
    metaNode: $("#source-panel-meta"),
    bodyNode: $("#source-panel-body"),
    closeButton: $("#source-panel-close"),
    downloadLink: $("#source-panel-download"),
  });

  return { panel, document, $ };
}

const pdfCitation = {
  number: 1,
  title: "Macro-periodisation of competition",
  fileName: "perri-2023.pdf",
  quote: "Competition density peaked in the third block.",
  authors: ["Thomas Perri"],
  date: "2023-01-01",
  sensitivity: "public",
  link: {
    href: "/api/assets/perri-2023#page=7",
    kind: "pdf",
    label: "Macro-periodisation of competition, page 7",
    locator: { page: 7 },
    external: false,
  },
};

describe("source panel", { skip: JSDOM ? false : "jsdom is not installed -- run npm install" }, () => {
  it("opens the cited page inside the app, not by navigating", () => {
    // the partner's requirement in one assertion: an iframe at the cited page,
    // and the conversation still mounted behind it.
    const { panel, $ } = mount();

    panel.open(pdfCitation);

    const frame = $("#source-panel-body iframe");

    assert.ok(frame, "the source should render in an iframe");
    assert.match(frame.getAttribute("src"), /#page=7$/);
    assert.ok($("#conversation"), "the conversation must still be mounted");
  });

  it("shrinks the workspace rather than covering it", () => {
    const { panel, document } = mount();

    panel.open(pdfCitation);

    assert.ok(document.body.classList.contains("has-source-panel"));
  });

  it("shows what the reader needs to judge the source", () => {
    const { panel, $ } = mount();

    panel.open(pdfCitation);

    const meta = $("#source-panel-meta").textContent;

    assert.match(meta, /perri-2023\.pdf/);
    assert.match(meta, /Thomas Perri/);
    assert.match(meta, /2023-01-01/);
  });

  it("starts a video at the cited second", () => {
    const { panel, $ } = mount();

    panel.open({
      title: "ATP rally footage",
      link: {
        href: "https://www.youtube.com/watch?v=793jVdalOI0&t=80s",
        kind: "video",
        locator: { startSeconds: 80 },
        external: true,
      },
    });

    assert.match($("#source-panel-body iframe").getAttribute("src"), /embed\/793jVdalOI0\?start=80/);
  });

  it("explains itself for slides instead of showing an empty frame", () => {
    // powerpoint cannot render in a browser. saying so beats a blank box that
    // looks like a bug.
    const { panel, $ } = mount();

    panel.open({
      title: "Catapult NDP",
      quote: "36% of total lumbar injuries have occurred in the past 3 years.",
      link: { href: "/api/assets/catapult-ndp#slide=2", kind: "slide", locator: { slide: 2 } },
    });

    const body = $("#source-panel-body").textContent;

    assert.match(body, /36% of total lumbar injuries/);
    assert.match(body, /cannot be displayed in a browser/);
  });

  it("shows the query behind a table answer", () => {
    const { panel, $ } = mount();

    panel.open({
      title: "match-data-example",
      link: { href: "/api/assets/match-data-example", kind: "table" },
      sql: "SELECT surface_c, COUNT(*) AS matches\nFROM match-data-example\nGROUP BY surface_c",
      basis: { rowsScanned: 98, rowsMatched: 97 },
    });

    const body = $("#source-panel-body").textContent;

    assert.match(body, /GROUP BY surface_c/);
    assert.match(body, /97 of 98 rows/);
  });

  it("accepts the older citation shape too", () => {
    // the frontend was written against `url` and `excerpt`. reading both means
    // a mismatch degrades to "no preview" rather than to a citation button that
    // silently does nothing.
    const { panel, $ } = mount();

    panel.open({ title: "Old shape", excerpt: "Some quoted text.", url: "/api/assets/x" });

    assert.match($("#source-panel-body").textContent, /Some quoted text/);
  });

  it("refuses a javascript: url", () => {
    const { panel, $ } = mount();

    panel.open({ title: "Bad", quote: "text", link: { href: "javascript:alert(1)", kind: "pdf" } });

    assert.equal($("#source-panel-body iframe"), null);
  });

  it("closes and gives the conversation its width back", () => {
    const { panel, document, $ } = mount();

    panel.open(pdfCitation);
    panel.close();

    assert.equal($("#source-panel").hidden, true);
    assert.equal(document.body.classList.contains("has-source-panel"), false);
    assert.equal($("#source-panel-body").children.length, 0);
  });
});
