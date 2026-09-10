import {
  synthesizeStatisticsAnswer,
} from "../../agent/agentSynthesis.service.js";

export const statisticsSynthesisStrategy =
  Object.freeze({
    id: "statistics",

    async synthesize({
      input,
      context = {},
      signal = null,
    } = {}) {
      if (!input || typeof input !== "object") {
        throw new TypeError(
          "Statistics synthesis requires a synthesis input",
        );
      }

      const result =
        await synthesizeStatisticsAnswer({
          synthesisInput: input,
          signal,

          // Useful for deterministic unit testing.
          generateText:
            context.generateText ?? null,
        });

      return {
        answered: result.answered,

        mode: result.mode,

        answer: result.answer,

        citations: result.citations ?? [],

        data: {
          statistics:
            result.statistics ?? null,
        },

        metadata: {
            sourceAction: "statistics",
            },
      };
    },
  });