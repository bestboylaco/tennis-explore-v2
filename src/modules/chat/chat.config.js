import dotenv from "dotenv";

dotenv.config();

// Generation talks to a local Ollama server instead of Amazon Bedrock / Nova
// Pro (TENISE-19's original target), per the project's move away from AWS
// Bedrock (Head project decision, 2026-07-30 — no AWS access, Bedrock policy
// change). Every value has a working default so a missing .env entry does
// not stop the process from starting, matching telemetry.config.js.

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export const chatConfig = Object.freeze({
  ollamaBaseUrl: stripTrailingSlash(
    process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  ),
  generationModel: process.env.OLLAMA_GENERATION_MODEL || "llama3.1:8b",
});
