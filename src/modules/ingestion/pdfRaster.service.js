// renders one PDF page to a PNG (TENISE-12 / E2-06).
//
// the synchronous AnalyzeDocument API does not accept a multi-page PDF. it
// takes one image, or a single-page PDF, as raw bytes -- so a twenty-page
// scanned document has to become twenty PNGs before any of it can be analysed.
// that conversion is this file.
//
// it needs no new dependency. pdf-parse is already here for text extraction and
// ships @napi-rs/canvas, which means the whole rasterisation path is Node --
// no poppler (pdftoppm is not even on PATH on this machine, only pdftotext),
// no Python, no ImageMagick. one language for the whole pipeline.
//
// one page at a time, on purpose. indexBuilder.service.js streams file by file
// specifically so peak memory does not grow with the corpus, and holding a
// whole document's worth of 300 dpi bitmaps would undo that in one step -- a
// twenty-page scan at 300 dpi is around 8 MB of PNG and far more decoded.

import fsp from "node:fs/promises";

// scanned documents are typically captured at 200-300 dpi. rendering below that
// downsamples the scan itself, and this story is graded on 95% cell accuracy --
// table small print is exactly what goes first. 300 dpi costs roughly 400 KB a
// page, nowhere near the API's 5 MB ceiling, so there is nothing to buy by
// going lower.
export const DEFAULT_DPI = Number(process.env.TEXTRACT_DPI ?? 300);

// AnalyzeDocument rejects anything over 5 MB. we aim below it rather than at
// it, because the limit applies to the encoded request and being refused costs
// a round trip and an unhelpful error.
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

// PDF user space is 72 units to the inch, so this is the whole of the dpi
// conversion: a scale of 1 renders at 72 dpi.
const PDF_UNITS_PER_INCH = 72;

/**
 * opens a document, runs `work`, and always closes it.
 *
 * pdf-parse starts a worker thread that is not tied to the object's lifetime.
 * without destroy() the process finishes its work and then sits there refusing
 * to exit -- already learned once in extraction.service.js, and a CLI that
 * hangs after printing "done" is a bug someone will spend an hour on.
 */
