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


/*
 * Helper for reading the numeric verification check.
 *
 * This keeps the standalone test script tolerant if
 * VerificationResult.checks is represented as either:
 *
 *   {
 *     numeric: {...}
 *   }
 *
 * or:
 *
 *   [
 *     {
 *       id: "numeric",
 *       ...
 *     }
 *   ]
 */
function getNumericVerificationCheck(
  verification
) {
  const checks =
    verification?.checks;


  if (!checks) {
    return null;
  }


  if (Array.isArray(checks)) {
    return (
      checks.find(
        (check) =>
          check?.id === "numeric" ||
          check?.checkId === "numeric"
      ) ??
      null
    );
  }


  if (
    typeof checks === "object"
  ) {
    return (
      checks.numeric ??
      null
    );
  }


  return null;
}


async function main() {
  const question =
    "What is the average singles ranking?";


  /*
   * Standalone scripts run in their own Node process.
   *
   * Therefore the Action Registry must be explicitly
   * bootstrapped before the Agent can execute Actions.
   */
  await bootstrapActions({
    structuredSourceDirs:
      env.structuredSourceDirs,
  });


  /*
   * Register all currently available synthesis
   * strategies.
   */
  bootstrapSynthesis();


  /*
   * Register all currently available verification
   * strategies.
   */
  bootstrapVerification();


  /*
   * STEP 1
   *
   * Ask the Agent to route the question and execute
   * the approved Action.
   *
   * For this question we expect:
   *
   *   statistics
   *
   * to execute.
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
   * Convert the observations already stored inside
   * AgentState into a deterministic synthesis input.
   *
   * IMPORTANT:
   *
   * No Action is executed again here.
   * No statistics query is repeated.
   * No retrieval is repeated.
   */
  const synthesisInput =
    createAgentSynthesisInput({
      question,

      state:
        agentResult.agent.state,
    });


  /*
   * STEP 3
   *
   * Synthesize a natural-language explanation from
   * the ALREADY-COMPUTED Statistics Action result.
   *
   * Synthesis does not decide whether the answer is
   * trustworthy.
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
   * Verify the generated synthesis independently.
   *
   * For Statistics mode this currently invokes the
   * numeric verification strategy.
   */
  const verification =
    await verifySynthesis({
      synthesisResult:
        synthesis,

      synthesisInput,
    });


  /*
   * Read the numeric verification result.
   */
  const numericCheck =
    getNumericVerificationCheck(
      verification
    );


  const unsupportedNumbers =
    numericCheck
      ?.metadata
      ?.unsupportedNumbers ??
    [];


  /*
   * STEP 5
   *
   * Print the complete result so we can confirm the
   * real orchestration path works end-to-end.
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

        synthesisMode:
          synthesis.mode,

        answer:
          synthesis.answer,

        verified:
          verification.verified,

        unsupportedNumbers,

        citations:
          synthesis.citations ??
          [],

        statistics:
          synthesis.data
            ?.statistics ??
          null,

        verification,
      },

      null,
      2
    )
  );
}


main().catch(
  (error) => {
    console.error(
      "Statistics Agent regression test failed:"
    );

    console.error(
      error
    );

    process.exitCode =
      1;
  }
);