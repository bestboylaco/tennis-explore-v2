import { submitChatQuestion } from "./api/chatApi.js";
import { appendAssistantMessage, appendUserMessage } from "./ui/messageRenderer.js";
import { createProcessingStatus } from "./ui/processingStatus.js";
import { createSourcePanel } from "./ui/sourcePanel.js";

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
const roleSelect = getRequiredElement("#role");
const errorBanner = getRequiredElement("#error-banner");
const errorMessage = getRequiredElement("#error-message");
const dismissErrorButton = getRequiredElement("#dismiss-error-button");

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
}

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const question = questionInput.value.trim();

    if (question === "") return;

    appendUserMessage({ conversation, content: question });

    questionInput.value = "";
    resizeInput();
    setBusy(true);
    status.start();

    try {
        const result = await submitChatQuestion(question, roleSelect.value);
        const response = result?.response ?? {};

        appendAssistantMessage({
            conversation,
            content: response.answer ?? "No answer was returned.",
            citations: result?.citations ?? [],
            // present only when the question was answered from the tables. the
            // renderer ignores them when absent, so one code path covers both.
            table: response.table ?? null,
            sql: response.sql ?? null,
            grounding: response.grounding ?? null,
            openCitation: sourcePanel.open,
        });
    } catch (error) {
        showError(error?.message ?? "The request could not be completed.");
    } finally {
        setBusy(false);
        status.ready();
        questionInput.focus();
    }
});

questionInput.focus();
