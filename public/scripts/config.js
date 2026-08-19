/**
 * Default backend endpoint used by the unified chat interface.
 */
export const DEFAULT_CHAT_ENDPOINT = "/api/chat";

/**
 * Stops the interface from displaying an endless processing state
 * when the backend does not respond.
 */
// A local 8b model doing retrieval, grading, reranking and generation takes
// tens of seconds on consumer hardware -- measured at 20-56s on an 8 GB card.
// The old 15s ceiling aborted every real request, which surfaced as "failed to
// complete request" and looked like a backend fault when the backend was fine.
export const REQUEST_TIMEOUT_MS = 180_000;

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
 * Read-only telemetry API backing the debugging dashboard.
 *
 * GET /api/telemetry             list of records
 * GET /api/telemetry/summary     the seven aggregations
 * GET /api/telemetry/:recordId   a single record
 */
export const TELEMETRY_ENDPOINT = "/api/telemetry";

/**
 * The summary endpoint runs seven aggregations, so it is given a wider budget
 * than the 15 second chat request rather than sharing it.
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