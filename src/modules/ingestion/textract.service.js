// sends a scanned PDF to Textract, one rendered page at a time 
// the loop's design is shaped almost entirely by the fact that each iteration
// spends a page of a hard 100-page monthly cap:
//
//   a throttled page is retried      being rate limited is expected when
//                                    calling in a tight loop; treating it as a
//                                    failure would discard a page that is fine
//
//   a failed page does not abort     pages 1-5 are already paid for when page 6
//                                    throws. giving up spends them for nothing
//
//   a permission error DOES abort    it will not fix itself on page two, and
//                                    twenty copies of the same error bury the
//                                    one line that explains the problem
//
//   the caller decides about caching this returns `complete`, and it is
//                                    textractCache that refuses to store an
//                                    incomplete document

import { AnalyzeDocumentCommand, DetectDocumentTextCommand } from "@aws-sdk/client-textract";

import { textractClient } from "../../config/textract.client.js";
import { blocksToPage } from "./textractBlocks.js";
import { DEFAULT_THRESHOLD, tableLikelihood } from "./tableLikelihood.js";
import {
  DEFAULT_DPI,
  countPages as defaultCountPages,
  openDocument as defaultOpenDocument,
  renderPage as defaultRenderPage,
} from "./pdfRaster.service.js";

// rate limiting, not failure. the synchronous API caps calls per second and
// this loop deliberately runs as fast as it can render.
const RETRYABLE = new Set([
  "ThrottlingException",
  "ProvisionedThroughputExceededException",
  "InternalServerError",
  "ServiceUnavailable",
]);

// wrong credentials, no permission, or an expired session. every remaining page
// would fail the same way, so the run stops on the first one.
const FATAL = new Set([
  "AccessDeniedException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "ExpiredTokenException",
  "IncompleteSignature",
  "MissingAuthenticationToken",
  // the account is not subscribed to Textract at all. observed from this
  // project's own key, and it is an account-level fact, so page two would fail
  // exactly the same way -- without this it falls through to "neither retryable
  // nor fatal", which rasterises and reports all twenty pages one at a time
  // before anyone reads the first line of the error.
  "SubscriptionRequiredException",
]);

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * sends one page's PNG and returns its blocks, retrying only what is worth
 * retrying.
 *
 * the backoff is exponential with jitter. without jitter, a throttled run
 * retries every page on the same rhythm and walks straight back into the limit
 * it just hit.
 */
async function sendWithRetry(client, buildCommand, { sleep }) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await client.send(buildCommand());
    } catch (error) {
      lastError = error;

      if (FATAL.has(error.name)) throw error;
      if (!RETRYABLE.has(error.name)) throw error;
      if (attempt === MAX_ATTEMPTS) throw error;

      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    }
  }

  throw lastError;
}

/** the expensive call: one page of the 100/month TABLES allowance. */
function analyzeOnePage(client, png, options) {
  return sendWithRetry(
    client,
    () =>
      new AnalyzeDocumentCommand({
        Document: { Bytes: png },
        // TABLES only. FORMS is billed separately and out of a different
        // allowance, and this story is about statistical tables.
        FeatureTypes: ["TABLES"],
      }),
    options,
  );
}

/**
 * the cheap call: text only, billed against a separate and far larger
 * allowance (1,000 pages a month, and roughly a tenth the price beyond it).
 *
 * it returns LINE and WORD blocks but no TABLE blocks, so on its own it reads a
 * page without ever recovering a grid. that is what makes it useful as a first
 * pass rather than a replacement -- see the two-pass branch in the loop below.
 */
function detectOnePage(client, png, options) {
  return sendWithRetry(client, () => new DetectDocumentTextCommand({ Document: { Bytes: png } }), options);
}

/**
 * builds the page source the loop reads from.
 *
 * with nothing injected this opens the document ONCE and renders every page
 * from that one handle -- the alternative, which is what this used to do, reads
 * and parses the whole PDF again for the page count and again for every single
 * page.
 *
 * the injected renderPage/countPages seam is preserved exactly as it was,
 * because it is what lets the retry and partial-failure tests run with no PDF,
 * no canvas and no bytes at all. an injected renderer means the caller is
 * standing in for the rasteriser entirely, so there is no document to open.
 */
