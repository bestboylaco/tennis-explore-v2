import { chatConfig } from "../chat.config.js";
import {
  buildGenerationMessages,
  GENERATION_PROMPT_VERSION,
} from "../prompts/generationPrompt.js";
import {
  API_TYPES,
  COLD_START_RESOURCES,
  COMPUTE_RESOURCES,
  PIPELINE_STAGES,
} from "../../../shared/constants/telemetry.js";
import { withColdStartDetection } from "../../telemetry/services/telemetryRecorder.service.js";

// Generation stage of the RAG pipeline (TENISE-19). Talks to a local Ollama
// server instead of Amazon Bedrock / Nova Pro, per the project's move away
// from AWS Bedrock (Head project decision, 2026-07-30).

export class GenerationError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "GenerationError";
    this.code = "GENERATION_FAILED";
    this.statusCode = 502;

    if (cause) {
      this.cause = cause;
    }
  }
}

async function callOllamaChat(messages) {
  const url = `${chatConfig.ollamaBaseUrl}/api/chat`;

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chatConfig.generationModel,
        messages,
        stream: false,
      }),
    });
  } catch (error) {
    throw new GenerationError(
      `Could not reach the Ollama server at ${url}. Is Ollama running?`,
      { cause: error },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");

    throw new GenerationError(
      `Ollama chat request failed with status ${response.status}: ${body}`,
    );
  }

  return response.json();
}

async function runGeneration(messages) {
  const startedAtMs = Date.now();
  const result = await callOllamaChat(messages);

  const tokensIn = result.prompt_eval_count ?? 0;
  const tokensOut = result.eval_count ?? 0;

  return {
    answer: result.message?.content ?? "",
    model: chatConfig.generationModel,
    promptVersion: GENERATION_PROMPT_VERSION,
    tokensIn,
    tokensOut,
    durationMs: Date.now() - startedAtMs,
    // Picked up by telemetryRecorder's measureStage, which merges a result's
    // `telemetry` object into the stage record -- token counts are only known
    // once the call returns, so they cannot be passed as static metrics.
    //
    // The model and prompt version travel with the counts so a token figure
    // says which call produced it: comparing two weeks of token counts is
    // meaningless if the model changed in between.
    telemetry: {
      tokensIn,
      tokensOut,
      attributes: {
        model: chatConfig.generationModel,
        promptVersion: GENERATION_PROMPT_VERSION,
      },
    },
  };
}

/**
 * Generates an answer grounded in the given evidence set.
 *
 * evidence is passed explicitly (rather than fetched here) so this stage is
 * testable in isolation, per TENISE-19's control tests: forced-empty
 * evidence, and evidence carrying a deliberately incorrect fact. Real
 * retrieval (TENISE-15/17) plugs in by supplying evidence from upstream.
 */
export async function generateAnswer({ question, evidence = [], recorder = null }) {
  if (typeof question !== "string" || question.trim() === "") {
    throw new Error("generateAnswer requires a non-empty question.");
  }

  const messages = buildGenerationMessages({ question, evidence });

  if (!recorder) {
    return runGeneration(messages);
  }

  return withColdStartDetection(
    recorder,
    { resource: COLD_START_RESOURCES.OLLAMA, stage: PIPELINE_STAGES.GENERATION },
    () =>
      recorder.measureStage(PIPELINE_STAGES.GENERATION, () => runGeneration(messages), {
        apiType: API_TYPES.OLLAMA_GENERATION,
        itemsIn: evidence.length,
        apiCalls: 1,
        // Charges this stage's measured duration to the model host, giving the
        // OCU-seconds figure TENISE-27 needs per query.
        ocuResource: COMPUTE_RESOURCES.OLLAMA,
      }),
  );
}
