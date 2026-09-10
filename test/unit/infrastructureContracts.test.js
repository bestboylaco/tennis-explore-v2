import test from "node:test";
import assert from "node:assert/strict";

import {
  SYNTHESIS_MODES,
  createSynthesisResult,
} from "../../src/modules/synthesis/synthesis.types.js";

import {
  VERIFICATION_CHECK_STATUS,
  createVerificationCheck,
  createVerificationResult,
} from "../../src/modules/verification/verification.types.js";

import {
  createQueryAnalysis,
} from "../../src/modules/queryUnderstanding/queryAnalysis.types.js";

import {
  createActionPolicy,
} from "../../src/modules/policy/actionPolicy.types.js";

import {
  createAgentObservation,
} from "../../src/modules/agent/agentObservation.types.js";

import {
  createIntelligenceResponse,
} from "../../src/modules/response/response.types.js";


test("creates a valid synthesis result", () => {
  const result = createSynthesisResult({
    answered: true,
    mode: SYNTHESIS_MODES.STATISTICS,
    answer: "The average ranking is 94.22.",
    citations: [{ number: 1 }],
    data: {
      average: 94.22,
    },
  });

  assert.equal(result.contractVersion, 1);
  assert.equal(result.answered, true);
  assert.equal(result.mode, "statistics");
  assert.equal(
    result.answer,
    "The average ranking is 94.22.",
  );
  assert.equal(result.citations.length, 1);

  assert.equal(Object.isFrozen(result), true);
});


test("rejects an unsupported synthesis mode", () => {
  assert.throws(
    () =>
      createSynthesisResult({
        mode: "invented_mode",
      }),
    /Unsupported synthesis mode/,
  );
});


test("creates a verification check", () => {
  const check = createVerificationCheck({
    status: VERIFICATION_CHECK_STATUS.PASSED,
    issues: [],
    metadata: {
      verifier: "numeric",
    },
  });

  assert.equal(check.status, "passed");
  assert.deepEqual(check.issues, []);
  assert.equal(
    check.metadata.verifier,
    "numeric",
  );
});


test("creates a verification result", () => {
  const numericCheck = createVerificationCheck({
    status: VERIFICATION_CHECK_STATUS.PASSED,
  });

  const result = createVerificationResult({
    verified: true,
    checks: {
      numeric: numericCheck,
    },
    issues: [],
  });

  assert.equal(result.contractVersion, 1);
  assert.equal(result.verified, true);
  assert.equal(
    result.checks.numeric.status,
    "passed",
  );

  assert.equal(Object.isFrozen(result), true);
});


test("rejects an invalid verification status", () => {
  assert.throws(
    () =>
      createVerificationCheck({
        status: "maybe",
      }),
    /Unsupported verification check status/,
  );
});


test("creates a generic query analysis", () => {
  const analysis = createQueryAnalysis({
    intent: "aggregation",
    entities: [],
    requiredCapabilities: [
      "structured_statistics",
    ],
    confidence: 0.95,
  });

  assert.equal(analysis.contractVersion, 1);
  assert.equal(
    analysis.intent,
    "aggregation",
  );
  assert.deepEqual(
    analysis.requiredCapabilities,
    ["structured_statistics"],
  );
  assert.equal(analysis.confidence, 0.95);
});


test("query analysis supports unknown intent for future taxonomy", () => {
  const analysis = createQueryAnalysis({
    intent: null,
  });

  assert.equal(analysis.intent, null);
  assert.deepEqual(analysis.entities, []);
  assert.deepEqual(
    analysis.requiredCapabilities,
    [],
  );
});


test("rejects invalid query confidence", () => {
  assert.throws(
    () =>
      createQueryAnalysis({
        confidence: 1.5,
      }),
    /confidence must be null or a number between 0 and 1/,
  );
});


test("creates an action policy and removes duplicate action IDs", () => {
  const policy = createActionPolicy({
    requiredActions: [
      "statistics",
      "statistics",
    ],
    allowedActions: [
      "statistics",
      "documents",
      "statistics",
    ],
    optionalActions: [
      "documents",
    ],
    maxSteps: 2,
  });

  assert.equal(policy.contractVersion, 1);

  assert.deepEqual(
    policy.requiredActions,
    ["statistics"],
  );

  assert.deepEqual(
    policy.allowedActions,
    ["statistics", "documents"],
  );

  assert.deepEqual(
    policy.optionalActions,
    ["documents"],
  );

  assert.equal(policy.maxSteps, 2);
});


test("rejects invalid maxSteps", () => {
  assert.throws(
    () =>
      createActionPolicy({
        maxSteps: 0,
      }),
    /maxSteps must be an integer greater than or equal to 1/,
  );
});


