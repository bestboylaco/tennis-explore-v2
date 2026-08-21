import { getCurrentUser, login, LoginError } from "./api/authApi.js";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitButton = document.getElementById("login-button");
const errorBox = document.getElementById("login-error");

function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
}

// Already signed in (e.g. followed a bookmark back to /login) -- go
// straight to the app rather than asking for credentials again.
const existingUser = await getCurrentUser();

if (existingUser) {
    window.location.replace("/explore");
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    submitButton.disabled = true;

    try {
        await login(emailInput.value.trim(), passwordInput.value);
        window.location.assign("/explore");
    } catch (error) {
        showError(
            error instanceof LoginError
                ? error.message
                : "Unable to reach the server. Please try again.",
        );
        submitButton.disabled = false;
    }
});
