export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ||
  "http://localhost:11434";

export const AI_MODEL =
  process.env.AI_MODEL ||
  "llama3.1:8b";

export const DEFAULT_AI_OPTIONS =
  Object.freeze({
    retrievalLimit: 5,
    temperature: 0.2,
  });

export const AI_RESPONSE_STATUS =
  Object.freeze({
    ANSWERED: "answered",
    NO_EVIDENCE: "no_evidence",
  });