test("creates a standard Agent observation", () => {
  const observation = createAgentObservation({
    actionId: "statistics",
    status: "success",
    data: {
      average: 94.22,
    },
    evidence: [],
    metadata: {
      rowsMatched: 45,
    },
  });

  assert.equal(
    observation.contractVersion,
    1,
  );

  assert.equal(
    observation.actionId,
    "statistics",
  );

  assert.equal(
    observation.status,
    "success",
  );

  assert.equal(
    observation.data.average,
    94.22,
  );

  assert.equal(
    observation.metadata.rowsMatched,
    45,
  );
});


test("rejects an Agent observation without an actionId", () => {
  assert.throws(
    () =>
      createAgentObservation({
        actionId: "",
        status: "success",
      }),
    /actionId must be a non-empty string/,
  );
});


test("creates the common intelligence response", () => {
  const verification =
    createVerificationResult({
      verified: true,
      issues: [],
    });

  const response =
    createIntelligenceResponse({
      answered: true,

      answer:
        "The average singles ranking is 94.22.",

      summary:
        "The average singles ranking is 94.22.",

      sources:
        "Player Rankings dataset.",

      date:
        "31 August 2026",

      explanation:
        "The average was calculated from the matching ranking records.",

      intent:
        "aggregation",

      actions: [
        "statistics",
      ],

      citations: [
        {
          number: 1,
        },
      ],

      data: {
        average: 94.22,
      },

      verification,

      telemetry: {
        steps: 1,
      },
    });


  assert.equal(
    response.contractVersion,
    2,
  );

  assert.equal(
    response.answered,
    true,
  );

  assert.equal(
    response.intent,
    "aggregation",
  );

  assert.deepEqual(
    response.actions,
    ["statistics"],
  );

  assert.equal(
    response.verification.verified,
    true,
  );

  assert.equal(
    response.telemetry.steps,
    1,
  );


  assert.deepEqual(
    response.sections.map(
      (section) =>
        section.id,
    ),
    [
      "summary",
      "sources",
      "date",
      "explanation",
    ],
  );


  assert.equal(
    response.sections[0].title,
    "Summary",
  );

  assert.equal(
    response.sections[1].title,
    "Sources",
  );

  assert.equal(
    response.sections[2].title,
    "Date",
  );

  assert.equal(
    response.sections[3].title,
    "Explanation",
  );
});


test("contracts connect into one complete pipeline shape", () => {
  const query =
    createQueryAnalysis({
      intent: "aggregation",
      requiredCapabilities: [
        "structured_statistics",
      ],
      confidence: 0.98,
    });

  const policy =
    createActionPolicy({
      requiredActions: [
        "statistics",
      ],
      allowedActions: [
        "statistics",
      ],
      maxSteps: 1,
    });

  const observation =
    createAgentObservation({
      actionId: "statistics",
      status: "success",
      data: {
        average: 94.22,
      },
    });

  const synthesis =
    createSynthesisResult({
      answered: true,
      mode:
        SYNTHESIS_MODES.STATISTICS,
      answer:
        "The average singles ranking is 94.22.",
      data:
        observation.data,
    });

  const verification =
    createVerificationResult({
      verified: true,
      checks: {
        numeric:
          createVerificationCheck({
            status:
              VERIFICATION_CHECK_STATUS.PASSED,
          }),
      },
    });

  const response =
    createIntelligenceResponse({
      answered:
        synthesis.answered,

      answer:
        synthesis.answer,

      summary:
        "The average singles ranking is 94.22.",

      sources:
        "Player Rankings dataset.",

      date:
        "31 August 2026",

      explanation:
        "The value was calculated from the structured ranking data.",

      intent:
        query.intent,

      actions:
        policy.requiredActions,

      data:
        synthesis.data,

      verification,

      telemetry: {
        steps: 1,
      },
    });


  assert.equal(
    query.intent,
    "aggregation",
  );

  assert.deepEqual(
    policy.requiredActions,
    ["statistics"],
  );

  assert.equal(
    observation.actionId,
    "statistics",
  );

  assert.equal(
    synthesis.mode,
    "statistics",
  );

  assert.equal(
    verification.verified,
    true,
  );

  assert.equal(
    response.answer,
    "The average singles ranking is 94.22.",
  );

  assert.deepEqual(
    response.sections.map(
      (section) =>
        section.id,
    ),
    [
      "summary",
      "sources",
      "date",
      "explanation",
    ],
  );
});


test("rejects an intelligence response missing a required section", () => {
  assert.throws(
    () =>
      createIntelligenceResponse({
        answered: false,

        answer:
          "Insufficient evidence.",

        summary:
          "The available evidence is insufficient.",

        sources:
          "Documents knowledge base.",

        date:
          "31 August 2026",

        // explanation intentionally missing
      }),

    /explanation must be a non-empty string/,
  );
});