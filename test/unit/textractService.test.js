import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeScannedPdf } from "../../src/modules/ingestion/textract.service.js";

// ---------------------------------------------------------------------------
// the seams
//
// this service is the only place that spends money, so the tests inject the two
// things that cost: the AWS client and the rasteriser. everything else is the
// real code path, including the block parsing.
//
// this does not weaken the acceptance evidence. the requirement that stubs are
// not sufficient is about the DELIVERED PROOF -- evidence/ comes from a real run
// against real scans. it was never a rule that the retry logic must be verified
// by actually being throttled by AWS, which is not something a test can arrange
// on demand anyway.
// ---------------------------------------------------------------------------

/** a Textract response holding one small table, as blocks. */
function tableResponse(value) {
  const word = { Id: `w-${value}`, BlockType: "WORD", Text: value, Confidence: 99 };
  const cell = {
    Id: `c-${value}`,
    BlockType: "CELL",
    RowIndex: 1,
    ColumnIndex: 1,
    Confidence: 99,
    Relationships: [{ Type: "CHILD", Ids: [word.Id] }],
  };

  return {
    AnalyzeDocumentModelVersion: "1.0",
    Blocks: [
      { Id: `l-${value}`, BlockType: "LINE", Text: `line ${value}` },
      { Id: `t-${value}`, BlockType: "TABLE", Relationships: [{ Type: "CHILD", Ids: [cell.Id] }] },
      cell,
      word,
    ],
  };
}

function awsError(name) {
  const error = new Error(name);

  error.name = name;

  return error;
}

/** a stand-in TextractClient whose send() is driven by a list of outcomes. */
function fakeClient(outcomes) {
  const calls = [];

  return {
    calls,
    async send(command) {
      calls.push(command);

      const outcome = outcomes[calls.length - 1];

      if (outcome instanceof Error) throw outcome;

      return outcome;
    },
  };
}

/** stands in for pdfRaster.renderPage -- no PDF, no canvas, no bytes. */
function fakeRender() {
  return async (_filePath, pageNumber) => ({
    png: new Uint8Array([1, 2, 3]),
    width: 100,
    height: 200,
    dpi: 300,
    pageNumber,
  });
}

function harness({ pageCount, outcomes, sleeps = [] }) {
  return {
    countPages: async () => pageCount,
    renderPage: fakeRender(),
    client: fakeClient(outcomes),
    sleep: async (ms) => sleeps.push(ms),
  };
}

describe("analyzeScannedPdf -- the happy path", () => {
  it("sends one request per page and returns a page of text for each", async () => {
    const parts = harness({ pageCount: 3, outcomes: [tableResponse("a"), tableResponse("b"), tableResponse("c")] });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(parts.client.calls.length, 3);
    assert.equal(result.pageCount, 3);
    assert.deepEqual(result.pages, ["line a", "line b", "line c"]);
    assert.equal(result.complete, true);
  });

  it("counts one page and one API call per request", async () => {
    // the billing relationship under the synchronous API. it is exact -- one
    // AnalyzeDocument call is one page -- and the telemetry page count and the
    // budget ledger both depend on it being counted here rather than guessed.
    const parts = harness({ pageCount: 2, outcomes: [tableResponse("a"), tableResponse("b")] });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(result.pagesSent, 2);
    assert.equal(result.apiCalls, 2);
  });

  it("stamps the real page number on every table it found", async () => {
    // each request carries a single image, so the response cannot know which
    // page of the document it came from. if this is wrong, every citation drawn
    // from a table points at the wrong page.
    const parts = harness({ pageCount: 3, outcomes: [tableResponse("a"), tableResponse("b"), tableResponse("c")] });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.deepEqual(
      result.tables.map((table) => table.page),
      [1, 2, 3],
    );
  });

  it("reports the model version Textract answered with", async () => {
    // first-hand proof the call was served by AWS. it is the fallback evidence
    // if CloudTrail turns out not to record AnalyzeDocument.
    const parts = harness({ pageCount: 1, outcomes: [tableResponse("a")] });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(result.modelVersion, "1.0");
  });

  it("reports progress page by page", async () => {
    const seen = [];
    const parts = harness({ pageCount: 2, outcomes: [tableResponse("a"), tableResponse("b")] });

    await analyzeScannedPdf("scan.pdf", { ...parts, onPage: (event) => seen.push(event) });

    assert.deepEqual(
      seen.map((event) => [event.pageNumber, event.ok]),
      [
        [1, true],
        [2, true],
      ],
    );
  });
});

