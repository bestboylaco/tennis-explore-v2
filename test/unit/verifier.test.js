import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shouldBlockAnswer,
  verifyAnswer,
} from "../../src/modules/generation/verifier.service.js";

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

  it("blocks an answer when citation verification finds a mismatch", () => {
    const verification = {
      warnings: [
        {
          kind: "citation_mismatch",
          severity: "high",
          detail: "citation does not support the claim",
        },
      ],
    };

    assert.equal(shouldBlockAnswer(verification), true);
  });
});