async function openSource(filePath, { openDocument, renderPage, countPages }) {
  if (renderPage || countPages) {
    const pageCount = await (countPages ?? defaultCountPages)(filePath);
    const render = renderPage ?? defaultRenderPage;

    return {
      pageCount,
      renderPage: (pageNumber, options) => render(filePath, pageNumber, options),
      close: async () => {},
    };
  }

  return (openDocument ?? defaultOpenDocument)(filePath);
}

/**
 * extracts a whole scanned PDF.
 *
 * the AWS client and the rasteriser are injectable so the retry and
 * partial-failure behaviour can be tested without spending budget. the defaults
 * are the real ones -- nothing in the production path is a stub.
 *
 * NOTE the page count is NOT checked against the budget here. that check lives
 * in textractCache.assertBudget and is the CLI's job to call, because only the
 * CLI knows how many documents a run covers in total.
 *
 * `twoPass` puts DetectDocumentText in front of AnalyzeDocument, so only pages
 * that look like they hold a table spend the scarce TABLES allowance. it is off
 * by default: the saving is real but it rests on a heuristic, and the caller
 * should be the one deciding to trade a small risk of a missed table for four
 * times as many documents per month.
 *
 * @returns {
 *   pages,        one string per page, "" where a page failed
 *   pageModes,    "tables" | "detect" | "failed", aligned with pages
 *   tables,       every table found, each already stamped with its real page
 *   pageCount,    the document's page count
 *   pagesSent,    TABLES pages actually charged -- retries are not counted twice
 *   apiCalls,     equal to pagesSent
 *   tablePages,   same number, named for the allowance it bills
 *   detectPages,  pages charged against the SEPARATE detection allowance
 *   failures,     [{ pageNumber, error }]
 *   complete,     true only if every page came back
 *   modelVersion, what AnalyzeDocument answered with (null if it was never called)
 *   detectModelVersion, what DetectDocumentText answered with
 * }
 *
 * pagesSent/apiCalls deliberately keep their old meaning of "TABLES pages", so
 * the ledger, the telemetry figure and the evidence file all carry on measuring
 * the thing that is actually capped.
 */
