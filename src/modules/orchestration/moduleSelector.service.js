import {
  knowledgeModules,
} from "../knowledge/index.js";

/**
 * Calculate how strongly a question matches
 * one knowledge module.
 *
 * @param {string} normalisedQuestion
 * @param {Object} knowledgeModule
 *
 * @returns {number}
 */
function calculateModuleScore(
  normalisedQuestion,
  knowledgeModule
) {
  return knowledgeModule.keywords.reduce(
    (score, keyword) => {
      const normalisedKeyword =
        keyword.toLowerCase();

      if (
        normalisedQuestion.includes(
          normalisedKeyword
        )
      ) {
        return score + 1;
      }

      return score;
    },
    0
  );
}

/**
 * Select relevant knowledge modules for a question.
 *
 * The first version uses keyword matching.
 * This can later be replaced with an AI classifier
 * without changing the rest of the orchestration flow.
 *
 * @param {Object} options
 * @param {string} options.question
 * @param {number} [options.maximumModules=3]
 *
 * @returns {Array<{
 *   moduleId: string,
 *   label: string,
 *   sourceTypes: string[],
 *   score: number
 * }>}
 */
export function selectKnowledgeModules({
  question,
  maximumModules = 3,
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Question must be a non-empty string."
    );
  }

  if (
    !Number.isInteger(maximumModules) ||
    maximumModules <= 0
  ) {
    throw new TypeError(
      "Maximum modules must be a positive integer."
    );
  }

  const normalisedQuestion =
    question.trim().toLowerCase();

  const scoredModules =
    knowledgeModules
      .map((knowledgeModule) => ({
        moduleId:
          knowledgeModule.moduleId,

        label:
          knowledgeModule.label,

        sourceTypes:
          knowledgeModule.sourceTypes,

        score:
          calculateModuleScore(
            normalisedQuestion,
            knowledgeModule
          ),
      }))
      .filter(
        (knowledgeModule) =>
          knowledgeModule.score > 0
      )
      .sort(
        (first, second) =>
          second.score - first.score
      )
      .slice(
        0,
        maximumModules
      );

  /*
   * Safe fallback:
   * if the question does not contain any known keyword,
   * search the broadest knowledge modules.
   */
  if (scoredModules.length === 0) {
    return knowledgeModules
      .filter(
        (knowledgeModule) =>
          [
            "research",
            "coaching",
          ].includes(
            knowledgeModule.moduleId
          )
      )
      .map((knowledgeModule) => ({
        moduleId:
          knowledgeModule.moduleId,

        label:
          knowledgeModule.label,

        sourceTypes:
          knowledgeModule.sourceTypes,

        score: 0,
      }))
      .slice(
        0,
        maximumModules
      );
  }

  return scoredModules;
}