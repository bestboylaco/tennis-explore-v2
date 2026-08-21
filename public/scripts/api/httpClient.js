/**
 * Represents an expected API or network failure.
 *
 * `code` carries the backend's machine-readable error code where one was
 * returned, so a caller can tell a rejected filter (INVALID_SOURCE_ID) apart
 * from a missing record (TELEMETRY_RECORD_NOT_FOUND) without matching on the
 * message text.
 */
export class ApiError extends Error {
    constructor(
        message,
        {
            status = 0,
            code = null,
            payload = null,
        } = {},
    ) {
        super(message);

        this.name = "ApiError";
        this.status = status;
        this.code = code;
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
 * Performs a JSON GET request with a timeout.
 *
 * The backend error envelope is { success: false, error: { code, message } },
 * and the message is surfaced as-is. A rejected filter explains what is wrong
 * with it, which a generic "request failed" would throw away.
 */
export async function requestJson(
    url,
    {
        timeoutMs = 15_000,
        signal = null,
    } = {},
) {
    const abortController = new AbortController();

    const timeoutId = window.setTimeout(() => {
        abortController.abort();
    }, timeoutMs);

    /*
     * A caller-supplied signal cancels the request as well, so a superseded
     * refresh does not have to wait out its own timeout.
     */
    if (signal) {
        if (signal.aborted) {
            abortController.abort();
        } else {
            signal.addEventListener(
                "abort",
                () => abortController.abort(),
                { once: true },
            );
        }
    }

    try {
        const response = await fetch(url, {
            method: "GET",

            headers: {
                Accept: "application/json",
            },

            // Sent explicitly rather than relying on fetch's same-origin
            // default -- requireAuth reads this cookie, so the intent
            // should be visible in the code (see authApi.js).
            credentials: "same-origin",

            signal: abortController.signal,
        });

        const responseBody =
            await readResponseBody(response);

        if (!response.ok) {
            const errorMessage =
                responseBody?.error?.message ??
                responseBody?.message ??
                `The request failed with status ${response.status}.`;

            throw new ApiError(errorMessage, {
                status: response.status,
                code: responseBody?.error?.code ?? null,
                payload: responseBody,
            });
        }

        return responseBody;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new ApiError(
                `The request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
                {
                    status: 408,
                    code: "REQUEST_TIMEOUT",
                },
            );
        }

        if (error instanceof ApiError) {
            throw error;
        }

        throw new ApiError(
            "Unable to reach the server. Check that it is running.",
            {
                code: "NETWORK_ERROR",
                payload: error,
            },
        );
    } finally {
        window.clearTimeout(timeoutId);
    }
}