export async function analyzeScannedPdf(
  filePath,
  {
    dpi = DEFAULT_DPI,
    onPage = () => {},
    onWarn = () => {},
    client = null,
    renderPage = null,
    countPages = null,
    openDocument = null,
    sleep = wait,
    twoPass = false,
    tableThreshold = DEFAULT_THRESHOLD,
  } = {},
) {
  const textract = client ?? textractClient();
  const source = await openSource(filePath, { openDocument, renderPage, countPages });
  const { pageCount } = source;

  const pages = [];
  const tables = [];
  const failures = [];
  // one entry per page, aligned with `pages`: which API actually read it.
  // "detect" means no table analysis was ever run on that page, which is a
  // thing a later run may want to go back and upgrade.
  const pageModes = [];

  let tablePages = 0;
  let detectPages = 0;
  let modelVersion = null;
  let detectModelVersion = null;

  // render-ahead, depth ONE. rasterising is CPU-bound and the request is
  // network-bound, and running them strictly in turn leaves each idle for the
  // whole of the other. one page of lookahead overlaps them without breaking
  // the memory constraint pdfRaster is designed around -- two PNGs in hand at
  // once, never a document's worth.
  //
  // the promise resolves to a SETTLED outcome rather than rejecting. a
  // prefetched page that fails to render must not become an unhandled rejection
  // while the previous page is still in flight; its error is carried forward and
  // thrown when the loop actually reaches that page, so failure behaviour is
  // exactly what it was when rendering happened in line.
  const startRender = (pageNumber) =>
    pageNumber <= pageCount
      ? source.renderPage(pageNumber, { dpi, onWarn }).then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error }),
        )
      : null;

  let pending = null;

  try {
    pending = startRender(1);

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const settled = await pending;

      // start the next page rendering BEFORE this one is sent. that ordering is
      // the entire optimisation.
      pending = startRender(pageNumber + 1);

      try {
        if (!settled.ok) throw settled.error;

        const rendered = settled.value;

        let response;
        let mode = "tables";
        let likelihood = null;

        if (twoPass) {
          // read the page on the cheap allowance first. the SAME png is reused
          // for the table call below -- rasterising is the expensive local step
          // and there is no reason to do it twice.
          const detected = await detectOnePage(textract, rendered.png, { sleep });

          detectPages += 1;
          detectModelVersion ??= detected.DetectDocumentTextModelVersion ?? null;

          likelihood = tableLikelihood(detected.Blocks ?? []);

          if (likelihood.score >= tableThreshold) {
            response = await analyzeOnePage(textract, rendered.png, { sleep });

            tablePages += 1;
            modelVersion ??= response.AnalyzeDocumentModelVersion ?? null;
          } else {
            // no table analysis on this page, so no TABLES page spent. the
            // detection blocks still carry the full text, which is what gets
            // indexed -- the page is read, just not gridded.
            mode = "detect";
            response = detected;
          }
        } else {
          response = await analyzeOnePage(textract, rendered.png, { sleep });

          // one call, one page. exact under this API rather than estimated,
          // which is what makes the ledger and the telemetry page count
          // trustworthy.
          tablePages += 1;
          modelVersion ??= response.AnalyzeDocumentModelVersion ?? null;
        }

        // the page number comes from this loop, never from the response. the
        // request carried a single image, so Textract has no way to know which
        // page of the document it was.
        //
        // this runs over either response unchanged: a detection response simply
        // has no TABLE blocks, so it yields the page's text and no tables.
        const parsed = blocksToPage(response.Blocks ?? [], pageNumber);

        pages.push(parsed.text);
        pageModes.push(mode);
        tables.push(...parsed.tables);

        onPage({
          pageNumber,
          ok: true,
          mode,
          // returned so the CLI can print WHY a page was skipped. a silent
          // filter in front of a paid API is not reviewable.
          likelihood,
          tables: parsed.tables.length,
          characters: parsed.text.length,
          lowConfidenceCells: parsed.tables.reduce((sum, table) => sum + table.lowConfidenceCells, 0),
          dpi: rendered.dpi,
        });
      } catch (error) {
        // a permission or credential problem is the same on every page. stopping
        // on the first one keeps the message visible instead of repeating it
        // twenty times.
        if (FATAL.has(error.name)) throw error;

        // an empty string rather than a missing entry, so `pages` stays aligned
        // with the document's real page numbering and page 7 is still index 6.
        pages.push("");
        pageModes.push("failed");
        failures.push({ pageNumber, error: `${error.name ?? "Error"}: ${error.message}` });

        onPage({ pageNumber, ok: false, error: error.message });
      }
    }
  } finally {
    // the in-flight prefetch has to finish before the document is closed --
    // destroying the parser underneath a running getScreenshot is a race, and on
    // the fatal-abort path there is always one still going. it never rejects, so
    // awaiting it cannot mask the error being thrown.
    await pending;
    await source.close();
  }

  return {
    filePath,
    pages,
    pageModes,
    tables,
    pageCount,
    // still the TABLES count, because that is the allowance with a hard cap and
    // the number every existing consumer of this result already means by it.
    pagesSent: tablePages,
    apiCalls: tablePages,
    tablePages,
    tableCalls: tablePages,
    // billed against the separate, far larger detection allowance. zero unless
    // twoPass was asked for.
    detectPages,
    detectCalls: detectPages,
    failures,
    dpi,
    twoPass,
    // the flag textractCache keys its refusal off. a document missing one page
    // is not a document we are willing to remember as done.
    complete: failures.length === 0 && pages.length === pageCount,
    modelVersion,
    detectModelVersion,
  };
}
