/**
 * Account-scoped conversation-history API client.
 *
 * The server derives ownership from the authenticated session. No user id is
 * sent from the browser, so changing a request cannot reveal another account's
 * history.
 */

async function readJson(response) {
    const text = await response.text();

    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

async function request(path, options = {}) {
    const response = await fetch(path, {
        credentials: "same-origin",
        ...options,
    });

    const body = await readJson(response);

    if (!response.ok) {
        const error = new Error(
            body?.error?.message ?? "Conversation history could not be loaded.",
        );

        error.status = response.status;
        error.code = body?.error?.code;
        throw error;
    }

    return body.data;
}

export function listConversations() {
    return request("/api/conversations");
}

export function getConversation(conversationId) {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}`);
}

export function createConversation(message) {
    return request("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
    });
}

export function appendConversationMessage(conversationId, message) {
    return request(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
        },
    );
}
