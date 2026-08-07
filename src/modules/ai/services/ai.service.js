import {
  orchestrateKnowledgeRetrieval,
} from "../../orchestration/index.js";

import {
  buildKnowledgePrompt,
} from "./promptBuilder.service.js";

import {
  generateCompletion,
  streamCompletion,
} from "./generationProvider.js";

import {
  formatAIAnswer,
  formatNoEvidenceAnswer,
} from "./answerFormatter.service.js";

import {
  buildCitations,
} from "./citationBuilder.service.js";

/**
 * Answer a knowledge question using metadata-aware
 * orchestration and the uploaded knowledge base.
 *
 * @param {Object} options
 * @param {string} options.question
 * @param {number} [options.limit=5]
 * @param {number} [options.temperature=0.2]
 *
 * @returns {Promise<Object>}
 */
export async function answerKnowledgeQuestion({
  question,
  limit = 5,
  temperature = 0.2,
} = {}) {
  const orchestration =
    await orchestrateKnowledgeRetrieval({
      question,
      finalLimit: limit,
    });

  const mergedEvidence =
    orchestration.mergedEvidence;

  const evidence =
    mergedEvidence.evidence;

  const evidenceConfidence =
    mergedEvidence.summary;

  const evidenceConsensus =
    mergedEvidence.consensus;

  const citationResult =
    buildCitations({
      evidence,
    });

  const promptResult =
    buildKnowledgePrompt({
      question,
      contextResult:
        orchestration.context,
    });

  if (
    !orchestration.context.hasEvidence ||
    !promptResult.hasEvidence ||
    !promptResult.prompt
  ) {
    return formatNoEvidenceAnswer({
      question,
      provider: "ollama",
      model: null,
    });
  }

  const {
    completion,
    provider,
    model,
  } = await generateCompletion({
    prompt:
      promptResult.prompt,

    temperature,
  });

  return formatAIAnswer({
    question,
    completion,

    citations:
      citationResult.citations,

    evidenceConfidence,
    evidenceConsensus,

    provider,
    model,
  });
}

/**
 * Stream an answer as it is generated.
 *
 * @param {Object} options
 * @param {string} options.question
 * @param {Function} options.onChunk
 * @param {number} [options.limit=5]
 * @param {number} [options.temperature=0.2]
 */
export async function answerKnowledgeQuestionStream({
  question,
  onChunk,
  limit = 5,
  temperature = 0.2,
} = {}) {
  if (typeof onChunk !== "function") {
    throw new TypeError(
      "An onChunk callback is required."
    );
  }

  const orchestration =
    await orchestrateKnowledgeRetrieval({
      question,
      finalLimit: limit,
    });

  const mergedEvidence =
    orchestration.mergedEvidence;

  const evidence =
    mergedEvidence.evidence;

  const evidenceConfidence =
    mergedEvidence.summary;

  const evidenceConsensus =
    mergedEvidence.consensus;

  const citationResult =
    buildCitations({
      evidence,
    });

  const promptResult =
    buildKnowledgePrompt({
      question,
      contextResult:
        orchestration.context,
    });

  if (
    !orchestration.context.hasEvidence ||
    !promptResult.hasEvidence ||
    !promptResult.prompt
  ) {
    return formatNoEvidenceAnswer({
      question,
      provider: "ollama",
      model: null,
    });
  }

  const {
    completion,
    provider,
    model,
  } = await streamCompletion({
    prompt:
      promptResult.prompt,

    temperature,

    onChunk,
  });

  return formatAIAnswer({
    question,
    completion,

    citations:
      citationResult.citations,

    evidenceConfidence,
    evidenceConsensus,

    provider,
    model,
  });
}