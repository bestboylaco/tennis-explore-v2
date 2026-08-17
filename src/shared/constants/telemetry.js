// These lists are conventions, not database constraints. The telemetry record
// deliberately does not enum-validate stage names, query classes or API types.

export const TELEMETRY_SCHEMA_VERSION = 2;


export const TELEMETRY_RUN_TYPES = Object.freeze({
  STARTUP: "startup",
  INGESTION: "ingestion",
  QUERY: "query",
  API_REQUEST: "api_request",
});


export const PIPELINE_STAGES = Object.freeze({
  ROUTING: "routing",
  RETRIEVAL: "retrieval",
  RERANK: "rerank",
  GENERATION: "generation",
});

export const PIPELINE_STAGE_NAMES = Object.freeze(Object.values(PIPELINE_STAGES));


export const INGESTION_STAGES = Object.freeze({
  FETCH_SOURCE: "fetch_source",
  EXTRACT: "extract",
  CHUNK: "chunk",
  EMBED: "embed",
  INDEX: "index",
});

export const STAGE_STATUSES = Object.freeze({
  NOT_IMPLEMENTED: "not_implemented",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const RUN_STATUSES = Object.freeze({
  RUNNING: "running",
  SUCCESS: "success",
  PARTIAL: "partial",
  FAILED: "failed",
});

// Query classes. Routing (E3-09 / Epic 3) will eventually split statistics
// questions from document questions. Only "document" is reachable in Sprint 1;
// the tag exists now so aggregation by class never needs a backfill.
export const QUERY_CLASSES = Object.freeze({
  DOCUMENT: "document",
  STATISTICS: "statistics",
  NOT_APPLICABLE: "not_applicable",
});

export const DEFAULT_QUERY_CLASS = QUERY_CLASSES.DOCUMENT;

// API types that ingestion volume is split by, because each is billed on a
// different unit (Textract per page, embeddings per token, S3 per object).
export const API_TYPES = Object.freeze({
  LOCAL: "local",
  S3: "s3",
  TEXTRACT: "textract",
  BEDROCK_KNOWLEDGE_BASE: "bedrock_knowledge_base",
  BEDROCK_EMBEDDING: "bedrock_embedding",
  BEDROCK_AGENT: "bedrock_agent",
  BEDROCK_RERANK: "bedrock_rerank",
  NOVA_PRO: "nova_pro",
  OPENSEARCH: "opensearch",
  // Local generation via Ollama, standing in for Bedrock/Nova Pro (TENISE-19)
  // now that the project runs without AWS access.
  OLLAMA_GENERATION: "ollama_generation",
});

// Resources that can cold start. OpenSearch Serverless NextGen is the one that
// matters: its recovery is roughly 10 seconds and would otherwise sit in the
// same latency distribution as warm requests.
export const COLD_START_RESOURCES = Object.freeze({
  OPENSEARCH: "opensearch_serverless",
  BEDROCK_AGENT: "bedrock_agent",
  BEDROCK_RUNTIME: "bedrock_runtime",
  MONGODB: "mongodb",
  // A local Ollama model that has not been called recently gets unloaded from
  // memory and must be reloaded, observed to take up to ~30s on this project's
  // hardware for an 8B model. Same distortion risk as OpenSearch NextGen.
  OLLAMA: "ollama",
});

export const DEFAULT_COLD_START_THRESHOLD_MS = 5000;

// Per-resource thresholds override the default where the expected warm latency
// is known to be different.
export const COLD_START_THRESHOLDS_MS = Object.freeze({
  [COLD_START_RESOURCES.OPENSEARCH]: 5000,
  [COLD_START_RESOURCES.BEDROCK_AGENT]: 4000,
  [COLD_START_RESOURCES.BEDROCK_RUNTIME]: 4000,
  [COLD_START_RESOURCES.MONGODB]: 2000,
  [COLD_START_RESOURCES.OLLAMA]: 8000,
});

// Resources whose compute time is charged, for the OCU-seconds figure TENISE-27
// needs. Free strings like API_TYPES: a new billed resource is a new key.
export const COMPUTE_RESOURCES = Object.freeze({
  OLLAMA: "ollama",
  QDRANT: "qdrant",
  OPENSEARCH: "opensearch",
  MONGODB: "mongodb",
});

// OCU-equivalents held by each resource while it serves a request. Multiplied
// by the measured seconds to give OCU-seconds.

export const DEFAULT_OCU_RATES = Object.freeze({
  [COMPUTE_RESOURCES.OLLAMA]: 1,
  [COMPUTE_RESOURCES.QDRANT]: 1,
  [COMPUTE_RESOURCES.OPENSEARCH]: 1,
  [COMPUTE_RESOURCES.MONGODB]: 1,
});

export const DEFAULT_OCU_RATE = 1;

// How the OCU figure was arrived at. "estimated" is seconds x a configured
// rate; "billing" would be a figure taken from a provider invoice.
export const OCU_BASES = Object.freeze({
  ESTIMATED: "estimated",
  BILLING: "billing",
});

// Attribute values are capped so no raw document or query content can reach the
// telemetry store through the free-form attribute map (threat model T-04).
export const MAX_ATTRIBUTE_LENGTH = 200;
