import {
  generateCompletion,
} from "../ai/services/generationProvider.js";

import {
  getAvailableDatasets,
} from "./statisticsProviderRegistry.js";

import {
  buildStatisticsQueryPrompt,
} from "./statisticsQueryPromptBuilder.service.js";

import {
  assertValidStatisticsQuery,
} from "./statisticsValidator.js";

import {
  createStatisticsQuery,
} from "./statistics.types.js";


function cleanJsonCompletion(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}


function extractJsonObject(value) {
  const firstBrace =
    value.indexOf("{");

  const lastBrace =
    value.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace <= firstBrace
  ) {
    throw new Error(
      "Statistics planner response did not contain a JSON object."
    );
  }

  return value
    .slice(
      firstBrace,
      lastBrace + 1
    )
    .trim();
}


function parsePlannerCompletion(
  completion
) {
  const cleaned =
    cleanJsonCompletion(
      completion
    );

  if (!cleaned) {
    throw new Error(
      "Statistics planner returned an empty completion."
    );
  }

  const jsonText =
    extractJsonObject(
      cleaned
    );

  let parsed;

  try {
    parsed =
      JSON.parse(
        jsonText
      );
  } catch {
    throw new Error(
      `Statistics planner returned invalid JSON: ${jsonText}`
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Statistics planner response must be a JSON object."
    );
  }

  return parsed;
}


export async function planStatisticsQuery({
  question,
} = {}) {
  if (
    typeof question !== "string" ||
    question.trim().length === 0
  ) {
    throw new TypeError(
      "Statistics planning requires a non-empty question."
    );
  }


  const datasets =
    getAvailableDatasets();


  if (datasets.length === 0) {
    throw new Error(
      "No statistics datasets are currently available."
    );
  }


  const prompt =
    buildStatisticsQueryPrompt({
      question:
        question.trim(),

      datasets,
    });


  const generation =
    await generateCompletion({
      prompt,

      // Query planning should be deterministic.
      temperature: 0,
    });


  const parsedQuery =
    parsePlannerCompletion(
      generation.completion
    );


  const query =
    createStatisticsQuery({
      dataset:
        parsedQuery.dataset,

      operation:
        parsedQuery.operation,

      metric:
        parsedQuery.metric ?? null,

      filters:
        Array.isArray(
          parsedQuery.filters
        )
          ? parsedQuery.filters
          : [],

      groupBy:
        parsedQuery.groupBy ?? null,

      sortBy:
        parsedQuery.sortBy ?? null,

      sortDirection:
        parsedQuery.sortDirection ?? null,

      limit:
        parsedQuery.limit ?? null,

      fields:
        Array.isArray(
          parsedQuery.fields
        )
          ? parsedQuery.fields
          : [],
    });


  assertValidStatisticsQuery(
    query
  );


  return Object.freeze({
    question:
      question.trim(),

    query,

    planning: Object.freeze({
      provider:
        generation.provider,

      model:
        generation.model,

      availableDatasets:
        datasets.map(
          (dataset) =>
            dataset.datasetId
        ),
    }),
  });
}