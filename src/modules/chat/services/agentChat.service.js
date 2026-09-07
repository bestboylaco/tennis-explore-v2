import {
  runAgent,
} from "../../agent/agentOrchestrator.service.js";

import {
  createAgentSynthesisInput,
} from "../../agent/agentSynthesis.service.js";

import {
  synthesize,
} from "../../synthesis/synthesis.service.js";

import {
  verifySynthesis,
} from "../../verification/verifySynthesis.service.js";

import {
  formatIntelligenceResponse,
} from "../../response/responseFormatter.service.js";


function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function uniqueActionIds(values) {
  return [
    ...new Set(
      values.filter(
        (value) =>
          typeof value === "string" &&
          value.trim(),
      ),
    ),
  ];
}


function getNoResultReason(
  synthesisInput,
) {
  const observations =
    Array.isArray(
      synthesisInput.noResultObservations,
    )
      ? synthesisInput.noResultObservations
      : [];


  const gradingReasons =
    observations
      .map(
        (observation) =>
          observation
            ?.metadata
            ?.grading
            ?.reason,
      )
      .filter(isNonEmptyString)
      .map(
        (reason) =>
          reason.trim(),
      );


  if (gradingReasons.length > 0) {
    return gradingReasons.join(" ");
  }


  const metadataReasons =
    observations
      .map(
        (observation) =>
          observation
            ?.metadata
            ?.reason,
      )
      .filter(isNonEmptyString)
      .map(
        (reason) =>
          reason.trim(),
      );


  if (metadataReasons.length > 0) {
    return metadataReasons.join(" ");
  }


  return (
    "No sufficient evidence was returned by the available Actions."
  );
}


function hasAccessDenied(
  synthesisInput,
) {
  const observations =
    Array.isArray(
      synthesisInput.noResultObservations,
    )
      ? synthesisInput.noResultObservations
      : [];


  return observations.some(
    (observation) =>
      observation
        ?.metadata
        ?.cause ===
      "access_denied",
  );
}


function normaliseTimeZone(
  timeZone,
) {
  const candidate =
    isNonEmptyString(timeZone)
      ? timeZone.trim()
      : "UTC";


  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          candidate,
      },
    ).format(
      new Date(),
    );

    return candidate;
  } catch {
    return "UTC";
  }
}


/**
 * Production-facing Agent chat pipeline.
 *
 * This deliberately reuses the same sequence proven by
 * the real Statistics/Documents integration scripts:
 *
 * Agent
 * -> stable synthesis input
 * -> synthesis
 * -> deterministic verification
 * -> unified response formatter
 *
 * No retrieval or routing is repeated after the Agent.
 */
export async function submitAgentChatQuestion(
  question,
  {
    roleId,
    correlationId = null,
    responseTimeZone = "UTC",
  } = {},
) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "submitAgentChatQuestion requires a non-empty question.",
    );
  }


  if (!isNonEmptyString(roleId)) {
    throw new Error(
      "submitAgentChatQuestion requires a roleId. There is no default role on purpose.",
    );
  }


  const agentResult =
    await runAgent({
      question:
        question.trim(),

      context: {
        roleId:
          roleId.trim(),

        correlationId,
      },
    });


  const synthesisInput =
    createAgentSynthesisInput({
      question:
        question.trim(),

      state:
        agentResult.agent.state,
    });


  const initialActions =
    agentResult.routing
      ?.decision
      ?.selectedActions ??
    [];


  /*
   * Prefer Actions that actually produced observations.
   *
   * initialActions remains a fallback so routing information
   * is not lost if no observation was recorded.
   */
  const observedActions =
    uniqueActionIds([
      ...(synthesisInput
        .successfulActionIds ?? []),

      ...(synthesisInput
        .noResultActionIds ?? []),
    ]);


  const actions =
    observedActions.length > 0
      ? observedActions
      : uniqueActionIds(
          initialActions,
        );


  const intent =
    agentResult.routing
      ?.decision
      ?.intent ??
    null;


  const timeZone =
    normaliseTimeZone(
      responseTimeZone,
    );


  /*
   * No successful evidence means there is nothing
   * that may legally enter synthesis.
   */
  if (
    synthesisInput.mode ===
    "none"
  ) {
    const accessDenied =
      hasAccessDenied(
        synthesisInput,
      );


    const reason =
      getNoResultReason(
        synthesisInput,
      );


    const refusal =
      accessDenied
        ? {
            answered:
              false,

            cause:
              "access_denied",

            answer:
              "The required evidence is not available under the current access permissions.",

            reason,
          }
        : {
            answered:
              false,

            cause:
              "insufficient_evidence",

            answer:
              "The available evidence is insufficient to answer this question.",

            reason,
          };


    const finalResponse =
      formatIntelligenceResponse({
        refusal,

        intent,

        actions,

        responseDate:
          new Date(),

        responseTimeZone:
          timeZone,

        telemetry: {
          correlationId,

          stopReason:
            agentResult.agent
              ?.stopReason ??
            null,

          successfulActionIds:
            synthesisInput
              .successfulActionIds,

          noResultActionIds:
            synthesisInput
              .noResultActionIds,
        },

        metadata: {
          pipeline:
            "agent_v2",

          cause:
            refusal.cause,

          reason,
        },
      });


    return {
      status:
        "completed",

      response:
        finalResponse,

      citations:
        finalResponse.citations,
    };
  }


  /*
   * Successful evidence path.
   */
  const synthesisResult =
    await synthesize({
      mode:
        synthesisInput.mode,

      input:
        synthesisInput,
    });


  const verificationResult =
    await verifySynthesis({
      synthesisResult,

      synthesisInput,
    });


  const finalResponse =
    formatIntelligenceResponse({
      synthesisResult,

      verificationResult,

      intent,

      actions,

      responseDate:
        new Date(),

      responseTimeZone:
        timeZone,

      telemetry: {
        correlationId,

        stopReason:
          agentResult.agent
            ?.stopReason ??
          null,

        successfulActionIds:
          synthesisInput
            .successfulActionIds,

        noResultActionIds:
          synthesisInput
            .noResultActionIds,
      },

      metadata: {
        pipeline:
          "agent_v2",

        synthesisMode:
          synthesisInput.mode,
      },
    });


  return {
    status:
      "completed",

    response:
      finalResponse,

    citations:
      finalResponse.citations,
  };
}