async function withDocument(filePath, work) {
  const { PDFParse } = await import("pdf-parse");

  const buffer = await fsp.readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    return await work(parser);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * opens a document ONCE and hands back a handle to render from.
 *
 * this exists because opening is not cheap and was being paid per page. every
 * entry point here used to go through withDocument, which reads the whole file
 * into memory, starts a worker and parses the document from scratch -- and
 * renderPage then asked for getInfo() again on top. a twenty-page scan cost
 * twenty-two complete parses to produce twenty images: one for the CLI's page
 * count, one for the analyser's, and one per rendered page. none of that work
 * differs between calls.
 *
 * the handle keeps a single parser alive across the whole page loop, so the
 * document is read once and the page count is read once. it does NOT hold
 * rendered pages -- peak memory is still one page's bitmap, which is the
 * constraint the top of this file is written around.
 *
 * the caller owns the handle and MUST close() it, otherwise the worker thread
 * keeps the process alive after the command has printed its summary.
 *
 * @returns { pageCount, renderPage(pageNumber, options), close() }
 */
export async function openDocument(filePath) {
  const { PDFParse } = await import("pdf-parse");

  const buffer = await fsp.readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  let pageCount;

  try {
    pageCount = (await parser.getInfo()).total;
  } catch (error) {
    // a document that will not report its own page count is unusable, and
    // leaking its worker would hang whatever called us.
    await parser.destroy().catch(() => {});
    throw error;
  }

  return {
    pageCount,
    renderPage: (pageNumber, options) => renderWithParser(parser, filePath, pageNumber, pageCount, options),
    close: () => parser.destroy().catch(() => {}),
  };
}

/**
 * how many pages a document has.
 *
 * read before anything is sent, because the budget check needs the page count
 * and the whole point of the budget check is that it happens first.
 */
export async function countPages(filePath) {
  return withDocument(filePath, async (parser) => (await parser.getInfo()).total);
}

/**
 * renders one page to PNG bytes.
 *
 * the dpi back-off is the interesting part. a page that renders over the API's
 * size limit is not a failure we should discover from AWS -- the request is
 * refused, the round trip is wasted, and the error names a byte count rather
 * than a page. so the renderer measures its own output and re-renders smaller
 * until it fits, saying so each time. a page that cannot fit even at minimum
 * throws here, before anything is sent and before anything is billed.
 *
 * @returns { png, width, height, dpi, pageNumber } -- dpi is what was ACTUALLY
 *          used, which is not always what was asked for.
 */
export async function renderPage(filePath, pageNumber, options = {}) {
  return withDocument(filePath, async (parser) => {
    const total = (await parser.getInfo()).total;

    return renderWithParser(parser, filePath, pageNumber, total, options);
  });
}

/**
 * the actual rasterisation, against an already-open parser.
 *
 * split out so openDocument's handle and the one-shot renderPage above run the
 * exact same code -- the dpi back-off is the part that must not exist twice.
 * `total` is passed in rather than read here, because on the handle it was
 * already read once when the document was opened.
 */
async function renderWithParser(
  parser,
  filePath,
  pageNumber,
  total,
  { dpi = DEFAULT_DPI, maxBytes = DEFAULT_MAX_BYTES, onWarn = () => {} } = {},
) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > total) {
    throw new Error(`page ${pageNumber} does not exist -- the document has ${total} page(s).`);
  }

  let currentDpi = dpi;

  // bounded rather than `while (true)`. each attempt is a full rasterisation,
  // and a runaway loop on a pathological page would burn minutes silently.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await parser.getScreenshot({
      // one page. `partial` takes an array of page numbers and returns them
      // in that order, so the result always has exactly one entry.
      partial: [pageNumber],
      imageBuffer: true,
      // the data URL is base64 of the same image -- a third again as much
      // memory for something nothing here reads.
      imageDataUrl: false,
      scale: currentDpi / PDF_UNITS_PER_INCH,
    });

    const page = result.pages[0];

    if (!page?.data) {
      throw new Error(`page ${pageNumber} of ${filePath} produced no image data.`);
    }

    if (page.data.length <= maxBytes) {
      return {
        png: page.data,
        // the viewport arithmetic yields fractions; a fractional pixel count
        // in a log reads as a rendering bug.
        width: Math.round(page.width),
        height: Math.round(page.height),
        dpi: currentDpi,
        // from the argument, not from the array position: `partial` returns
        // the requested page as pages[0] whichever page it is, so trusting
        // the index would label every page as page 1.
        pageNumber,
      };
    }

    // a raster's byte count scales with its AREA, so with the square of the
    // dpi. taking the square root of the overshoot lands close to the target
    // in one step, where a fixed percentage step would creep down toward it
    // over many full re-rasterisations. the 0.95 is headroom, because PNG
    // compression is not perfectly proportional to pixel count; the 0.75 cap
    // guarantees the loop always makes progress even if the estimate is off.
    const estimated = Math.floor(currentDpi * Math.sqrt(maxBytes / page.data.length) * 0.95);
    const reduced = Math.min(estimated, Math.floor(currentDpi * 0.75));

    // below this the small print in a table is unreadable and there is no
    // point spending a page of budget to find that out.
    if (reduced < 100) break;

    onWarn(
      `page ${pageNumber} rendered to ${(page.data.length / 1048576).toFixed(1)} MB at ` +
        `${currentDpi} dpi, over the ${(maxBytes / 1048576).toFixed(1)} MB request limit -- ` +
        `re-rendering at ${reduced} dpi.`,
    );

    currentDpi = reduced;
  }

  throw new Error(
    `page ${pageNumber} of ${filePath} could not be rendered under ${(maxBytes / 1048576).toFixed(1)} MB ` +
      `at a dpi high enough to read a table. nothing was sent to Textract.`,
  );
}
