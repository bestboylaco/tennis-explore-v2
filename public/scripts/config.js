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