describe("analyzeScannedPdf -- throttling", () => {
  it("backs off and retries a throttled page instead of losing it", async () => {
    // the synchronous API has a per-second call limit and this loop calls it as
    // fast as it can render. being throttled is expected, not exceptional --
    // treating it as a page failure would drop pages on a perfectly good run.
    const sleeps = [];
    const parts = harness({
      pageCount: 1,
      outcomes: [awsError("ThrottlingException"), awsError("ThrottlingException"), tableResponse("a")],
      sleeps,
    });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(result.complete, true);
    assert.deepEqual(result.pages, ["line a"]);
    assert.equal(parts.client.calls.length, 3);
  });

  it("waits longer after each throttled attempt", async () => {
    const sleeps = [];
    const parts = harness({
      pageCount: 1,
      outcomes: [awsError("ThrottlingException"), awsError("ThrottlingException"), tableResponse("a")],
      sleeps,
    });

    await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(sleeps.length, 2);
    assert.ok(sleeps[1] > sleeps[0], `expected backoff to grow, got ${sleeps.join(", ")}`);
  });

  it("retries ProvisionedThroughputExceededException the same way", async () => {
    const parts = harness({
      pageCount: 1,
      outcomes: [awsError("ProvisionedThroughputExceededException"), tableResponse("a")],
    });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(result.complete, true);
  });

  it("gives up on a page after five attempts rather than retrying forever", async () => {
    const parts = harness({
      pageCount: 1,
      outcomes: Array.from({ length: 8 }, () => awsError("ThrottlingException")),
    });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(parts.client.calls.length, 5);
    assert.equal(result.complete, false);
  });

  it("only counts a page once however many times it was retried", async () => {
    // retries are not billed pages. counting them would make the ledger
    // over-report and refuse runs that actually fit.
    const parts = harness({
      pageCount: 1,
      outcomes: [awsError("ThrottlingException"), tableResponse("a")],
    });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(result.pagesSent, 1);
  });
});

describe("analyzeScannedPdf -- partial failures", () => {
  it("keeps going after one page fails", async () => {
    // pages 1 and 3 have already been paid for by the time page 2 throws.
    // abandoning the document would waste them and would have to pay again.
    const parts = harness({
      pageCount: 3,
      outcomes: [tableResponse("a"), awsError("UnsupportedDocumentException"), tableResponse("c")],
    });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(parts.client.calls.length, 3);
    assert.deepEqual(result.pages, ["line a", "", "line c"]);
  });

  it("marks the document incomplete and names the pages that failed", async () => {
    // complete:false is what stops textractCache writing this result. the whole
    // guard depends on the flag being set here.
    const parts = harness({
      pageCount: 3,
      outcomes: [tableResponse("a"), awsError("UnsupportedDocumentException"), tableResponse("c")],
    });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(result.complete, false);
    assert.deepEqual(
      result.failures.map((failure) => failure.pageNumber),
      [2],
    );
    assert.match(result.failures[0].error, /UnsupportedDocumentException/);
  });

  it("keeps the tables from the pages that did succeed", async () => {
    const parts = harness({
      pageCount: 2,
      outcomes: [awsError("InvalidParameterException"), tableResponse("c")],
    });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(result.tables.length, 1);
    assert.equal(result.tables[0].page, 2);
  });

  it("does not count a page that failed as a page sent", async () => {
    const parts = harness({
      pageCount: 2,
      outcomes: [tableResponse("a"), awsError("UnsupportedDocumentException")],
    });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.equal(result.pagesSent, 1);
  });

  it("records a rendering failure as a page failure without calling AWS", async () => {
    // a page that will not rasterise must not be sent, and must not stop the
    // document either.
    const parts = harness({ pageCount: 2, outcomes: [tableResponse("b")] });

    const result = await analyzeScannedPdf("scan.pdf", {
      ...parts,
      renderPage: async (_filePath, pageNumber) => {
        if (pageNumber === 1) throw new Error("page 1 is corrupt");

        return { png: new Uint8Array([1]), width: 1, height: 1, dpi: 300, pageNumber };
      },
    });

    assert.equal(parts.client.calls.length, 1);
    assert.equal(result.complete, false);
    assert.match(result.failures[0].error, /corrupt/);
  });
});

