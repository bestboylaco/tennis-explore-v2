import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bindCitations,
  cleanTitle,
  consolidateRepeatedCitations,
  extractCitationMarkers,
  findUnsupportedNumbers,
  normaliseCitationPhrasing,
  stripTrailingReferenceList,
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
  // every case here is now recognised by SHAPE (a delimited number or
  // number-list, with at most a couple of leading words) rather than by
  // matching a known word -- see the comment on normaliseCitationPhrasing.
  // the surrounding "(" ")" is consumed along with the word+number inside
  // it, not kept: the frontend's in-text citation rendering adds its own
  // parentheses around the APA text, so keeping the source text's parens
  // too would double them up ("((Author, Year))").

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

  it("converts 'evidence block N' inline, dropping the parentheses", () => {
    assert.equal(
      normaliseCitationPhrasing("This is the danger zone (evidence block 6)."),
      "This is the danger zone [6].",
    );
  });

  it("converts 'sources N and M' inline", () => {
    assert.equal(
      normaliseCitationPhrasing("Winners hit faster serves (sources 6 and 9)."),
      "Winners hit faster serves [6][9].",
    );
  });

  it("converts 'document N' inline", () => {
    assert.equal(
      normaliseCitationPhrasing("This is discussed further (document 8)."),
      "This is discussed further [8].",
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

  it("converts 'citation N' and 'citation N, M' inline", () => {
    // the live case this whole generalisation was built to fix, 2026-10-01:
    // not just left uncited -- the bare number inside "(citation 10)" was
    // then also read as an unverified data figure, since nothing
    // recognised it as a citation reference at all.
    assert.equal(
      normaliseCitationPhrasing("Use hip rotation (citation 10) to generate power."),
      "Use hip rotation [10] to generate power.",
    );

    assert.equal(
      normaliseCitationPhrasing("Broader court coverage and aggressive play (citation 1, 4)."),
      "Broader court coverage and aggressive play [1][4].",
    );
  });

  it("converts a word it has never been told about, by shape, not by name", () => {
    // the point of the generalisation: a future synonym should not need
    // its own fix. "ref" and "see" are not in any word list anywhere in
    // this file.
    assert.equal(
      normaliseCitationPhrasing("Use hip rotation (ref 10) to generate power."),
      "Use hip rotation [10] to generate power.",
    );

    assert.equal(
      normaliseCitationPhrasing("Use hip rotation (see 10) to generate power."),
      "Use hip rotation [10] to generate power.",
    );
  });

  it("converts a bare parenthesised number with no word at all", () => {
    assert.equal(
      normaliseCitationPhrasing("A bare parenthetical number (10) works too."),
      "A bare parenthetical number [10] works too.",
    );
  });

  it("converts a two-word lead-in before the number", () => {
    assert.equal(
      normaliseCitationPhrasing("Use hip rotation (per study 10) to generate power."),
      "Use hip rotation [10] to generate power.",
    );
  });

  it("leaves the word 'sources' alone when it is not a trailing list", () => {
    const text = "Plain text with sources mentioned mid-sentence stays alone.";

    assert.equal(normaliseCitationPhrasing(text), text);
  });

  it("does not touch an ordinary parenthetical with no number in it", () => {
    const text = "This was a notable result (as expected).";

    assert.equal(normaliseCitationPhrasing(text), text);
  });

  it("leaves a plain score or count alone", () => {
    const text = "He lost in straight sets, 6-3 6-4.";

    assert.equal(normaliseCitationPhrasing(text), text);
  });

  it("converts bracketed 'Evidence N' without doubling the brackets", () => {
    assert.equal(
      normaliseCitationPhrasing("This is stated in [Evidence 1] and clarified in [Evidence 5]."),
      "This is stated in [1] and clarified in [5].",
    );
  });
});

describe("stripping a trailing self-generated reference list", () => {
  it("removes a trailing block of '[n]: description' lines, however it is introduced", () => {
    const answer =
      "Main answer text [2][3].\n\n---\n**Citations**:\n" +
      "- [2]: Female players contact the ball closer to the net.\n" +
      "- [3]: Male players recalibrate their impact point.";

    assert.equal(stripTrailingReferenceList(answer), "Main answer text [2][3].");
  });

  it("removes the block even with a different heading word and no divider", () => {
    const answer = "Main answer text [2].\n\nReferences:\n[2]: Some description.\n[4]: Another one.";

    assert.equal(stripTrailingReferenceList(answer), "Main answer text [2].");
  });

  it("leaves a normal answer with a genuine mid-sentence citation alone", () => {
    const answer = "A real sentence that happens to cite [3] mid-paragraph, nothing to strip.";

    assert.equal(stripTrailingReferenceList(answer), answer);
  });

  it("does not strip a single trailing citation line -- only a real list of two or more", () => {
    const answer = "Main text here.\n\n[3]: just one line, not a list.";

    assert.equal(stripTrailingReferenceList(answer), answer);
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

  it("removes the marker's own enclosing parens too, rather than leaving a hollow '()'", () => {
    // live case, 2026-10-01: the model wrote its own "(" ")" around a "[n]"
    // marker ("... serve speed ([4]). ... racquet head speed ([7]).",
    // [4] and [7] being page-chunks of one paper). collapsing the repeated
    // first occurrence used to remove only the "[4]" inside, leaving an
    // empty "()" sitting in the sentence where a citation used to be --
    // exactly the "stopped citing" failure this whole feature exists to
    // prevent, just self-inflicted by the collapse step instead of the model.
    const answer =
      "Males show greater explosive power, which influences serve speed ([4]). " +
      "This is tied to rotation strength, critical for racquet head speed ([7]).";
    const citations = [
      { number: 4, docId: "reid2016" },
      { number: 7, docId: "reid2016" },
    ];

    assert.equal(
      consolidateRepeatedCitations(answer, citations),
      "Males show greater explosive power, which influences serve speed. " +
        "This is tied to rotation strength, critical for racquet head speed ([7]).",
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

  it("collapses two different marker numbers that are the same document at different pages", () => {
    // the live case this was extended to catch: [6] and [7] are different,
    // valid markers, but both page-level chunks of one paper -- shown in
    // APA short form with no page number, they read as the same citation
    // repeated, which is exactly what this is meant to fix.
    const answer =
      "This is based on the study's analysis of medical conditions [6]. Specific examples " +
      "include periods of 33, 211 and 297 days [7].";

    const citations = [
      { number: 6, docId: "epidemiology-of-tennis-injuries" },
      { number: 7, docId: "epidemiology-of-tennis-injuries" },
    ];

    assert.equal(
      consolidateRepeatedCitations(answer, citations),
      "This is based on the study's analysis of medical conditions. Specific examples " +
        "include periods of 33, 211 and 297 days [7].",
    );
  });

  it("leaves two different markers alone when they are genuinely different documents", () => {
    const answer = "One study found X [6]. A separate study found Y [7].";

    const citations = [
      { number: 6, docId: "paper-one" },
      { number: 7, docId: "paper-two" },
    ];

    assert.equal(consolidateRepeatedCitations(answer, citations), answer);
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
