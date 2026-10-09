import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shouldBlockAnswer,
  verifyAnswer,
} from "../../src/modules/generation/verifier.service.js";
import { findUnsupportedNumbers } from "../../src/modules/retrieval/citation.service.js";

describe("semantic citation grounding", () => {
  it("rejects a citation that exists but does not support the claim", () => {
    const evidence = [
      {
        citationNumber: 3,
        chunk_id: "ao-performance-science-insights-final-round#s019",
        doc_id: "ao-performance-science-insights-final-round",
        title: "AO 2021 Final Round",
        file_name: "ao-performance-science-insights-final-round.pptx",
        slide: 19,
        section: "slide 19",
        text:
          "Best of a Bad Situation - Athlete Wellbeing w/ Ben Robertson - National Wellbeing Manager.",
        source_type: "presentation",
        sensitivity: "internal",
      },
    ];

    const answer =
      "Thomas Perri presented Best of a Bad Situation [3].";

    const verification = verifyAnswer(answer, evidence);

    assert.equal(verification.grounded, false);

    assert.ok(
      verification.warnings.some(
        (warning) => warning.kind === "citation_mismatch",
      ),
    );
  });

  it("accepts a citation that really supports the claim", () => {
    const evidence = [
      {
        citationNumber: 1,
        chunk_id: "ao2021#s003",
        doc_id: "ao2021",
        title: "AO 2021 Final Report",
        file_name: "ao2021.pptx",
        slide: 3,
        section: "slide 3",
        text:
          "Thomas Perri PhD Candidate / Sport Scientist - Best of a Bad Situation.",
        source_type: "presentation",
        sensitivity: "internal",
      },
    ];

    const answer =
      "Thomas Perri presented Best of a Bad Situation [1].";

    const verification = verifyAnswer(answer, evidence);

    assert.equal(verification.grounded, true);

    assert.equal(
      verification.warnings.some(
        (warning) => warning.kind === "citation_mismatch",
      ),
      false,
    );
  });

  it("never blocks, even on a genuine citation mismatch -- see BLOCKING_WARNING_KINDS", () => {
    // policy reversed 2026-09-17: discarding the whole answer over an
    // imperfect citation throws away real content on a question the corpus
    // may well answer. the mismatch is still detected (this test's evidence
    // matches the still-flagged warning) and shown next to the answer, it
    // just no longer replaces the answer with a refusal.
    const verification = {
      warnings: [
        {
          kind: "citation_mismatch",
          severity: "high",
          detail: "citation does not support the claim",
        },
      ],
    };

    assert.equal(shouldBlockAnswer(verification), false);
  });

  it("does not block an answer that cites nothing at all -- it is still flagged, not refused", () => {
    // "document 6" instead of "[6]" satisfies no [n] marker anywhere. this
    // is exactly the case that used to sail through with NEITHER a block NOR
    // a warning shown (the original bug); now it is flagged as "ungrounded"
    // and still shown, rather than flagged and then thrown away.
    const answer =
      "Acute workload alone showed elevated risk that disappeared in later weeks (document 6). " +
      "Chronic workload alone showed no clear relationship (document 7).";

    const verification = verifyAnswer(answer, [
      { citationNumber: 6, chunk_id: "a", text: "Acute workload showed elevated risk." },
      { citationNumber: 7, chunk_id: "b", text: "Chronic workload showed no clear relationship." },
    ]);

    assert.ok(verification.warnings.some((warning) => warning.kind === "ungrounded"));
    assert.equal(shouldBlockAnswer(verification), false);
  });

  it("does not block an answer that cites a source number that was never supplied", () => {
    const verification = verifyAnswer("Load rose sharply [9].", [
      { citationNumber: 1, chunk_id: "a", text: "Load rose sharply this season." },
    ]);

    assert.ok(verification.warnings.some((warning) => warning.kind === "dangling_citation"));
    assert.equal(shouldBlockAnswer(verification), false);
  });

  it("does not block on an unsupported-number warning alone", () => {
    const verification = {
      warnings: [{ kind: "unsupported_number", severity: "high", detail: "60" }],
    };

    assert.equal(shouldBlockAnswer(verification), false);
  });
});

