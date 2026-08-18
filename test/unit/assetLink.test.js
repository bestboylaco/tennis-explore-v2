import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAssetLink, toSeconds } from "../../src/modules/retrieval/assetLink.service.js";
import { isAbstention, renderMarkdownTable } from "../../src/modules/retrieval/answerContract.service.js";

describe("asset links", () => {
  it("opens a pdf at the cited page", () => {
    // a citation that opens a 40-page pdf at page 1 barely helps -- the reader
    // still has to find the claim, and they will not.
    const link = buildAssetLink({ doc_id: "perri2022", title: "Perri 2022", page: 7, source_uri: "/x/perri.pdf" });

    assert.equal(link.href, "/api/assets/perri2022#page=7");
    assert.equal(link.kind, "pdf");
  });

  it("opens a deck at the cited slide", () => {
    const link = buildAssetLink({ doc_id: "catapult-ndp", title: "Catapult", slide: 12, source_uri: "/x/d.pptx" });

    assert.equal(link.href, "/api/assets/catapult-ndp#slide=12");
    assert.equal(link.kind, "slide");
  });

  it("opens a video at the cited second, on its own url", () => {
    const link = buildAssetLink({
      doc_id: "video-segments",
      modality: "media",
      title: "ATP rally",
      start_time: "1:20",
      external_url: "https://www.youtube.com/watch?v=abc",
    });

    assert.equal(link.href, "https://www.youtube.com/watch?v=abc&t=80s");
    assert.equal(link.external, true);
  });

  it("tells the frontend to open beside the chat, not navigate away", () => {
    assert.equal(buildAssetLink({ doc_id: "d", title: "t", source_uri: "/x.pdf" }).target, "side_panel");
  });

  it("parses timestamps in the formats sources actually use", () => {
    assert.equal(toSeconds("1:20"), 80);
    assert.equal(toSeconds("1:01:05"), 3665);
    assert.equal(toSeconds(45), 45);
    assert.equal(toSeconds(""), null);
  });
});

describe("abstention detection", () => {
  it("recognises the sentence we asked for", () => {
    assert.equal(isAbstention("The knowledge base does not contain an answer to this question."), true);
  });

  it("recognises a paraphrase of it", () => {
    // small models paraphrase instructions even when told not to. treating a
    // paraphrased refusal as a real answer would score an honest abstention as
    // a hallucination.
    assert.equal(isAbstention("I cannot answer this question from the available evidence."), true);
  });

  it("does not mistake a real answer for a refusal", () => {
    assert.equal(isAbstention("Accelerometer load was highest in official matches [1]."), false);
  });
});

describe("table rendering", () => {
  it("rounds long decimals and marks nulls", () => {
    const markdown = renderMarkdownTable(["surface", "avg"], [{ surface: "Hard", avg: 99.044117 }, { surface: "Clay", avg: null }]);

    assert.match(markdown, /99\.04/);
    assert.match(markdown, /—/);
  });

  it("says so when it truncates", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({ n: index }));

    assert.match(renderMarkdownTable(["n"], rows), /Showing 25 of 40 rows/);
  });
});
