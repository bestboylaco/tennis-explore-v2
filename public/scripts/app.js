import { submitChatQuestion } from "./api/chatApi.js";
import { createCitationDialog } from "./ui/citationDialog.js";
import {
    appendAssistantMessage,
    appendUserMessage,
} from "./ui/messageRenderer.js";
import { createProcessingStatus } from "./ui/processingStatus.js";

/**
 * Returns a required page element or throws a clear startup error.
 */
function getRequiredElement(selector) {
    const element = document.querySelector(selector);

    if (!element) {
        throw new Error(
            `Required interface element was not found: ${selector}`,
        );
    }

    return element;
}

const chatForm = getRequiredElement("#chat-form");
const questionInput = getRequiredElement("#question");
const sendButton = getRequiredElement("#send-button");
const conversation = getRequiredElement("#conversation");

const statusIndicator = getRequiredElement(
    "#processing-status",
);

const statusText = getRequiredElement("#status-text");

const processingMessage = getRequiredElement(
    "#processing-message",
);

const errorBanner = getRequiredElement("#error-banner");
const errorMessage = getRequiredElement("#error-message");

const dismissErrorButton = getRequiredElement(
    "#dismiss-error-button",
);

const citationDialogElement = getRequiredElement(
    "#citation-dialog",
);

const citationTitle = getRequiredElement(
    "#citation-title",
);

const citationExcerpt = getRequiredElement(
    "#citation-excerpt",
);

const citationLink = getRequiredElement(
    "#citation-link",
);

const citationCloseButton = getRequiredElement(
    "#citation-close-button",
);

const citationDoneButton = getRequiredElement(
    "#citation-done-button",
);

const welcomeCard =
    document.querySelector(".welcome-card");

const exploreButtons = document.querySelectorAll(
    "[data-suggested-question]",
);

const processingStatus = createProcessingStatus({
    statusIndicator,
    statusText,
    processingMessage,
    conversation,
});

const citationDialog = createCitationDialog({
    dialog: citationDialogElement,
    title: citationTitle,
    excerpt: citationExcerpt,
    link: citationLink,
    closeButton: citationCloseButton,
    doneButton: citationDoneButton,
});

function resizeQuestionInput() {
    questionInput.style.height = "auto";

    questionInput.style.height =
        `${questionInput.scrollHeight}px`;
}

function resetQuestionInputHeight() {
    questionInput.style.height = "auto";
}

function setBusy(isBusy) {
    questionInput.disabled = isBusy;
    sendButton.disabled = isBusy;

    sendButton.textContent = isBusy
        ? "Sending..."
        : "Send";
}

function showError(message) {
    errorMessage.textContent = message;
    errorBanner.hidden = false;
}

function clearError() {
    errorMessage.textContent = "";
    errorBanner.hidden = true;
}

/**
 * Extracts display content from the current backend envelope.
 *
 * The backend may return:
 * data.response
 * data.answer
 * data.content
 * or an entirely different data structure.
 *
 * No four-section answer template is enforced here.
 */
function extractDisplayData(responseBody) {
    const data =
        responseBody?.data ??
        responseBody;

    let content = data;
    let citations = [];

    if (
        data !== null &&
        typeof data === "object" &&
        !Array.isArray(data)
    ) {
        if (Array.isArray(data.citations)) {
            citations = data.citations;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "response",
            )
        ) {
            content = data.response;
        } else if (
            Object.prototype.hasOwnProperty.call(
                data,
                "answer",
            )
        ) {
            content = data.answer;
        } else if (
            Object.prototype.hasOwnProperty.call(
                data,
                "content",
            )
        ) {
            content = data.content;
        }
    }

    return {
        content,
        citations,
    };
}

/**
 * Suggested question cards only fill the natural-language input.
 * They never select a backend route, mode, source or command.
 */
for (const button of exploreButtons) {
    button.addEventListener("click", () => {
        questionInput.value =
            button.dataset.suggestedQuestion ?? "";

        resizeQuestionInput();
        questionInput.focus();
    });
}

questionInput.addEventListener(
    "input",
    resizeQuestionInput,
);

dismissErrorButton.addEventListener("click", () => {
    clearError();

    if (statusText.textContent === "Failed") {
        processingStatus.ready();
    }
});

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const question = questionInput.value.trim();

    if (!question) {
        showError(
            "Enter a question before submitting.",
        );

        processingStatus.fail();
        questionInput.focus();

        return;
    }

    clearError();

    if (welcomeCard) {
        welcomeCard.hidden = true;
    }

    appendUserMessage({
        conversation,
        question,
    });

    questionInput.value = "";
    resetQuestionInputHeight();

    setBusy(true);
    processingStatus.start();

    try {
        const responseBody =
            await submitChatQuestion(question);

        const {
            content,
            citations,
        } = extractDisplayData(responseBody);

        processingStatus.complete();

        appendAssistantMessage({
            conversation,
            content,
            citations,
            openCitation:
                citationDialog.openCitation,
        });
    } catch (error) {
        processingStatus.fail();

        showError(
            error.message ??
            "An unexpected error occurred.",
        );
    } finally {
        setBusy(false);
        questionInput.focus();
    }
});

processingStatus.ready();