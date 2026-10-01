import { ApiError } from "./httpClient.js";

async function readResponseBody(response) {
    const text =
        await response.text();

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(
            text,
        );
    } catch {
        return {
            raw:
                text,
        };
    }
}

/**
 * Uploads one private PDF to the authenticated backend ingestion endpoint.
 *
 * Do not set Content-Type manually. The browser must add the multipart
 * boundary generated for FormData.
 */
export async function uploadPrivatePdf(
    file,
    {
        timeoutMs =
            10 * 60 * 1000,
    } = {},
) {
    const formData =
        new FormData();

    formData.append(
        "file",
        file,
    );

    const controller =
        new AbortController();

    const timeoutId =
        window.setTimeout(
            () =>
                controller.abort(),
            timeoutMs,
        );

    try {
        const response =
            await fetch(
                "/api/ingestion/upload",
                {
                    method:
                        "POST",

                    body:
                        formData,

                    headers: {
                        Accept:
                            "application/json",
                    },

                    credentials:
                        "same-origin",

                    signal:
                        controller.signal,
                },
            );

        const body =
            await readResponseBody(
                response,
            );

        if (!response.ok) {
            throw new ApiError(
                body?.error?.message ??
                    body?.message ??
                    `The upload failed with status ${response.status}.`,
                {
                    status:
                        response.status,

                    code:
                        body?.error?.code ??
                        null,

                    payload:
                        body,
                },
            );
        }

        return (
            body?.data ??
            body
        );
    } catch (error) {
        if (
            error?.name ===
            "AbortError"
        ) {
            throw new ApiError(
                "The PDF upload timed out while the report was being indexed.",
                {
                    status:
                        408,

                    code:
                        "UPLOAD_TIMEOUT",
                },
            );
        }

        if (
            error instanceof
            ApiError
        ) {
            throw error;
        }

        throw new ApiError(
            "Unable to reach the server. Check that TennisExplore is running.",
            {
                code:
                    "NETWORK_ERROR",

                payload:
                    error,
            },
        );
    } finally {
        window.clearTimeout(
            timeoutId,
        );
    }
}
