import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bindCitations,
  extractCitationMarkers,
  findUnsupportedNumbers,
} from "../../src/modules/retrieval/citation.service.js";

const evidence = [
  {
    citationNumber: 1,
    chunk_id: "perri2022#p4",
    doc_id: "perri2022",
    title: "Tennis serve volume",
    text: "Official matches showed the highest accelerometer load, 24% above training.",
    page: 4,
    authors: ["Thomas Perri"],
    event_date: "2022-01-01",
    source_type: "research_paper",
    sensitivity: "public",
    foundBy: ["bm25", "dense"],
  },
];

describe("citation binding", () => {
  it("binds a marker back to the chunk it names", () => {
    const bound = bindCitations("Load was higher in matches [1].", evidence);

    assert.equal(bound.citations.length, 1);
    assert.equal(bound.citations[0].chunkId, "perri2022#p4");
    assert.equal(bound.citations[0].page, 4);
    assert.equal(bound.grounded, true);
  });

  it("reports a citation the model invented", () => {
    // a model writing [7] when it was given one chunk is a model that stopped
    // reading the evidence. silently dropping the marker would hide that.
    const bound = bindCitations("Load rose [1]. Recovery fell [7].", evidence);

    assert.deepEqual(bound.dangling, [7]);
    assert.equal(bound.grounded, false);
  });

  it("is not grounded when the model cited nothing at all", () => {
    const bound = bindCitations("Load was higher in matches.", evidence);

    assert.equal(bound.citations.length, 0);
    assert.equal(bound.grounded, false);
  });

  it("reports evidence the model never used", () => {
    const twoChunks = [...evidence, { ...evidence[0], citationNumber: 2, chunk_id: "other#p1" }];
    const bound = bindCitations("Only the first mattered [1].", twoChunks);

    assert.deepEqual(bound.unusedEvidence, [2]);
  });

  it("does not count the same marker twice", () => {
    assert.deepEqual(extractCitationMarkers("a [1] b [1] c [2]"), [1, 2]);
  });
});

describe("unsupported numbers", () => {
  it("flags a figure that appears in no source", () => {
    assert.deepEqual(findUnsupportedNumbers("Load rose 60% [1].", evidence), ["60"]);
  });

  it("accepts a figure that is in the evidence", () => {
    assert.deepEqual(findUnsupportedNumbers("Load rose 24% [1].", evidence), []);
  });

  it("ignores citation markers themselves", () => {
    // [1] must not be read as the number 1 appearing in the answer.
    assert.deepEqual(findUnsupportedNumbers("As shown [1].", evidence), []);
  });
});
