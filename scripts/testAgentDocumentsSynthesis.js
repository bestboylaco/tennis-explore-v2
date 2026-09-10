import {
  bootstrapActions,
} from "../src/modules/actions/index.js";

import {
  runAgent,
} from "../src/modules/agent/agentOrchestrator.service.js";

import {
  createAgentSynthesisInput,
} from "../src/modules/agent/agentSynthesis.service.js";

import {
  bootstrapSynthesis,
} from "../src/modules/synthesis/synthesis.bootstrap.js";

import {
  synthesize,
} from "../src/modules/synthesis/synthesis.service.js";

import {
  bootstrapVerification,
} from "../src/modules/verification/verification.bootstrap.js";

import {
  verifySynthesis,
} from "../src/modules/verification/verifySynthesis.service.js";

import {
  env,
} from "../src/config/env.js";


async function main() {
  /*
   * You can override the question from PowerShell:
   *
   * node scripts/testAgentDocumentsSynthesis.js `
   *   "What does the research say about return positioning?"
   */
  const question =
    process.argv
      .slice(2)
      .join(" ")
      .trim() ||
    "What does the research say about return positioning?";


  /*
   * Standalone process:
   * register Actions explicitly.
   */
  await bootstrapActions({
    structuredSourceDirs:
      env.structuredSourceDirs,
  });


  /*
   * Register synthesis + verification strategies.
   */
  bootstrapSynthesis();

  bootstrapVerification();


  /*
   * STEP 1
   *
   * Let the real Agent route the question and execute
   * the Documents Action.
   */
  const agentResult =
    await runAgent({
      question,

      context: {
        roleId:
          "admin",
      },
    });


  /*
   * STEP 2
   *
   * Convert the real observations already stored in
   * AgentState into synthesis input.
   *
   * No retrieval is repeated here.
   */
  const synthesisInput =
    createAgentSynthesisInput({
      question,

      state:
        agentResult.agent.state,
    });


  /*
   * Useful guard:
   * this regression is specifically testing the
   * Documents path.
   */
  if (
    synthesisInput.mode !==
    "documents"
  ) {
    console.error(
      "Expected Documents synthesis mode but received:",
      synthesisInput.mode,
    );

    console.dir(
      {
        initialActions:
          agentResult.routing
            ?.decision
            ?.selectedActions ??
          [],

        stopReason:
          agentResult.agent
            ?.stopReason ??
          null,

        successfulActionIds:
          synthesisInput
            .successfulActionIds,

        documentEvidenceCount:
          synthesisInput
            .documentEvidence
            .length,

        statisticsResultCount:
          synthesisInput
            .statisticsResults
            .length,
      },
      {
        depth:
          null,
      },
    );

    process.exitCode =
      1;

    return;
  }


  /*
   * STEP 3
   *
   * Documents synthesis:
   *
   * raw Agent evidence
   *      ↓
   * prepareEvidence()
   *      ↓
   * generation
   *      ↓
   * draft answer
   */
  const synthesis =
    await synthesize({
      mode:
        synthesisInput.mode,

      input:
        synthesisInput,
    });


  /*
   * STEP 4
   *
   * Independently verify the generated answer against
   * the exact prepared evidence the model saw.
   */
  const verification =
    await verifySynthesis({
      synthesisResult:
        synthesis,

      synthesisInput,
    });


  const groundingCheck =
    verification
      ?.checks
      ?.document_grounding ??
    null;


  const groundingMetadata =
    groundingCheck
      ?.metadata ??
    {};


  /*
   * Citation binding belongs to verification.
   *
   * Documents synthesis intentionally returns no bound
   * citations itself.
   */
  const citations =
    Array.isArray(
      groundingMetadata.citations
    )
      ? groundingMetadata.citations
      : [];


  const preparedEvidence =
    synthesis
      ?.data
      ?.documents
      ?.evidence ??
    [];


  /*
   * STEP 5
   *
   * Print the complete real regression result.
   */
  console.log(
    JSON.stringify(
      {
        question,

        initialActions:
          agentResult.routing
            ?.decision
            ?.selectedActions ??
          [],

        stopReason:
          agentResult.agent
            ?.stopReason ??
          null,

        successfulActionIds:
          synthesisInput
            .successfulActionIds,

        synthesisMode:
          synthesis.mode,

        answer:
          synthesis.answer,

        verified:
          verification.verified,

        groundingStatus:
          groundingCheck
            ?.status ??
          null,

        citedFraction:
          groundingMetadata
            .citedFraction ??
          null,

        claimCount:
          groundingMetadata
            .claimCount ??
          null,

        danglingCitations:
          groundingMetadata
            .danglingCitations ??
          [],

        unsupportedNumbers:
          groundingMetadata
            .unsupportedNumbers ??
          [],

        warnings:
          groundingMetadata
            .warnings ??
          [],

        citations,

        evidence: {
          rawCount:
            synthesisInput
              .documentEvidence
              .length,

          preparedCount:
            preparedEvidence.length,

          preparation:
            synthesis
              ?.data
              ?.documents
              ?.preparation ??
            null,
        },

        generation:
          synthesis
            ?.data
            ?.documents
            ?.generation ??
          null,

        verification,
      },

      null,
      2,
    ),
  );
}


main().catch(
  (error) => {
    console.error(
      "Documents Agent regression test failed:",
    );

    console.error(
      error,
    );

    process.exitCode =
      1;
  },
);