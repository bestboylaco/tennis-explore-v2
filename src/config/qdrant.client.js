import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "./env.js";

export const qdrantClient = new QdrantClient({
  url: env.QDRANT_URL,
  apiKey: env.QDRANT_API_KEY || undefined,
});