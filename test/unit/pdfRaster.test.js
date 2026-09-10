import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { countPages, openDocument, renderPage } from "../../src/modules/ingestion/pdfRaster.service.js";
import { tinyPdf } from "./helpers/tinyPdf.js";

let workDir;
let threePagePdf;

before(async () => {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pdf-raster-test-"));
  threePagePdf = path.join(workDir, "three-pages.pdf");

  await fsp.writeFile(threePagePdf, tinyPdf(3));
});

after(async () => {
  await fsp.rm(workDir, { recursive: true, force: true });
});

const PNG_MAGIC = "89504e470d0a1a0a";

describe("countPages", () => {
  it("reports how many pages a document has", async () => {
    // the budget check runs off this number before a single page is sent, so
    // reading it wrong means either over-spending or refusing a run that fits.
    assert.equal(await countPages(threePagePdf), 3);
  });
});

describe("renderPage", () => {
  it("returns real PNG bytes", async () => {
    const rendered = await renderPage(threePagePdf, 1, { dpi: 150 });

    assert.equal(Buffer.from(rendered.png.slice(0, 8)).toString("hex"), PNG_MAGIC);
  });

  it("renders the page that was asked for, not the first one", async () => {
    // pdf-parse returns the requested page as pages[0] of its result, so the
    // index into that array is 0 whichever page was asked for. reading the page
    // number off the array position would send page 1 three times.
    const rendered = await renderPage(threePagePdf, 3, { dpi: 150 });

    assert.equal(rendered.pageNumber, 3);
  });

  it("scales the raster with the requested dpi", async () => {
    // 300 dpi is the default for a reason -- scanned pages are usually 200-300
    // dpi themselves, and rendering below that throws away detail the table's
    // small print needs. this asserts the knob is actually connected.
    const low = await renderPage(threePagePdf, 1, { dpi: 72 });
    const high = await renderPage(threePagePdf, 1, { dpi: 288 });

    assert.equal(low.width, 200);
    assert.equal(high.width, 800);
  });

  it("reports integer pixel dimensions", async () => {
    // the viewport arithmetic produces fractions (833.33 at 300 dpi on a 200pt
    // page). a fractional pixel count in a log or an evidence file looks like a
    // bug in the renderer.
    const rendered = await renderPage(threePagePdf, 1, { dpi: 300 });

    assert.equal(Number.isInteger(rendered.width), true);
    assert.equal(Number.isInteger(rendered.height), true);
  });

  it("rejects a page number the document does not have", async () => {
    await assert.rejects(() => renderPage(threePagePdf, 9, { dpi: 150 }), /page 9/i);
  });
});

describe("openDocument", () => {
  it("reports the same page count as countPages", async () => {
    const doc = await openDocument(threePagePdf);

    try {
      assert.equal(doc.pageCount, await countPages(threePagePdf));
    } finally {
      await doc.close();
    }
  });

  it("renders the same bytes as the one-shot renderPage", async () => {
    // the handle exists to avoid re-parsing the document per page, NOT to
    // render differently. if these two ever diverge, the shared back-off code
    // has been forked and one of the two paths is no longer the tested one.
    const doc = await openDocument(threePagePdf);

    try {
      const viaHandle = await doc.renderPage(2, { dpi: 150 });
      const viaOneShot = await renderPage(threePagePdf, 2, { dpi: 150 });

      assert.equal(viaHandle.pageNumber, 2);
      assert.equal(viaHandle.width, viaOneShot.width);
      assert.equal(viaHandle.height, viaOneShot.height);
      assert.equal(viaHandle.dpi, viaOneShot.dpi);
      assert.deepEqual(Buffer.from(viaHandle.png), Buffer.from(viaOneShot.png));
    } finally {
      await doc.close();
    }
  });

  it("renders every page from a single open document", async () => {
    // the whole point: one parse, N pages. a handle that only worked for the
    // first page would still pass the test above.
    const doc = await openDocument(threePagePdf);

    try {
      const numbers = [];

      for (let page = 1; page <= doc.pageCount; page += 1) {
        numbers.push((await doc.renderPage(page, { dpi: 72 })).pageNumber);
      }

      assert.deepEqual(numbers, [1, 2, 3]);
    } finally {
      await doc.close();
    }
  });

  it("still rejects a page the document does not have", async () => {
    const doc = await openDocument(threePagePdf);

    try {
      await assert.rejects(() => doc.renderPage(9, { dpi: 72 }), /page 9/i);
    } finally {
      await doc.close();
    }
  });

  it("applies the dpi back-off through the handle too", async () => {
    const doc = await openDocument(threePagePdf);

    try {
      const warnings = [];
      const rendered = await doc.renderPage(1, {
        dpi: 600,
        maxBytes: 3000,
        onWarn: (message) => warnings.push(message),
      });

      assert.ok(rendered.png.length <= 3000);
      assert.ok(rendered.dpi < 600);
      assert.ok(warnings.length > 0);
    } finally {
      await doc.close();
    }
  });
});

describe("renderPage -- the 5 MB synchronous API limit", () => {
  it("drops the dpi until the image fits the byte ceiling", async () => {
    // AnalyzeDocument rejects a document over 5 MB outright. hitting that limit
    // after rendering is a wasted page of work and a confusing error, so the
    // renderer backs off on its own rather than letting the request fail.
    const warnings = [];

    const rendered = await renderPage(threePagePdf, 1, {
      dpi: 600,
      maxBytes: 3000,
      onWarn: (message) => warnings.push(message),
    });

    assert.ok(rendered.png.length <= 3000, `expected <= 3000 bytes, got ${rendered.png.length}`);
    assert.ok(rendered.dpi < 600, `expected the dpi to have been reduced, got ${rendered.dpi}`);
    assert.ok(warnings.length > 0, "reducing the dpi should say so rather than doing it silently");
  });

  it("leaves the dpi alone when the image already fits", async () => {
    const warnings = [];

    const rendered = await renderPage(threePagePdf, 1, {
      dpi: 150,
      maxBytes: 5 * 1024 * 1024,
      onWarn: (message) => warnings.push(message),
    });

    assert.equal(rendered.dpi, 150);
    assert.deepEqual(warnings, []);
  });

  it("gives up rather than looping forever on an image that will never fit", async () => {
    await assert.rejects(
      () => renderPage(threePagePdf, 1, { dpi: 300, maxBytes: 1 }),
      /could not be rendered/i,
    );
  });
});
