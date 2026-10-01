import {
    getChatEndpoint,
    getEffortOverride,
    REQUEST_TIMEOUT_MS,
} from "../config.js";

/**
 * Static facts (how many documents this can answer from) shown in the
 * greeting a fresh conversation opens with. Best-effort: if this fails, the
 * greeting is still shown, just without a source count.
 */
export async function getChatInfo() {
    const response = await fetch(`${getChatEndpoint()}/info`, {
        credentials: "same-origin",
    });

    if (!response.ok) {
        throw new ChatApiError(`The request failed with status ${response.status}.`, {
            status: response.status,
        });
    }

    const body = await readResponseBody(response);

    return body?.data ?? {};
}

/**
 * Represents an expected API or network failure.
 */
export class ChatApiError extends Error {
    constructor(
        message,
        {
            status = 0,
            payload = null,
        } = {},
    ) {
        super(message);

        this.name = "ChatApiError";
        this.status = status;
        this.payload = payload;
    }
}

/**
 * Reads either JSON or plain text without crashing when the server
 * returns an unexpected response format.
 */
async function readResponseBody(response) {
    const responseText = await response.text();

    if (!responseText) {
        return {};
    }

    try {
        return JSON.parse(responseText);
    } catch {
        return {
            raw: responseText,
        };
    }
}

/**
 * Sends one natural-language question to the backend.
 *
 * The body carries the question, plus conversationId when there is one, and
 * effort when one is selected. No source, backend route, or role is
 * submitted; the role the query runs as comes off the authenticated session
 * server-side (requireAuth, req.user.roleId), never from anything this
 * client sends.
 *
 * `effort` (TENISE-68) is the one exception to "no mode is offered": the
 * composer's Standard/Fast/Thorough toggle (app.js) passes its current
 * selection as `effort`, defaulting to "" (Standard), which omits the field
 * entirely so an untouched toggle changes nothing server-side. The
 * `?effort=` query-string override from getEffortOverride() still works too
 * (useful for acceptance testing without clicking the toggle) and is used
 * only when the caller does not pass `effort` explicitly.
 */
export async function submitChatQuestion(question,
    conversationId = null,
    effort = null,) {
    const abortController = new AbortController();

    const timeoutId = window.setTimeout(() => {
        abortController.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(getChatEndpoint(), {
            method: "POST",

            headers: {
                "Content-Type": "application/json",

                /*
                * Send the coach's browser timezone so the backend
                * can render response dates in the correct local date.
                *
                * Example:
                * Australia/Brisbane
                * Australia/Sydney
                * Europe/London
                */
                "X-Time-Zone":
                    Intl.DateTimeFormat()
                        .resolvedOptions()
                        .timeZone,
            },

            credentials: "same-origin",

            body: JSON.stringify({
                question,

                ...(
                    typeof conversationId === "string" &&
                        conversationId.trim()
                        ? {
                            conversationId:
                                conversationId.trim(),
                        }
                        : {}
                ),

                ...(() => {
                    const resolvedEffort =
                        (effort === "fast" || effort === "thorough")
                            ? effort
                            : getEffortOverride();

                    return resolvedEffort
                        ? { effort: resolvedEffort }
                        : {};
                })(),
            }),

            signal: abortController.signal,
        });

        const responseBody = await readResponseBody(response);

        if (!response.ok) {
            const errorMessage =
                responseBody?.error?.message ??
                responseBody?.message ??
                `The request failed with status ${response.status}.`;

            throw new ChatApiError(errorMessage, {
                status: response.status,
                payload: responseBody,
            });
        }

        /*
         * The API wraps every success in { success, data }. Returning the
         * envelope made `result.response` undefined in the caller, so every
         * answer rendered as "No answer was returned." while the backend was
         * producing a perfectly good one -- a failure that looks like the model
         * had nothing to say.
         */
        return responseBody?.data ?? responseBody;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new ChatApiError(
                "The request timed out. Please try again.",
                {
                    status: 408,
                },
            );
        }

        if (error instanceof ChatApiError) {
            throw error;
        }

        throw new ChatApiError(
            "Unable to reach the chat service. Check that the server is running.",
            {
                payload: error,
            },
        );
    } finally {
        window.clearTimeout(timeoutId);
    }
}