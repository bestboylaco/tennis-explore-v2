import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { describe, it, before } from "node:test";
import { JSDOM } from "jsdom";

import { createSourcePanel } from "../../public/scripts/ui/sourcePanel.js";

// the panel is the partner's "inspect the trail without losing your place"
// requirement, and it is the one piece of this system that cannot be checked by
// reading the backend. so it gets a real DOM.
let dom;
let panel;

function build() {
  dom = new JSDOM(
    `<body>
      <main class="workspace"><div id="conversation"></div></main>
      <aside id="source-panel" hidden>
        <h2 id="source-panel-title"></h2>
        <p id="source-panel-meta" hidden></p>
        <div id="source-panel-body"></div>
        <button id="source-panel-close"></button>
        <a id="source-panel-download"></a>
      </aside>
    </body>`,
    { url: "http://localhost:3000" },
  );

  global.document = dom.window.document;
  global.window = dom.window;

  return createSourcePanel({
    panel: dom.window.document.querySelector("#source-panel"),
    titleNode: dom.window.document.querySelector("#source-panel-title"),
    metaNode: dom.window.document.querySelector("#source-panel-meta"),
    bodyNode: dom.window.document.querySelector("#source-panel-body"),
    closeButton: dom.window.document.querySelector("#source-panel-close"),
    downloadLink: dom.window.document.querySelector("#source-panel-download"),
  });
}

before(() => {
  panel = build();
});

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

describe("source panel", () => {
  it("opens the cited page inside the app, not by navigating", () => {
    // the requirement in one assertion: an iframe, same document, chat intact.
    panel.open(pdfCitation);

    const frame = document.querySelector("#source-panel-body iframe");

    assert.ok(frame, "the source should render in an iframe");
    assert.match(frame.getAttribute("src"), /#page=7$/);
    assert.equal(document.querySelector("#conversation") !== null, true, "the conversation must still be mounted");
  });

  it("shrinks the workspace rather than covering it", () => {
    panel.open(pdfCitation);

    assert.ok(document.body.classList.contains("has-source-panel"));
  });

  it("shows what the reader needs to judge the source", () => {
    panel.open(pdfCitation);

    const meta = document.querySelector("#source-panel-meta").textContent;

    assert.match(meta, /perri-2023\.pdf/);
    assert.match(meta, /Thomas Perri/);
    assert.match(meta, /2023-01-01/);
  });

  it("starts a video at the cited second", () => {
    panel.open({
      title: "ATP rally footage",
      link: {
        href: "https://www.youtube.com/watch?v=793jVdalOI0&t=80s",
        kind: "video",
        locator: { startSeconds: 80 },
        external: true,
      },
    });

    const frame = document.querySelector("#source-panel-body iframe");

    assert.match(frame.getAttribute("src"), /youtube\.com\/embed\/793jVdalOI0\?start=80/);
  });

  it("explains itself for slides instead of showing an empty frame", () => {
    // powerpoint cannot render in a browser. saying so beats a blank box that
    // looks like a bug.
    panel.open({
      title: "Catapult NDP",
      quote: "36% of total lumbar injuries have occurred in the past 3 years.",
      link: { href: "/api/assets/catapult-ndp#slide=2", kind: "slide", locator: { slide: 2 } },
    });

    const body = document.querySelector("#source-panel-body").textContent;

    assert.match(body, /36% of total lumbar injuries/);
    assert.match(body, /cannot be displayed in a browser/);
  });

  it("shows the query behind a table answer", () => {
    panel.open({
      title: "match-data-example",
      link: { href: "/api/assets/match-data-example", kind: "table" },
      sql: "SELECT surface_c, COUNT(*) AS matches\nFROM match-data-example\nGROUP BY surface_c",
      basis: { rowsScanned: 98, rowsMatched: 97 },
    });

    const body = document.querySelector("#source-panel-body").textContent;

    assert.match(body, /GROUP BY surface_c/);
    assert.match(body, /97 of 98 rows/);
  });

  it("accepts the older citation shape too", () => {
    // the frontend was written against `url` and `excerpt`. reading both means
    // a mismatch degrades to "no preview" rather than to a button that silently
    // does nothing.
    panel.open({ title: "Old shape", excerpt: "Some quoted text.", url: "/api/assets/x" });

    assert.match(document.querySelector("#source-panel-body").textContent, /Some quoted text/);
  });

  it("refuses a javascript: url", () => {
    panel.open({ title: "Bad", quote: "text", link: { href: "javascript:alert(1)", kind: "pdf" } });

    assert.equal(document.querySelector("#source-panel-body iframe"), null);
  });

  it("closes and gives the conversation its width back", () => {
    panel.open(pdfCitation);
    panel.close();

    assert.equal(document.querySelector("#source-panel").hidden, true);
    assert.equal(document.body.classList.contains("has-source-panel"), false);
    assert.equal(document.querySelector("#source-panel-body").children.length, 0);
  });
});
