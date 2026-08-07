import dotenv from "dotenv";

dotenv.config();

const requiredVariables = [
  "PORT",
  "MONGODB_URI",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

const port = Number(process.env.PORT);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",

  port,

  mongodbUri: process.env.MONGODB_URI,

  ollamaBaseUrl:
    process.env.OLLAMA_BASE_URL || "http://localhost:11434",

  embeddingProvider:
    process.env.EMBEDDING_PROVIDER || "ollama",

  embeddingModel:
    process.env.EMBEDDING_MODEL || "nomic-embed-text",

  qdrantUrl:
    process.env.QDRANT_URL || "http://localhost:6333",

  qdrantApiKey:
    process.env.QDRANT_API_KEY || "",

  qdrantCollection:
    process.env.QDRANT_COLLECTION || "knowledge_chunks",
});