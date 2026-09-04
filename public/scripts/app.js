import { submitChatQuestion } from "./api/chatApi.js";
import { getCurrentUser, logout } from "./api/authApi.js";
import { appendAssistantMessage, appendUserMessage } from "./ui/messageRenderer.js";
import { createProcessingStatus } from "./ui/processingStatus.js";
import { createSourcePanel } from "./ui/sourcePanel.js";
import { createChatHistory } from "./ui/chatHistory.js";

/*
 * A role can no longer be picked in this interface -- it is a fact about
 * the signed-in account (req.user.roleId, set at login from the session).
 * An unauthenticated visitor is sent to /login before any of the rest of
 * this file runs; nothing below assumes a session exists.
 */
const currentUser = await getCurrentUser();

if (!currentUser) {
    window.location.replace("/login");
    throw new Error("Redirecting to sign in.");
}

/**
 * Returns a required page element, or throws a clear startup error.
 *
 * Failing loudly here beats a null reference three interactions later, when the
 * cause is much harder to see.
 */
function getRequiredElement(selector) {
    const element = document.querySelector(selector);

    if (!element) {
        throw new Error(`Required interface element was not found: ${selector}`);
    }

    return element;
}

const chatForm = getRequiredElement("#chat-form");
const questionInput = getRequiredElement("#question");
const sendButton = getRequiredElement("#send-button");
const conversation = getRequiredElement("#conversation");
const errorBanner = getRequiredElement("#error-banner");
const errorMessage = getRequiredElement("#error-message");
const dismissErrorButton = getRequiredElement("#dismiss-error-button");

const userBadge = getRequiredElement("#user-badge");
const userBadgeRole = getRequiredElement("#user-badge-role");
const logoutButton = getRequiredElement("#logout-button");

userBadgeRole.textContent = currentUser.displayName;
userBadge.hidden = false;

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    await logout();
    window.location.assign("/login");
});

const status = createProcessingStatus({
    statusIndicator: getRequiredElement("#processing-status"),
    statusText: getRequiredElement("#status-text"),
    processingMessage: getRequiredElement("#processing-message"),
    conversation,
});

/*
 * Cited sources open in a panel beside the conversation rather than in a new
 * tab. Losing your place in the conversation to read a citation is exactly what
 * the partner asked us to avoid.
 */
const sourcePanel = createSourcePanel({
    panel: getRequiredElement("#source-panel"),
    titleNode: getRequiredElement("#source-panel-title"),
    metaNode: getRequiredElement("#source-panel-meta"),
    bodyNode: getRequiredElement("#source-panel-body"),
    closeButton: getRequiredElement("#source-panel-close"),
    downloadLink: getRequiredElement("#source-panel-download"),
});

/**
 * Rebuilds the visible transcript when a history item is selected.
 *
 * The processing indicator stays mounted because processingStatus keeps a
 * reference to it. Only rendered user/assistant message rows are replaced.
 */
function renderConversation(messages) {
    sourcePanel.close();
    clearError();

    for (const message of conversation.querySelectorAll(".message")) {
        message.remove();
    }

    for (const message of messages) {
        if (message.role === "user") {
            appendUserMessage({
                conversation,
                content: message.content,
            });
            continue;
        }

        if (message.role === "assistant") {
            appendAssistantMessage({
                conversation,
                content: message.content,
                citations: message.citations ?? [],
                table: message.table ?? null,
                sql: message.sql ?? null,
                grounding: message.grounding ?? null,
                openCitation: sourcePanel.open,
            });
        }
    }

    conversation.scrollTop = conversation.scrollHeight;
    questionInput.focus();
}

/*
 * This is intentionally a UI-only history prototype. Conversation content is
 * kept in page memory and is cleared on refresh; account-level persistence is
 * a separate backend/security decision.
 */
const chatHistory = createChatHistory({
    toggleButton: getRequiredElement("#chat-history-toggle"),
    panel: getRequiredElement("#chat-history-panel"),
    list: getRequiredElement("#chat-history-list"),
    emptyState: getRequiredElement("#chat-history-empty"),
    countNode: getRequiredElement("#chat-history-count"),
    newChatButton: getRequiredElement("#new-chat-button"),
    onSelectConversation: ({ messages }) => {
        status.ready();
        renderConversation(messages);
    },
});

function showError(message) {
    errorMessage.textContent = message;
    errorBanner.hidden = false;
}

function clearError() {
    errorBanner.hidden = true;
    errorMessage.textContent = "";
}

dismissErrorButton.addEventListener("click", clearError);

/**
 * Grows the textarea with its content, up to the CSS max-height.
 */
function resizeInput() {
    questionInput.style.height = "auto";
    questionInput.style.height = `${questionInput.scrollHeight}px`;
}

questionInput.addEventListener("input", resizeInput);

/*
 * Quick-start cards only populate the same natural-language input. They do
 * not select a route, query mode, source or model, so the existing backend
 * dispatch and access-control behaviour remains unchanged.
 */
const suggestedQuestionButtons = document.querySelectorAll(
    "[data-suggested-question]",
);

for (const button of suggestedQuestionButtons) {
    button.addEventListener("click", () => {
        questionInput.value = button.dataset.suggestedQuestion ?? "";
        resizeInput();
        questionInput.focus();
    });
}

// Enter sends, Shift+Enter starts a new line -- the convention every chat
// interface uses, and the one people try first.
questionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chatForm.requestSubmit();
    }
});

function setBusy(busy) {
    sendButton.disabled = busy;
    questionInput.disabled = busy;
    chatHistory.setBusy(busy);
}

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const question = questionInput.value.trim();

    if (question === "") return;

    chatHistory.recordUserMessage(question);
    appendUserMessage({ conversation, content: question });

    questionInput.value = "";
    resizeInput();
    setBusy(true);
    status.start();

    try {
        const result = await submitChatQuestion(question);
        const response = result?.response ?? {};

        const assistantMessage = {
            content: response.answer ?? "No answer was returned.",
            citations: result?.citations ?? [],
            // present only when the question was answered from the tables. the
            // renderer ignores it when absent, so one code path covers both.
            // the SQL behind it is not repeated here -- it is the same block
            // the "Sources" citation already opens in the side panel.
            table: response.table ?? null,
            grounding: response.grounding ?? null,
        };

        chatHistory.recordAssistantMessage(assistantMessage);

        appendAssistantMessage({
            conversation,
            ...assistantMessage,
            openCitation: sourcePanel.open,
        });
    } catch (error) {
        // The session expired (8h max age) or was ended elsewhere. Sending
        // the question again would just 401 a second time -- go sign in
        // again instead of leaving a confusing error in the transcript.
        if (error?.status === 401) {
            window.location.assign("/login");
            return;
        }

        showError(error?.message ?? "The request could not be completed.");
    } finally {
        setBusy(false);
        status.ready();
        questionInput.focus();
    }
});

questionInput.focus();
