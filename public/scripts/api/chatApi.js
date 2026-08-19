import {
    getChatEndpoint,
    REQUEST_TIMEOUT_MS,
} from "../config.js";

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
 * The body carries only the question. No mode, source, command, model,
 * route -- or role -- is submitted; the role the query runs as comes off
 * the authenticated session server-side (requireAuth, req.user.roleId),
 * never from anything this client sends.
 */
export async function submitChatQuestion(question) {
    const abortController = new AbortController();

    const timeoutId = window.setTimeout(() => {
        abortController.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(getChatEndpoint(), {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            credentials: "same-origin",

            body: JSON.stringify({ question }),

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