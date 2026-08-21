/**
 * Thin client for the session-based auth endpoints. Every call sends
 * cookies explicitly (credentials: "same-origin") rather than relying on
 * fetch's default, so the intent is visible in the code, not implicit in
 * browser behaviour.
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

/**
 * Returns the signed-in account, or null when there isn't one. Never
 * throws for "not signed in" -- that is an expected state, not an error.
 */
export async function getCurrentUser() {
    const response = await fetch("/api/auth/me", {
        credentials: "same-origin",
    });

    const body = await readJson(response);

    return body?.data ?? null;
}

export class LoginError extends Error {}

export async function login(email, password) {
    const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
    });

    const body = await readJson(response);

    if (!response.ok) {
        throw new LoginError(body?.error?.message ?? "Sign in failed.");
    }

    return body.data;
}

export async function logout() {
    await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
    });
}