describe("per-citation number grounding", () => {
  // two different documents, each reporting a different player count -- the
  // scenario that motivated this: an answer citing [1] for a number that is
  // real, but actually came from [2].
  const evidence = [
    {
      citationNumber: 1,
      chunk_id: "thesis#p53",
      doc_id: "thesis",
      title: "Redefining Movement in Professional Tennis",
      text: "155 male and 168 female athletes entered the 2021 and 2022 Australian Open.",
      source_type: "research_paper",
      sensitivity: "public",
    },
    {
      citationNumber: 2,
      chunk_id: "other-study#p12",
      doc_id: "other-study",
      title: "A Different Australian Open Study",
      text: "The analysis tracked 177 players, including 93 female and 84 male players.",
      source_type: "research_paper",
      sensitivity: "public",
    },
  ];

  it("does not flag a number that is actually in the chunk cited for it", () => {
    const verification = verifyAnswer("The study tracked 155 male athletes [1].", evidence);

    assert.deepEqual(verification.numberCitationMismatches, []);
    assert.equal(
      verification.warnings.some((warning) => warning.kind === "number_citation_mismatch"),
      false,
    );
  });

  it("flags a real number attributed to the wrong citation", () => {
    // 84 is real -- it is in chunk [2] -- but this answer cites [1] for it,
    // and chunk [1] never mentions 84. findUnsupportedNumbers alone would
    // miss this, because 84 does appear SOMEWHERE in the evidence shown to
    // the model.
    const answer = "The study tracked 84 male players [1].";

    assert.deepEqual(findUnsupportedNumbers(answer, evidence), []);

    const verification = verifyAnswer(answer, evidence);

    assert.equal(verification.numberCitationMismatches.length, 1);
    assert.deepEqual(verification.numberCitationMismatches[0].missing, ["84"]);

    assert.ok(
      verification.warnings.some((warning) => warning.kind === "number_citation_mismatch"),
    );
  });

  it("does not block the answer on a number-citation mismatch alone", () => {
    // deliberately less severe than a name mismatch -- see
    // findNumberCitationMismatches in verifier.service.js for why. a real
    // number pulled from the wrong citation should be visible, not treated
    // as confidently as an invented name.
    const answer = "The study tracked 84 male players [1].";
    const verification = verifyAnswer(answer, evidence);

    assert.equal(shouldBlockAnswer(verification), false);
  });

  it("does not flag a number that came from the question itself", () => {
    // the model honestly says the table cannot answer a question about
    // performance "at 16" -- and correctly repeats "16" from the question
    // while saying so. that is not an invented fact needing evidence; it is
    // the question's own framing.
    const rankingEvidence = [
      {
        citationNumber: 1,
        chunk_id: "rankings#1",
        doc_id: "rankings",
        title: "Rankings",
        text: "avg_singles_ranking 94.22 min_singles_ranking 72 max_singles_ranking 127",
        source_type: "table",
        sensitivity: "public",
      },
    ];

    const answer =
      "The table provides average, minimum and maximum singles rankings (94.22, 72, 127) " +
      "but does not include data linking rankings at younger ages to performance at 16 [1].";

    const verification = verifyAnswer(
      answer,
      rankingEvidence,
      "How predictable is a talented junior's performance at 16 from their ranking at younger ages?",
    );

    assert.deepEqual(verification.unsupportedNumbers, []);
    assert.deepEqual(verification.numberCitationMismatches, []);
  });

  it("recognises a real author+year named in prose as a citation, not as ungrounded", () => {
    // the model naming "Ellenbecker et al. (1999)" instead of writing "[1]"
    // is still a real, checkable citation -- it should read as a smaller
    // problem (no clickable source) than citing nothing at all.
    const dated = [
      {
        citationNumber: 1,
        chunk_id: "ellenbecker#p1",
        doc_id: "ellenbecker",
        title: "Shoulder Adaptations in Tennis Players",
        text: "Repetitive overhead loading produces measurable rotator cuff strength asymmetry.",
        authors: ["Ellenbecker"],
        date: "1999-01-01",
        source_type: "research_paper",
        sensitivity: "public",
      },
    ];

    const answer =
      "Repetitive overhead loading produces measurable rotator cuff strength asymmetry in elite players. " +
      "Ellenbecker (1999) corroborates this finding.";

    const verification = verifyAnswer(answer, dated);

    const ungrounded = verification.warnings.find((warning) => warning.kind === "ungrounded");

    assert.ok(ungrounded, "expected an ungrounded warning, since there is no [n] marker");
    assert.equal(ungrounded.severity, "medium");
    assert.equal(shouldBlockAnswer(verification), false);
  });

  it("does not flag a citation year as an unsupported figure", () => {
    // chunk.date is metadata, not something necessarily repeated in the
    // chunk's own text -- citing it correctly must not read as inventing a
    // number.
    const dated = [
      {
        citationNumber: 1,
        chunk_id: "ellenbecker#p1",
        doc_id: "ellenbecker",
        title: "Shoulder Adaptations in Tennis Players",
        text: "Repetitive overhead loading produces measurable rotator cuff strength asymmetry.",
        authors: ["Ellenbecker"],
        date: "1999-01-01",
        source_type: "research_paper",
        sensitivity: "public",
      },
    ];

    const verification = verifyAnswer("Ellenbecker (1999) reports this finding [1].", dated);

    assert.deepEqual(verification.unsupportedNumbers, []);
  });

  it("accepts a rounded figure as supported by its citation", () => {
    const preciseEvidence = [
      {
        citationNumber: 1,
        chunk_id: "stats#p1",
        doc_id: "stats",
        title: "Ranking Stats",
        text: "The average singles ranking across the squad was 94.22222222222223.",
        source_type: "table",
        sensitivity: "public",
      },
    ];

    const verification = verifyAnswer(
      "The average singles ranking is 94.22 [1].",
      preciseEvidence,
    );

    assert.deepEqual(verification.numberCitationMismatches, []);
  });
});

