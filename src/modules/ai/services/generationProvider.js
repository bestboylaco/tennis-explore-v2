import {
  AI_MODEL,
  OLLAMA_BASE_URL,
} from "../types/ai.types.js";

/**
 * Generates a completion using Ollama.
 *
 * @param {Object} options
 * @param {string} options.prompt
 * @param {string} [options.model]
 * @param {number} [options.temperature=0.2]
 *
 * @returns {Promise<{
 *   provider: string,
 *   model: string,
 *   completion: string
 * }>}
 */
export async function generateCompletion({
  prompt,
  model = AI_MODEL,
  temperature = 0.2,
} = {}) {
  if (
    typeof prompt !== "string" ||
    !prompt.trim()
  ) {
    throw new TypeError(
      "A non-empty prompt is required."
    );
  }

  if (
    typeof temperature !== "number" ||
    temperature < 0 ||
    temperature > 2
  ) {
    throw new TypeError(
      "Temperature must be between 0 and 2."
    );
  }

  let response;

  try {
    response = await fetch(
      `${OLLAMA_BASE_URL}/api/generate`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model,
          prompt: prompt.trim(),
          stream: false,

          options: {
            temperature,
          },
        }),
      }
    );
  } catch (error) {
    throw new Error(
      `Unable to connect to Ollama at ${OLLAMA_BASE_URL}: ${error.message}`
    );
  }

  if (!response.ok) {
    const responseText =
      await response.text();

    throw new Error(
      `Ollama generation request failed with status ${response.status}: ${responseText}`
    );
  }

  const data = await response.json();

  if (
    typeof data.response !== "string" ||
    !data.response.trim()
  ) {
    throw new Error(
      "Ollama did not return a valid completion."
    );
  }

  return {
    provider: "ollama",
    model: data.model || model,
    completion: data.response.trim(),
  };
}

/**
 * Streams a completion from Ollama.
 *
 * Ollama returns newline-delimited JSON objects.
 *
 * @param {Object} options
 * @param {string} options.prompt
 * @param {string} [options.model]
 * @param {number} [options.temperature=0.2]
 * @param {(chunk: {
 *   text: string,
 *   done: boolean,
 *   model: string
 * }) => void | Promise<void>} options.onChunk
 *
 * @returns {Promise<{
 *   provider: string,
 *   model: string,
 *   completion: string
 * }>}
 */
export async function streamCompletion({
  prompt,
  model = AI_MODEL,
  temperature = 0.2,
  onChunk,
} = {}) {
  if (
    typeof prompt !== "string" ||
    prompt.trim().length === 0
  ) {
    throw new TypeError(
      "A non-empty prompt is required."
    );
  }

  if (
    typeof temperature !== "number" ||
    temperature < 0 ||
    temperature > 2
  ) {
    throw new TypeError(
      "Temperature must be between 0 and 2."
    );
  }

  if (typeof onChunk !== "function") {
    throw new TypeError(
      "An onChunk callback is required for streaming."
    );
  }

  let response;

  try {
    response = await fetch(
      `${OLLAMA_BASE_URL}/api/generate`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model,
          prompt: prompt.trim(),
          stream: true,

          options: {
            temperature,
          },
        }),
      }
    );
  } catch (error) {
    throw new Error(
      `Unable to connect to Ollama at ${OLLAMA_BASE_URL}: ${error.message}`
    );
  }

  if (!response.ok) {
    const responseText =
      await response.text();

    throw new Error(
      `Ollama streaming request failed with status ${response.status}: ${responseText}`
    );
  }

  if (!response.body) {
    throw new Error(
      "Ollama did not return a readable response stream."
    );
  }

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";
  let completion = "";
  let returnedModel = model;

  while (true) {
    const {
      value,
      done,
    } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(
      value,
      {
        stream: true,
      }
    );

    const lines =
      buffer.split("\n");

    buffer =
      lines.pop() || "";

    for (const line of lines) {
      const trimmedLine =
        line.trim();

      if (!trimmedLine) {
        continue;
      }

      let data;

      try {
        data =
          JSON.parse(trimmedLine);
      } catch {
        throw new Error(
          "Ollama returned an invalid streaming JSON line."
        );
      }

      if (
        typeof data.model === "string" &&
        data.model.trim()
      ) {
        returnedModel =
          data.model.trim();
      }

      const text =
        typeof data.response === "string"
          ? data.response
          : "";

      if (text) {
        completion += text;
      }

      await onChunk({
        text,
        done:
          Boolean(data.done),
        model:
          returnedModel,
      });
    }
  }

  const remaining =
    buffer.trim();

  if (remaining) {
    let data;

    try {
      data =
        JSON.parse(remaining);
    } catch {
      throw new Error(
        "Ollama returned an invalid final streaming JSON line."
      );
    }

    const text =
      typeof data.response === "string"
        ? data.response
        : "";

    if (text) {
      completion += text;
    }

    if (
      typeof data.model === "string" &&
      data.model.trim()
    ) {
      returnedModel =
        data.model.trim();
    }

    await onChunk({
      text,
      done:
        Boolean(data.done),
      model:
        returnedModel,
    });
  }

  if (!completion.trim()) {
    throw new Error(
      "Ollama did not return a valid streamed completion."
    );
  }

  return {
    provider: "ollama",
    model:
      returnedModel,
    completion:
      completion.trim(),
  };
}