describe("analyzeScannedPdf -- errors that must stop the run", () => {
  it("aborts immediately when the credentials are not allowed to call Textract", async () => {
    // a permission error is not going to fix itself on page two. carrying on
    // would print twenty identical failures and bury the one line that says
    // what is actually wrong.
    const parts = harness({
      pageCount: 20,
      outcomes: Array.from({ length: 20 }, () => awsError("AccessDeniedException")),
    });

    await assert.rejects(() => analyzeScannedPdf("scan.pdf", parts), /AccessDeniedException/);
    assert.equal(parts.client.calls.length, 1);
  });

  it("aborts when the account is not subscribed to Textract", async () => {
    // observed from this project's real key. it is an account-level fact, not a
    // per-page one, so carrying on would rasterise and report twenty pages to
    // learn the same thing twenty times.
    const parts = harness({
      pageCount: 20,
      outcomes: Array.from({ length: 20 }, () => awsError("SubscriptionRequiredException")),
    });

    await assert.rejects(
      () => analyzeScannedPdf("scan.pdf", parts),
      /SubscriptionRequiredException/,
    );
    assert.equal(parts.client.calls.length, 1);
  });

  it("aborts on an expired token rather than retrying every page", async () => {
    const parts = harness({
      pageCount: 10,
      outcomes: Array.from({ length: 10 }, () => awsError("ExpiredTokenException")),
    });

    await assert.rejects(() => analyzeScannedPdf("scan.pdf", parts));
    assert.equal(parts.client.calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// two-pass
//
// the point of this mode is that a page of prose costs a page of the 1,000/month
// detection allowance instead of a page of the 100/month TABLES one. so the
// assertions are mostly about which command was sent and what was counted --
// getting either wrong spends real, capped budget.
// ---------------------------------------------------------------------------

const commandName = (command) => command.constructor.name;

/** a DetectDocumentText response whose lines are laid out as a grid. */
function detectGridResponse() {
  const blocks = [];

  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      blocks.push({
        BlockType: "LINE",
        Text: row === 0 ? `Head${column}` : String(100 + row * 3 + column),
        Geometry: { BoundingBox: { Left: 0.1 + column * 0.25, Top: 0.1 + row * 0.05, Width: 0.12, Height: 0.02 } },
      });
    }
  }

  return { DetectDocumentTextModelVersion: "1.0", Blocks: blocks };
}

/** a DetectDocumentText response of plain running prose. */
function detectProseResponse() {
  return {
    DetectDocumentTextModelVersion: "1.0",
    Blocks: Array.from({ length: 15 }, (_, index) => ({
      BlockType: "LINE",
      Text: `an ordinary sentence of running prose number ${index}`,
      Geometry: { BoundingBox: { Left: 0.1, Top: 0.1 + index * 0.04, Width: 0.8, Height: 0.02 } },
    })),
  };
}

describe("analyzeScannedPdf -- two-pass", () => {
  it("spends no TABLES page on a page of prose", async () => {
    // the whole saving. the page is still read -- the text comes back from the
    // detection call -- it just never reaches the capped API.
    const parts = harness({ pageCount: 1, outcomes: [detectProseResponse()] });

    const result = await analyzeScannedPdf("scan.pdf", { ...parts, twoPass: true });

    assert.deepEqual(parts.client.calls.map(commandName), ["DetectDocumentTextCommand"]);
    assert.equal(result.tablePages, 0);
    assert.equal(result.pagesSent, 0, "pagesSent must keep meaning TABLES pages");
    assert.equal(result.detectPages, 1);
    assert.deepEqual(result.pageModes, ["detect"]);
    assert.match(result.pages[0], /running prose/);
  });

  it("escalates a page that looks like a table, reusing the same render", async () => {
    const parts = harness({ pageCount: 1, outcomes: [detectGridResponse(), tableResponse("a")] });

    const result = await analyzeScannedPdf("scan.pdf", { ...parts, twoPass: true });

    assert.deepEqual(parts.client.calls.map(commandName), [
      "DetectDocumentTextCommand",
      "AnalyzeDocumentCommand",
    ]);
    assert.equal(result.tablePages, 1);
    assert.equal(result.detectPages, 1);
    assert.deepEqual(result.pageModes, ["tables"]);
    assert.equal(result.tables.length, 1);
  });

  it("bills only the table pages of a mixed document", async () => {
    // three pages, one of which holds a table: one TABLES page instead of three.
    const parts = harness({
      pageCount: 3,
      outcomes: [
        detectProseResponse(),
        detectGridResponse(),
        tableResponse("b"),
        detectProseResponse(),
      ],
    });

    const result = await analyzeScannedPdf("scan.pdf", { ...parts, twoPass: true });

    assert.equal(result.tablePages, 1);
    assert.equal(result.detectPages, 3);
    assert.deepEqual(result.pageModes, ["detect", "tables", "detect"]);
    assert.equal(result.pages.length, 3);
    assert.equal(result.complete, true);
  });

  it("sends every page to TABLES when the threshold is dropped to zero", async () => {
    // the escape hatch for a document the filter should not be trusted on.
    const parts = harness({
      pageCount: 2,
      outcomes: [detectProseResponse(), tableResponse("a"), detectProseResponse(), tableResponse("b")],
    });

    const result = await analyzeScannedPdf("scan.pdf", {
      ...parts,
      twoPass: true,
      tableThreshold: 0,
    });

    assert.equal(result.tablePages, 2);
    assert.deepEqual(result.pageModes, ["tables", "tables"]);
  });

  it("counts the detection page it already paid for when the table call then fails", async () => {
    // the detect call succeeded and is billed whatever happens next. forgetting
    // it would leave the ledger under-counting a spend that really occurred.
    const parts = harness({
      pageCount: 1,
      outcomes: [detectGridResponse(), awsError("UnsupportedDocumentException")],
    });

    const result = await analyzeScannedPdf("scan.pdf", { ...parts, twoPass: true });

    assert.equal(result.detectPages, 1);
    assert.equal(result.tablePages, 0);
    assert.equal(result.complete, false);
    assert.deepEqual(result.pageModes, ["failed"]);
  });

  it("retries a throttled detection call the same way it retries a table call", async () => {
    const sleeps = [];
    const parts = harness({
      pageCount: 1,
      outcomes: [awsError("ThrottlingException"), detectProseResponse()],
      sleeps,
    });

    const result = await analyzeScannedPdf("scan.pdf", { ...parts, twoPass: true });

    assert.equal(parts.client.calls.length, 2);
    assert.equal(result.detectPages, 1, "a retried page is billed once, not twice");
    assert.equal(sleeps.length, 1);
  });

  it("aborts on a fatal error during the detection pass", async () => {
    const parts = harness({
      pageCount: 20,
      outcomes: Array.from({ length: 20 }, () => awsError("AccessDeniedException")),
    });

    await assert.rejects(
      () => analyzeScannedPdf("scan.pdf", { ...parts, twoPass: true }),
      /AccessDeniedException/,
    );
    assert.equal(parts.client.calls.length, 1);
  });

  it("reports the decision and its score for every page", async () => {
    // a filter standing in front of a capped resource has to be able to say why
    // it skipped a page, or nobody can tell a saving from a lost table.
    const events = [];
    const parts = harness({ pageCount: 1, outcomes: [detectProseResponse()] });

    await analyzeScannedPdf("scan.pdf", {
      ...parts,
      twoPass: true,
      onPage: (event) => events.push(event),
    });

    assert.equal(events[0].mode, "detect");
    assert.ok(Number.isFinite(events[0].likelihood.score));
    assert.equal(events[0].likelihood.rowLikeBands, 0);
  });

  it("leaves the single-pass path billing every page, so the default is unchanged", async () => {
    const parts = harness({ pageCount: 2, outcomes: [tableResponse("a"), tableResponse("b")] });

    const result = await analyzeScannedPdf("scan.pdf", parts);

    assert.deepEqual(parts.client.calls.map(commandName), [
      "AnalyzeDocumentCommand",
      "AnalyzeDocumentCommand",
    ]);
    assert.equal(result.tablePages, 2);
    assert.equal(result.detectPages, 0);
    assert.deepEqual(result.pageModes, ["tables", "tables"]);
  });
});
