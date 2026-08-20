    function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}


function formatDatasets(
  datasets
) {
  return datasets
    .map((dataset, index) => {
      const fields =
        Array.isArray(dataset.fields)
          ? dataset.fields
          : [];

      const fieldText =
        fields.length > 0
          ? fields
              .map(
                (field) =>
                  `- ${field}`
              )
              .join("\n")
          : "- No fields provided.";

      return [
        `DATASET ${index + 1}`,
        `ID: ${dataset.datasetId}`,
        `Name: ${dataset.name}`,
        `Description: ${dataset.description}`,
        "Available fields:",
        fieldText,
      ].join("\n");
    })
    .join("\n\n");
}


export function buildStatisticsQueryPrompt({
  question,
  datasets = [],
} = {}) {
  if (!isNonEmptyString(question)) {
    throw new TypeError(
      "Statistics planning requires a non-empty question."
    );
  }

  if (
    !Array.isArray(datasets) ||
    datasets.length === 0
  ) {
    throw new TypeError(
      "At least one statistics dataset is required."
    );
  }


  const datasetDescriptions =
    formatDatasets(
      datasets
    );


  return `
You are the statistics query planner for TennisExplore.

Your job is to convert the coach's natural-language question into a structured statistics query.

You do not answer the question yourself.

You may only use the datasets and fields listed below.

AVAILABLE DATASETS

${datasetDescriptions}

COACH QUESTION

${question.trim()}

SUPPORTED OPERATIONS

- lookup
- filter
- max
- min
- average
- count
- sum
- sort
- compare

SUPPORTED FILTER OPERATORS

- eq
- neq
- gt
- gte
- lt
- lte
- in
- contains
- between

RULES

1. Select only a dataset from AVAILABLE DATASETS.

2. Use only field names listed for the selected dataset.

3. Choose the operation that best represents the coach's request.

4. For max, min, average, or sum, provide the metric field.

5. Use filters only when the coach specifies conditions.

6. Do not invent datasets, fields, players, values, or statistics.

7. Return only valid JSON.

8. Do not include Markdown, code fences, explanations, or text outside the JSON object.

RETURN EXACTLY THIS STRUCTURE

{
  "dataset": "dataset_id",
  "operation": "lookup",
  "metric": null,
  "filters": [],
  "groupBy": null,
  "sortBy": null,
  "sortDirection": null,
  "limit": null,
  "fields": []
}
`.trim();
}