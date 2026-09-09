async function request(
    url,
    options = {},
) {
    const response = await fetch(
        url,
        {
            credentials: "same-origin",

            /*
             * User preferences should always reflect the current
             * account state rather than a cached API response.
             */
            cache: "no-store",

            ...options,

            headers: {
                Accept: "application/json",

                ...(options.body
                    ? {
                        "Content-Type":
                            "application/json",
                    }
                    : {}),

                ...(options.headers ?? {}),
            },
        },
    );

    let body = null;

    try {
        body = await response.json();
    } catch {
        body = null;
    }

    if (!response.ok) {
        const error = new Error(
            body?.error?.message ??
            `Quick Questions request failed with status ${response.status}.`,
        );

        error.status =
            response.status;

        throw error;
    }

    if (
        body?.success === false
    ) {
        const error = new Error(
            body?.error?.message ??
            "Quick Questions request failed.",
        );

        error.status =
            response.status;

        throw error;
    }

    return body?.data ?? {};
}


export async function getQuickQuestions() {
    const data =
        await request(
            "/api/quickquestions",
            {
                method: "GET",
            },
        );

    return Array.isArray(
        data.quickQuestions,
    )
        ? data.quickQuestions
        : [];
}


export async function saveQuickQuestions(
    quickQuestions,
) {
    console.log(
        "[QuickQuestions] Sending save request",
        quickQuestions,
    );

    const data =
        await request(
            "/api/quickquestions",
            {
                method: "PUT",

                body: JSON.stringify({
                    quickQuestions,
                }),
            },
        );

    console.log(
        "[QuickQuestions] Save response received",
        data,
    );

    return Array.isArray(
        data.quickQuestions,
    )
        ? data.quickQuestions
        : [];
}