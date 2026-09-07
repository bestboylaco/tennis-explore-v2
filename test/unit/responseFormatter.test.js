import test from "node:test";
import assert from "node:assert/strict";

import {
  formatIntelligenceResponse,
} from "../../src/modules/response/responseFormatter.service.js";


const TEST_DATE =
  new Date(
    "2026-08-31T09:00:00.000Z",
  );


const EXPECTED_SECTION_ORDER = [
  "summary",
  "sources",
  "date",
  "explanation",
];


function getSection(
  response,
  sectionId,
) {
  return response.sections.find(
    (section) =>
      section.id === sectionId,
  );
}


function assertFixedTemplate(
  response,
) {
  assert.equal(
    response.contractVersion,
    2,
  );

  assert.equal(
    response.sections.length,
    4,
  );

  assert.deepEqual(
    response.sections.map(
      (section) =>
        section.id,
    ),
    EXPECTED_SECTION_ORDER,
  );

  assert.deepEqual(
    response.sections.map(
      (section) =>
        section.title,
    ),
    [
      "Summary",
      "Sources",
      "Date",
      "Explanation",
    ],
  );

  for (
    const section
    of response.sections
  ) {
    assert.equal(
      typeof section.content,
      "string",
    );

    assert.ok(
      section.content.trim(),
    );
  }
}


test(
  "formats a statistics answer using the fixed four-section template",
  () => {
    const synthesisResult = {
      answered: true,
      mode: "statistics",

      answer:
        "The average singles ranking is 94.22.",

      citations: [
        {
          number: 1,
          title:
            "Player Rankings dataset",
          sourceType:
            "table",
          date:
            "2026-08-30",
        },
      ],

      data: {
        average:
          94.22,
      },
    };


    const verificationResult = {
      verified: true,
      checks: {
        numeric: {
          status:
            "passed",
        },
      },
      issues: [],
    };


    const response =
      formatIntelligenceResponse({
        synthesisResult,
        verificationResult,

        intent:
          "aggregation",

        actions: [
          "statistics",
        ],

        responseDate:
          TEST_DATE,
      });


    assertFixedTemplate(
      response,
    );


    assert.equal(
      response.answered,
      true,
    );

    assert.equal(
      response.answer,
      "The average singles ranking is 94.22.",
    );


    assert.equal(
      getSection(
        response,
        "summary",
      ).content,
      "The average singles ranking is 94.22.",
    );


    const sources =
      getSection(
        response,
        "sources",
      ).content;

    assert.match(
      sources,
      /Searched: Statistics\./,
    );

    assert.match(
      sources,
      /\[1\] Player Rankings dataset/,
    );


    const date =
      getSection(
        response,
        "date",
      ).content;

    assert.match(
      date,
      /Response date: 2026-08-31/,
    );

    assert.match(
      date,
      /Evidence dates: 2026-08-30/,
    );


    assert.match(
      getSection(
        response,
        "explanation",
      ).content,
      /passed the configured verification checks/,
    );
  },
);


test(
  "formats a documents answer and uses citations bound by document verification",
  () => {
    const synthesisResult = {
      answered: true,
      mode: "documents",

      answer:
        "Return positioning varies according to playing style and court conditions [1].",

      /*
       * Documents synthesis deliberately
       * does not bind final citations.
       */
      citations: [],

      data: {
        documents: {
          evidence: [
            {
              citationNumber:
                1,
            },
          ],
        },
      },
    };


    const verificationResult = {
      verified: true,

      checks: {
        document_grounding: {
          status:
            "passed",

          metadata: {
            citations: [
              {
                number: 1,

                title:
                  "Return Position Research",

                fileName:
                  "return-position.pdf",

                page:
                  29,

                date:
                  "2021-01-01",
              },
            ],
          },
        },
      },

      issues: [],
    };


    const response =
      formatIntelligenceResponse({
        synthesisResult,
        verificationResult,

        intent:
          "knowledge_query",

        actions: [
          "documents",
        ],

        responseDate:
          TEST_DATE,
      });


    assertFixedTemplate(
      response,
    );


    assert.equal(
      response.answered,
      true,
    );

    assert.equal(
      response.citations.length,
      1,
    );


    const sources =
      getSection(
        response,
        "sources",
      ).content;


    assert.match(
      sources,
      /Searched: Documents\./,
    );

    assert.match(
      sources,
      /\[1\] Return Position Research/,
    );

    assert.match(
      sources,
      /page 29/,
    );


    assert.match(
      getSection(
        response,
        "date",
      ).content,
      /2021-01-01/,
    );
  },
);


