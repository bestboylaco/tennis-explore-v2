import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bindCitations,
  cleanTitle,
  consolidateRepeatedCitations,
  extractCitationMarkers,
  findUnsupportedNumbers,
  normaliseCitationPhrasing,
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

describe("normalising citation phrasing", () => {
  it("converts a trailing bracketed sources list", () => {
    assert.equal(
      normaliseCitationPhrasing("The ratio matters most. [Sources: 4, 6]"),
      "The ratio matters most. [4][6]",
    );
  });

  it("converts a trailing parenthesised sources list", () => {
    assert.equal(
      normaliseCitationPhrasing("The ratio matters most. (Sources: 4 and 6)"),
      "The ratio matters most. [4][6]",
    );
  });

  it("converts 'evidence block N' inline", () => {
    assert.equal(
      normaliseCitationPhrasing("This is the danger zone (evidence block 6)."),
      "This is the danger zone ([6]).",
    );
  });

  it("converts 'sources N and M' inline", () => {
    assert.equal(
      normaliseCitationPhrasing("Winners hit faster serves (sources 6 and 9)."),
      "Winners hit faster serves ([6][9]).",
    );
  });

  it("converts 'document N' inline", () => {
    assert.equal(
      normaliseCitationPhrasing("This is discussed further (document 8)."),
      "This is discussed further ([8]).",
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "Load rose 24% [1]. Nothing else changed.";

    assert.equal(normaliseCitationPhrasing(text), text);
  });

  it("converts a trailing unbracketed 'Sources:' recap line", () => {
    assert.equal(
      normaliseCitationPhrasing("Some answer text [3][7].\n\n**Sources**: 3, 5, 6, 7."),
      "Some answer text [3][7].\n\n[3][5][6][7]",
    );
  });

  it("leaves the word 'sources' alone when it is not a trailing list", () => {
    const text = "Plain text with sources mentioned mid-sentence stays alone.";

    assert.equal(normaliseCitationPhrasing(text), text);
  });

  it("converts bracketed 'Evidence N' without doubling the brackets", () => {
    assert.equal(
      normaliseCitationPhrasing("This is stated in [Evidence 1] and clarified in [Evidence 5]."),
      "This is stated in [1] and clarified in [5].",
    );
  });
});

describe("unsupported numbers", () => {
  it("flags a figure that appears in no source", () => {
    assert.deepEqual(findUnsupportedNumbers("Load rose 60% [1].", evidence), ["60%"]);
  });

  it("flags a figure whose only source glues a unit straight onto the number", () => {
    // "≈900m" in source prose -- no space before the unit letter -- must
    // still register as the value 900, or a real figure with exactly this
    // number reads as unsupported (observed live, 2026-09-18).
    const gluedEvidence = [
      { ...evidence[0], text: "The ≈900m disparity between players was notable." },
    ];

    assert.deepEqual(findUnsupportedNumbers("The gap was 900 metres [1].", gluedEvidence), []);
  });

  it("accepts a figure that is in the evidence", () => {
    assert.deepEqual(findUnsupportedNumbers("Load rose 24% [1].", evidence), []);
  });

  it("ignores citation markers themselves", () => {
    // [1] must not be read as the number 1 appearing in the answer.
    assert.deepEqual(findUnsupportedNumbers("As shown [1].", evidence), []);
  });
});

describe("cleaning a contaminated title", () => {
  it("strips ResearchGate's cover-page boilerplate, keeping the real title", () => {
    const raw =
      "See discussions, stats, and author profiles for this publication at: " +
      "http://www.researchgate.net/publication/283317827 The acute:chronic workload ratio predicts";

    assert.equal(cleanTitle(raw), "The acute:chronic workload ratio predicts");
  });

  it("leaves an ordinary title untouched", () => {
    assert.equal(cleanTitle("Serve Kinematics Study"), "Serve Kinematics Study");
  });

  it("falls back to the original text if nothing is left after stripping", () => {
    const boilerplateOnly =
      "See discussions, stats, and author profiles for this publication at: http://example.com/x";

    assert.equal(cleanTitle(boilerplateOnly), boilerplateOnly);
  });
});

describe("consolidating repeated citations within one paragraph", () => {
  it("keeps only the last occurrence of a reference repeated in one sentence", () => {
    const answer =
      "In racquet sports, fatigue manifests as slower reaction times [4], reduced grip " +
      "strength [4], and worse shot accuracy [4].";

    assert.equal(
      consolidateRepeatedCitations(answer),
      "In racquet sports, fatigue manifests as slower reaction times, reduced grip " +
        "strength, and worse shot accuracy [4].",
    );
  });

  it("collapses the same reference repeated across sentences in one paragraph", () => {
    // the live case this widened from sentence- to paragraph-scope to fix:
    // one source, restated three times across three consecutive sentences.
    const answer =
      "Players typically remain inactive for a median of 32.0 days [6]. This is based on " +
      "the study's analysis of medical conditions [6]. Specific examples include periods " +
      "of 33, 211 and 297 days [6].";

    assert.equal(
      consolidateRepeatedCitations(answer),
      "Players typically remain inactive for a median of 32.0 days. This is based on " +
        "the study's analysis of medical conditions. Specific examples include periods " +
        "of 33, 211 and 297 days [6].",
    );
  });

  it("does not touch the same reference repeated across different paragraphs", () => {
    const answer = "Load rose 24% [1].\n\nRecovery also improved this week [1]. A separate claim [2] closes it out.";

    assert.equal(consolidateRepeatedCitations(answer), answer);
  });

  it("leaves distinct references in the same sentence alone", () => {
    const answer = "Two sources agree on this point [5][7].";

    assert.equal(consolidateRepeatedCitations(answer), answer);
  });

  it("keeps each bullet independently cited even when they share a source", () => {
    // a list item is its own scannable, checkable claim -- collapsing a
    // citation out of an earlier bullet because a later one repeats the
    // same source would make that earlier bullet look unsupported on its
    // own, undoing the bulleted structure asked for elsewhere.
    const answer = "- First point from the study [3]\n- Second point from the same study [3]\n- Third point [3]";

    assert.equal(consolidateRepeatedCitations(answer), answer);
  });
});
