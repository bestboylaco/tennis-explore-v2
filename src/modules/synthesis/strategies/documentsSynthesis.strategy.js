import {
  prepareEvidence,
} from "../../generation/contextOrdering.service.js";

import {
  generateAnswer,
} from "../../chat/services/generation.service.js";

import {
  AGENT_SYNTHESIS_MODES,
} from "../../agent/agentSynthesis.service.js";


function isNonEmptyString(
  value
) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


/*
 * Documents synthesis strategy.
 *
 * Responsibility:
 *
 *   Existing Agent evidence
 *        ↓
 *   prepareEvidence()
 *        ↓
 *   generateAnswer()
 *        ↓
 *   synthesis result
 *
 * This strategy NEVER:
 *
 * - routes a question
 * - retrieves documents
 * - executes Documents Action
 * - grades evidence again
 * - verifies the generated answer
 */
export const documentsSynthesisStrategy =
  Object.freeze({
    id:
      AGENT_SYNTHESIS_MODES.DOCUMENTS,


    async synthesize({
      input,
      context = {},
      signal = null,
    } = {}) {
      if (
        !input ||
        typeof input !== "object"
      ) {
        throw new TypeError(
          "Documents synthesis requires a valid synthesis input."
        );
      }


      if (
        input.mode !==
        AGENT_SYNTHESIS_MODES.DOCUMENTS
      ) {
        throw new Error(
          `Documents synthesis cannot handle mode "${input.mode}".`
        );
      }


      if (
        !isNonEmptyString(
          input.question
        )
      ) {
        throw new TypeError(
          "Documents synthesis requires a non-empty question."
        );
      }


      if (
        !Array.isArray(
          input.documentEvidence
        ) ||
        input.documentEvidence.length ===
          0
      ) {
        throw new Error(
          "Documents synthesis requires existing document evidence."
        );
      }


      /*
       * Prepare ONLY the evidence already returned by
       * Documents Action.
       *
       * No retrieval happens here.
       */
      const prepared =
        prepareEvidence(
          input.documentEvidence,
          input.question,
          {
            maxChars:
              context.maxContextChars,

            topN:
              context.topN,
          }
        );


      const evidence =
        prepared.evidence;


      if (
        evidence.length ===
        0
      ) {
        throw new Error(
          "Documents synthesis has no evidence after preparation."
        );
      }


      /*
       * Tests can inject their own generator so
       * Ollama is not required.
       */
      const generator =
        typeof context.generateText ===
        "function"
          ? context.generateText
          : async ({
              question,
              evidence,
            }) =>
              generateAnswer({
                question,
                evidence,
              });


      const generation =
        await generator({
          question:
            input.question,

          evidence,

          signal,
        });


      /*
       * Support both:
       *
       *   "answer text"
       *
       * and the real generation service:
       *
       *   {
       *     answer,
       *     model,
       *     promptVersion,
       *     ...
       *   }
       */
      const answer =
        typeof generation ===
        "string"
          ? generation.trim()
          : String(
              generation
                ?.answer ??
              ""
            ).trim();


      if (!answer) {
        throw new Error(
          "Documents synthesis model returned an empty answer."
        );
      }


      return {
        answered:
          true,

        mode:
          AGENT_SYNTHESIS_MODES.DOCUMENTS,

        answer,

        /*
         * Document citations are deliberately NOT
         * bound here.
         *
         * Verification will bind [1], [2], etc.
         * against this exact evidence set.
         */
        citations: [],

        data: {
          documents: {
            evidence,

            preparation: {
              duplicatesRemoved:
                prepared
                  .duplicatesRemoved,

              compressedCount:
                prepared
                  .compressedCount,

              droppedForLength:
                prepared
                  .droppedForLength,

              chars:
                prepared.chars,
            },

            generation:
              typeof generation ===
                "object" &&
              generation !== null
                ? {
                    model:
                      generation.model ??
                      null,

                    promptVersion:
                      generation
                        .promptVersion ??
                      null,

                    tokensIn:
                      generation
                        .tokensIn ??
                      null,

                    tokensOut:
                      generation
                        .tokensOut ??
                      null,

                    durationMs:
                      generation
                        .durationMs ??
                      null,
                  }
                : null,
          },
        },

        metadata: {
          sourceAction:
            "documents",
        },
      };
    },
  });