describe("headings and section labels are not claims", () => {
  const evidence = [
    {
      citationNumber: 3,
      chunk_id: "reid2016#p5",
      doc_id: "reid2016",
      title: "Matchplay characteristics",
      text: "Male players contact the ball at higher impact heights with greater net clearance.",
      source_type: "research_paper",
      sensitivity: "public",
    },
    {
      citationNumber: 4,
      chunk_id: "reid2016#p4",
      doc_id: "reid2016",
      title: "Matchplay characteristics",
      text: "Female players contact the ball closer to the net due to shorter reach.",
      source_type: "research_paper",
      sensitivity: "public",
    },
  ];

  it("does not treat a markdown heading as an uncited claim needing its own citation", () => {
    // the live case this was built to fix: the repair pass trying, and
    // failing, to find evidence for the literal heading text as if it were
    // a claim (reported directly, 2026-10-01).
    const answer =
      "### **1. Contact Position During Serve Returns**\n" +
      "- **Female players** contact the ball closer to the net [4].\n" +
      "- **Male players** contact the ball at higher impact heights [3].";

    const verification = verifyAnswer(answer, evidence);

    assert.equal(verification.citedFraction, 1);
    assert.deepEqual(verification.numberCitationMismatches, []);
  });

  it("does not treat a bold-only section label as an uncited claim", () => {
    const answer =
      "**Key Takeaways:**\n" +
      "- Female players contact the ball closer to the net [4].\n" +
      "1. **Spin and Technique Adaptation:**\n" +
      "- Male players contact the ball at higher impact heights [3].";

    const verification = verifyAnswer(answer, evidence);

    assert.equal(verification.citedFraction, 1);
  });

  it("still treats a bullet that leads with a bold phrase but continues with real content as a claim", () => {
    // only a line that is ENTIRELY a bold label is excluded -- a bullet
    // that leads with emphasis and then states a real fact must still be
    // checked for a citation.
    const answer =
      "- **Gender-Specific Adjustments:** women benefit from net play and spin control, unlike men.";

    const verification = verifyAnswer(answer, evidence);

    assert.equal(verification.claimCount, 1);
    assert.equal(verification.citedFraction, 0);
  });
});