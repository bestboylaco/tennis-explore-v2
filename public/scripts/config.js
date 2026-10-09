/**
 * Default backend endpoint used by the unified chat interface.
 *
 * /api/chat (answer.service.js) rather than /api/chat/v2
 * (agentOrchestrator.service.js/routingAgent.service.js) -- v2's routing
 * agent has no chitchat handling and asks the model for JSON in plain prose
 * rather than through Ollama's `format` schema constraint, so a bare
 * greeting ("Hi!") gets a conversational reply instead of JSON and the
 * request 500s (observed live, 2026-09-17). v1 has that constraint
 * (queryPlanner.service.js's PLAN_SCHEMA), a real chitchat short-circuit,
 * and this session's false-refusal and reranking work; v2 does not yet.
 * Revisit once v2 is brought up to the same standard.
 */
export const DEFAULT_CHAT_ENDPOINT = "/api/chat";

/**
 * Stops the interface from displaying an endless processing state
 * when the backend does not respond.
 *
 * Keyed by effort (see the composer's effort control) rather than one flat
 * number. A local 8b model doing retrieval, grading, reranking and
 * generation takes tens of seconds on consumer hardware, measured at
 * 20-130s on an 8 GB card depending on question complexity, and the old
 * 15s ceiling aborted every real request, which surfaced as "failed to
 * complete request" and looked like a backend fault when the backend was
 * fine.
 *
 * The backend's citation-repair pass now always runs when something needs
 * fixing, on both effort levels -- it used to be skippable past a time
 * budget, which meant the one check that exists to catch an uncited answer
 * was the thing most likely to be skipped on exactly the slow, complex
 * questions that needed it (reported directly, 2026-10-01, "no citations
 * at all" reaching the user twice this way). Both ceilings here are sized
 * with that in mind: generous ceilings that should rarely be hit, not
 * numbers tuned to the common case, since this is now the only thing
 * standing between a slow answer and the repair pass actually finishing.
 */
export const REQUEST_TIMEOUT_MS_BY_EFFORT = Object.freeze({
    low: 240_000,
    high: 600_000,
});

/**
 * A query-string override is provided only for acceptance testing.
 *
 * Example:
 * http://localhost:3000/?endpoint=/api/chat/fail
 *
 * This is not shown as a control in the user interface, so the coach
 * is never required to choose a backend route.
 */
export function getChatEndpoint() {
    const searchParameters = new URLSearchParams(
        window.location.search,
    );

    const endpointOverride =
        searchParameters.get("endpoint");

    if (
        endpointOverride &&
        endpointOverride.startsWith("/api/")
    ) {
        return endpointOverride;
    }

    return DEFAULT_CHAT_ENDPOINT;
}

/**
 * A query-string override for the per-request effort level (TENISE-68).
 *
 * The composer has a visible Low Effort / High Effort select (app.js) -- a
 * deliberate product decision to offer this choice, unlike `endpoint`
 * above. This function stays as a secondary path: useful for acceptance
 * testing or sharing a link pre-set to a level without touching the
 * select. `chatApi.js`'s `submitChatQuestion` only falls back to this when
 * its caller does not pass an explicit `effort` argument, so the select
 * always wins when both are present.
 *
 * Example:
 * http://localhost:3000/?effort=high
 */
export function getEffortOverride() {
    const searchParameters = new URLSearchParams(
        window.location.search,
    );

    const effortOverride =
        searchParameters.get("effort");

    return (
        effortOverride === "low" ||
        effortOverride === "high"
    )
        ? effortOverride
        : null;
}

/**
 * Read-only telemetry API backing the debugging dashboard.
 *
 * GET /api/telemetry             list of records
 * GET /api/telemetry/summary     the seven aggregations
 * GET /api/telemetry/:recordId   a single record
 */
export const TELEMETRY_ENDPOINT = "/api/telemetry";

/**
 * The summary endpoint runs seven aggregations, so it is given its own budget
 * rather than sharing the chat request's.
 *
 * That budget is now much shorter than REQUEST_TIMEOUT_MS_BY_EFFORT, not longer: chat
 * waits on a local model doing retrieval and generation, while these are
 * database aggregations. Twenty seconds is generous for them, and a dashboard
 * that hangs for three minutes on a slow query is worse than one that fails.
 */
export const TELEMETRY_REQUEST_TIMEOUT_MS = 20_000;

/**
 * The records list asks for fewer rows than the backend default of 100.
 *
 * The list endpoint returns whole records, each carrying its full stage map, so
 * a hundred of them is a large payload for a page that shows nine columns.
 */
export const TELEMETRY_DEFAULT_LIMIT = 25;

/*
 * Filter options for the telemetry dashboard.
 *
 * These values are copied from src/shared/constants/telemetry.js, which opens
 * by stating that its lists are conventions rather than database constraints.
 * runType and queryClass are stored as free strings and are not enum-validated,
 * so the backend will accept and store a value that is not listed here and this
 * dropdown will silently stop covering it. A value added there has to be added
 * here by hand.
 *
 * Run status is the exception: telemetryRecord.model.js does enum-validate it
 * against RUN_STATUSES, so that list cannot drift without a schema change.
 */

export const TELEMETRY_RUN_TYPE_OPTIONS = [
    { value: "startup", label: "Startup" },
    { value: "ingestion", label: "Ingestion" },
    { value: "query", label: "Query" },
    { value: "api_request", label: "API request" },
];

export const TELEMETRY_QUERY_CLASS_OPTIONS = [
    { value: "document", label: "Document" },
    { value: "statistics", label: "Statistics" },
    { value: "not_applicable", label: "Not applicable" },
];

export const TELEMETRY_STATUS_OPTIONS = [
    { value: "running", label: "Running" },
    { value: "success", label: "Success" },
    { value: "partial", label: "Partial" },
    { value: "failed", label: "Failed" },
];

/**
 * The run type whose ingestion counters are populated.
 *
 * aggregateIngestionVolume returns an empty structure for every other run type
 * by design, so the dashboard needs to know which filter values make the
 * ingestion section applicable at all.
 */
export const TELEMETRY_INGESTION_RUN_TYPE = "ingestion";