test(
  "renders an insufficient-evidence refusal using the same four-section template",
  () => {
    const synthesisResult = {
      answered: false,

      mode:
        "documents",

      answer: null,

      citations: [],

      data: null,

      metadata: {
        reason:
          "No sufficiently relevant evidence remained after grading.",
      },
    };


    const response =
      formatIntelligenceResponse({
        synthesisResult,

        verificationResult:
          null,

        intent:
          "knowledge_query",

        actions: [
          "documents",
        ],

        responseDate:
          TEST_DATE,
      });


    assertFixedTemplate(
      response,
    );


    assert.equal(
      response.answered,
      false,
    );


    assert.match(
      getSection(
        response,
        "summary",
      ).content,
      /insufficient/i,
    );


    const sources =
      getSection(
        response,
        "sources",
      ).content;


    /*
     * This proves a refusal states
     * what was searched even though
     * there are no citations.
     */
    assert.match(
      sources,
      /Searched: Documents\./,
    );

    assert.match(
      sources,
      /Evidence used: None\./,
    );


    const explanation =
      getSection(
        response,
        "explanation",
      ).content;


    assert.match(
      explanation,
      /evidence was insufficient/i,
    );

    assert.match(
      explanation,
      /No sufficiently relevant evidence remained after grading/,
    );
  },
);


test(
  "renders an access-denied refusal using the same four-section template",
  () => {
    const refusal = {
      answered: false,

      answer:
        'Your role ("coach") does not have access to the data needed to answer this.',

      cause:
        "access_denied",

      reason:
        "Relevant evidence exists outside the caller's authorised scope.",
    };


    const response =
      formatIntelligenceResponse({
        refusal,

        intent:
          "knowledge_query",

        actions: [
          "documents",
        ],

        responseDate:
          TEST_DATE,

        telemetry: {
          roleId:
            "coach",
        },
      });


    assertFixedTemplate(
      response,
    );


    assert.equal(
      response.answered,
      false,
    );


    assert.equal(
      response.metadata.cause,
      "access_denied",
    );


    assert.match(
      getSection(
        response,
        "summary",
      ).content,
      /does not have access/,
    );


    assert.match(
      getSection(
        response,
        "sources",
      ).content,
      /Searched: Documents\./,
    );


    assert.match(
      getSection(
        response,
        "explanation",
      ).content,
      /access controls/i,
    );
  },
);


test(
  "withholds an unverified draft and still renders the fixed template",
  () => {
    const synthesisResult = {
      answered: true,

      mode:
        "documents",

      answer:
        "The unsupported draft says something incorrect [1].",

      citations: [],
    };


    const verificationResult = {
      verified: false,

      checks: {
        document_grounding: {
          status:
            "failed",
        },
      },

      issues: [
        "citation_mismatch: citation [1] does not support the claim",
      ],
    };


    const response =
      formatIntelligenceResponse({
        synthesisResult,
        verificationResult,

        intent:
          "knowledge_query",

        actions: [
          "documents",
        ],

        responseDate:
          TEST_DATE,
      });


    assertFixedTemplate(
      response,
    );


    assert.equal(
      response.answered,
      false,
    );


    /*
     * Critical safety property:
     * the failed draft must not become
     * the final response.answer.
     */
    assert.notEqual(
      response.answer,
      synthesisResult.answer,
    );


    assert.equal(
      response.metadata.cause,
      "verification_failed",
    );


    assert.match(
      getSection(
        response,
        "summary",
      ).content,
      /verification failed/i,
    );


    assert.match(
      getSection(
        response,
        "explanation",
      ).content,
      /citation_mismatch/,
    );
  },
);


test(
  "formats video-shaped evidence using the same four-section template",
  () => {
    /*
     * Video Intelligence does not need
     * to exist yet for us to prove that
     * the response contract can represent
     * timestamped evidence.
     */
    const synthesisResult = {
      answered: true,

      mode:
        "documents",

      answer:
        "The presenter recommends maintaining a stable return position [1].",

      citations: [
        {
          number:
            1,

          title:
            "AO Coaching Conference",

          sourceType:
            "video",

          timestamp:
            "18:42",

          date:
            "2026-08-15",
        },
      ],
    };


    const verificationResult = {
      verified:
        true,

      checks: {
        document_grounding: {
          status:
            "passed",
        },
      },

      issues: [],
    };


    const response =
      formatIntelligenceResponse({
        synthesisResult,
        verificationResult,

        intent:
          "video_query",

        actions: [
          "video",
        ],

        responseDate:
          TEST_DATE,
      });


    assertFixedTemplate(
      response,
    );


    const sources =
      getSection(
        response,
        "sources",
      ).content;


    assert.match(
      sources,
      /Searched: Video\./,
    );

    assert.match(
      sources,
      /\[1\] AO Coaching Conference/,
    );

    assert.match(
      sources,
      /timestamp 18:42/,
    );


    assert.match(
      getSection(
        response,
        "date",
      ).content,
      /Evidence dates: 2026-08-15/,
    );
  },
);


test(
  "formats the response date using the requested timezone",
  () => {
    /*
     * 31 August in UTC,
     * but already 1 September in Brisbane.
     */
    const responseDate =
      new Date(
        "2026-08-31T15:30:00.000Z",
      );


    const response =
      formatIntelligenceResponse({
        synthesisResult: {
          answered:
            true,

          mode:
            "statistics",

          answer:
            "The average singles ranking is 94.22.",

          citations: [],
        },

        verificationResult: {
          verified:
            true,

          issues: [],
        },

        actions: [
          "statistics",
        ],

        responseDate,

        responseTimeZone:
          "Australia/Brisbane",
      });


    assert.match(
      getSection(
        response,
        "date",
      ).content,

      /Response date: 2026-09-01/,
    );
  },
);