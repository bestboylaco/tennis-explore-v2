import { getChatInfo, submitChatQuestion } from "./api/chatApi.js";
import { getCurrentUser, logout } from "./api/authApi.js";

import {
    appendAssistantMessage,
    appendUserMessage,
} from "./ui/messageRenderer.js";

import { createProcessingStatus } from "./ui/processingStatus.js";
import { createSourcePanel } from "./ui/sourcePanel.js";
import { createChatHistory } from "./ui/chatHistory.js";
import { createQuickQuestions } from "./ui/quickQuestions.js";


/*
 * A role can no longer be picked in this interface -- it is a fact about
 * the signed-in account (req.user.roleId, set at login from the session).
 *
 * An unauthenticated visitor is redirected before the rest of the workspace
 * is initialised.
 */
const currentUser = await getCurrentUser();

if (!currentUser) {
    window.location.replace("/login");

    throw new Error(
        "Redirecting to sign in.",
    );
}


/**
 * Returns a required page element, or throws a clear startup error.
 *
 * Failing here is much easier to diagnose than allowing a missing
 * interface element to cause an unrelated error later.
 */
function getRequiredElement(selector) {
    const element =
        document.querySelector(selector);

    if (!element) {
        throw new Error(
            `Required interface element was not found: ${selector}`,
        );
    }

    return element;
}


// --------------------------------------------------------------------------
// Main workspace elements
// --------------------------------------------------------------------------

const chatForm =
    getRequiredElement("#chat-form");

const questionInput =
    getRequiredElement("#question");

const sendButton =
    getRequiredElement("#send-button");

const conversation =
    getRequiredElement("#conversation");


// --------------------------------------------------------------------------
// Sidebars, foldable -- left (workspace nav) and right (quick start)
// --------------------------------------------------------------------------
//
// Purely a display preference, remembered per browser -- not something the
// backend needs to know or that should follow the account to another
// device, so localStorage rather than a server round trip. Wrapped in
// try/catch because a private window or blocked site data can make storage
// throw rather than just return null.

/**
 * Wires one foldable-sidebar toggle button: applies/removes `bodyClass` on
 * <body>, remembers the state under `storageKey`, and keeps the button's
 * aria-expanded/label/title in sync. Both sidebars use the same shape, so
 * this is built once and called twice rather than duplicated.
 */
function createSidebarToggle({ buttonSelector, bodyClass, storageKey, showLabel, hideLabel }) {
    const button = getRequiredElement(buttonSelector);

    function readStored() {
        try {
            return window.localStorage.getItem(storageKey) === "true";
        } catch {
            return false;
        }
    }

    function storePreference(collapsed) {
        try {
            window.localStorage.setItem(storageKey, String(collapsed));
        } catch {
            // per-viewer convenience only -- nothing downstream depends on
            // this persisting, so blocked or full storage is not an error to
            // surface.
        }
    }

    function apply(collapsed) {
        document.body.classList.toggle(bodyClass, collapsed);

        button.setAttribute("aria-expanded", String(!collapsed));
        button.setAttribute("aria-label", collapsed ? showLabel : hideLabel);
        button.title = collapsed ? showLabel : hideLabel;
    }

    apply(readStored());

    button.addEventListener("click", () => {
        const collapsed = !document.body.classList.contains(bodyClass);

        apply(collapsed);
        storePreference(collapsed);
    });
}

createSidebarToggle({
    buttonSelector: "#sidebar-toggle-button",
    bodyClass: "sidebar-collapsed",
    storageKey: "tennisexplore.sidebarCollapsed",
    showLabel: "Show sidebar",
    hideLabel: "Hide sidebar",
});

createSidebarToggle({
    buttonSelector: "#quick-start-toggle-button",
    bodyClass: "sidebar-collapsed-right",
    storageKey: "tennisexplore.quickStartCollapsed",
    showLabel: "Show quick start",
    hideLabel: "Hide quick start",
});


// --------------------------------------------------------------------------
// Error state
// --------------------------------------------------------------------------

const errorBanner =
    getRequiredElement("#error-banner");

const errorMessage =
    getRequiredElement("#error-message");

const dismissErrorButton =
    getRequiredElement(
        "#dismiss-error-button",
    );


function showError(message) {
    errorMessage.textContent = message;

    errorBanner.hidden = false;
}


function clearError() {
    errorBanner.hidden = true;

    errorMessage.textContent = "";
}


dismissErrorButton.addEventListener(
    "click",
    clearError,
);


// --------------------------------------------------------------------------
// Signed-in user
// --------------------------------------------------------------------------

const userBadge =
    getRequiredElement("#user-badge");

const userBadgeRole =
    getRequiredElement("#user-badge-role");

const logoutButton =
    getRequiredElement("#logout-button");


userBadgeRole.textContent =
    currentUser.displayName;

userBadge.hidden = false;


logoutButton.addEventListener(
    "click",
    async () => {
        logoutButton.disabled = true;

        await logout();

        window.location.assign(
            "/login",
        );
    },
);


// --------------------------------------------------------------------------
// Processing status
// --------------------------------------------------------------------------

const status =
    createProcessingStatus({
        statusIndicator:
            getRequiredElement(
                "#processing-status",
            ),

        statusText:
            getRequiredElement(
                "#status-text",
            ),

        processingMessage:
            getRequiredElement(
                "#processing-message",
            ),

        conversation,
    });


// --------------------------------------------------------------------------
// Citation source panel
// --------------------------------------------------------------------------

/*
 * Cited sources open beside the conversation instead of replacing the
 * workspace, so a coach can review evidence without losing their place.
 */
const sourcePanel =
    createSourcePanel({
        panel:
            getRequiredElement(
                "#source-panel",
            ),

        titleNode:
            getRequiredElement(
                "#source-panel-title",
            ),

        metaNode:
            getRequiredElement(
                "#source-panel-meta",
            ),

        bodyNode:
            getRequiredElement(
                "#source-panel-body",
            ),

        closeButton:
            getRequiredElement(
                "#source-panel-close",
            ),

        downloadLink:
            getRequiredElement(
                "#source-panel-download",
            ),
    });


// --------------------------------------------------------------------------
// Conversation rendering
// --------------------------------------------------------------------------

/**
 * Rebuilds the visible transcript when a history item is selected.
 *
 * Only user/assistant message rows are removed. The processing status remains
 * mounted because its controller keeps references to its own DOM elements.
 */
function renderConversation(messages) {
    sourcePanel.close();

    clearError();

    for (
        const message
        of conversation.querySelectorAll(
            ".message",
        )
    ) {
        message.remove();
    }

    for (const message of messages) {
        if (message.role === "user") {
            appendUserMessage({
                conversation,

                content:
                    message.content,
            });

            continue;
        }

        if (
            message.role ===
            "assistant"
        ) {
            appendAssistantMessage({
                conversation,

                content:
                    message.content,

                citations:
                    message.citations ??
                    [],

                references:
                    message.references ??
                    [],

                table:
                    message.table ??
                    null,

                sql:
                    message.sql ??
                    null,

                grounding:
                    message.grounding ??
                    null,

                openCitation:
                    sourcePanel.open,
            });
        }
    }

    conversation.scrollTop =
        conversation.scrollHeight;

    questionInput.focus();
}


// --------------------------------------------------------------------------
// Account-scoped Chat History
// --------------------------------------------------------------------------

/*
 * Conversation history is persisted by the backend and scoped to the
 * authenticated account.
 *
 * Reloading the page or signing in again restores the same account's history.
 */
const chatHistory =
    await createChatHistory({
        toggleButton:
            getRequiredElement(
                "#chat-history-toggle",
            ),

        panel:
            getRequiredElement(
                "#chat-history-panel",
            ),

        list:
            getRequiredElement(
                "#chat-history-list",
            ),

        emptyState:
            getRequiredElement(
                "#chat-history-empty",
            ),

        countNode:
            getRequiredElement(
                "#chat-history-count",
            ),

        newChatButton:
            getRequiredElement(
                "#new-chat-button",
            ),

        onSelectConversation:
            ({ messages }) => {
                status.ready();

                renderConversation(
                    messages,
                );
            },

        onError:
            (error) => {
                if (
                    error?.status ===
                    401
                ) {
                    window.location.assign(
                        "/login",
                    );

                    return;
                }

                showError(
                    error?.message ??
                    "Chat history could not be loaded or saved.",
                );
            },
    });


// --------------------------------------------------------------------------
// Greeting
// --------------------------------------------------------------------------
//
// Shown once, only into a genuinely empty conversation -- createChatHistory
// never auto-selects a saved conversation on load, so an empty transcript
// here means a fresh session, not one still loading. Best-effort: a failed
// /api/chat/info fetch still shows the greeting, just without a source
// count, rather than showing nothing at all.

async function showGreeting() {
    if (conversation.querySelector(".message")) {
        return;
    }

    let sourceCount = null;

    try {
        ({ sourceCount } = await getChatInfo());
    } catch {
        // greeting still shows without the count.
    }

    const coverage =
        typeof sourceCount === "number"
            ? `I have access to ${sourceCount.toLocaleString()} sources`
            : "I have access to a large library of sources";

    appendAssistantMessage({
        conversation,

        content:
            `Hey! I'm TennisExplore's knowledge assistant. ${coverage} covering research papers, ` +
            "match analysis, coaching resources and video, and I can answer questions across all of " +
            "them with citations back to where each fact came from. Ask me anything tennis-related to get started.",

        openCitation:
            sourcePanel.open,
    });
}

void showGreeting();


// --------------------------------------------------------------------------
// Composer
// --------------------------------------------------------------------------

/**
 * Grows the textarea with its content up to the CSS maximum height.
 */
function resizeInput() {
    questionInput.style.height =
        "auto";

    questionInput.style.height =
        `${questionInput.scrollHeight}px`;
}


questionInput.addEventListener(
    "input",
    resizeInput,
);


// --------------------------------------------------------------------------
// Account-scoped Quick Questions
// --------------------------------------------------------------------------

/*
 * Quick Questions are loaded from /api/quickquestions.
 *
 * The backend derives the account from req.user, so every signed-in user
 * receives and edits only their own saved Quick Questions.
 */
await createQuickQuestions({
    list:
        getRequiredElement(
            "#quick-questions-list",
        ),

    editButton:
        getRequiredElement(
            "#quick-questions-edit",
        ),

    editor:
        getRequiredElement(
            "#quick-questions-editor",
        ),

    editorList:
        getRequiredElement(
            "#quick-questions-editor-list",
        ),

    addButton:
        getRequiredElement(
            "#quick-question-add",
        ),

    saveButton:
        getRequiredElement(
            "#quick-questions-save",
        ),

    cancelButton:
        getRequiredElement(
            "#quick-questions-cancel",
        ),

    /*
     * Selecting a Quick Question only fills the normal chat input.
     *
     * It still goes through exactly the same backend query pipeline as
     * manually typed natural-language questions.
     */
    onSelectQuestion(question) {
        questionInput.value =
            question;

        resizeInput();

        questionInput.focus();
    },

        onError(error) {
        /*
         * If the session has expired, there is no useful reason to keep
         * retrying the preferences endpoint.
         */
        if (
            error?.status ===
            401
        ) {
            window.location.assign(
                "/login",
            );

            return;
        }

        showError(
            error?.message ??
            "Quick Questions could not be loaded or saved.",
        );
    },
});


// --------------------------------------------------------------------------
// Keyboard submit
// --------------------------------------------------------------------------

/*
 * Enter sends.
 * Shift + Enter creates a new line.
 */
questionInput.addEventListener(
    "keydown",
    (event) => {
        if (
            event.key ===
            "Enter" &&
            !event.shiftKey
        ) {
            event.preventDefault();

            chatForm.requestSubmit();
        }
    },
);


// --------------------------------------------------------------------------
// Busy state
// --------------------------------------------------------------------------

function setBusy(busy) {
    sendButton.disabled =
        busy;

    questionInput.disabled =
        busy;

    chatHistory.setBusy(
        busy,
    );
}


// --------------------------------------------------------------------------
// Send question
// --------------------------------------------------------------------------

chatForm.addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();

        clearError();

        const question =
            questionInput.value.trim();

        if (question === "") {
            return;
        }


        /*
         * Render the user's message immediately so the interface feels
         * responsive while retrieval and generation are running.
         */
        appendUserMessage({
            conversation,

            content:
                question,
        });


        questionInput.value = "";

        resizeInput();

        setBusy(true);

        status.start();


        try {
            /*
             * Persist the user's message before calling the AI pipeline.
             */
            await chatHistory
                .recordUserMessage(
                    question,
                );


            const result =
                await submitChatQuestion(
                    question,
                );

            const response =
                result?.response ?? {};


            const assistantMessage = {
                // APA-style rendering -- "(Author, Year)" in-text citations
                // instead of raw [n] markers, so the coach can see where a
                // claim came from without opening the sources panel. Falls
                // back to the raw answer if the backend did not supply one
                // (e.g. an older cached response).
                content:
                    response.answerApa ??
                    response.answer ??
                    "No answer was returned.",

                citations:
                    result?.citations ??
                    [],

                references:
                    response.references ??
                    [],

                /*
                 * Present only when the question was answered using
                 * structured tabular data.
                 */
                table:
                    response.table ??
                    null,

                sql:
                    response.sql ??
                    null,

                grounding:
                    response.grounding ??
                    null,
            };


            /*
             * Store the complete assistant response so reopening a previous
             * conversation can restore citations and structured results too.
             */
            await chatHistory
                .recordAssistantMessage(
                    assistantMessage,
                );


            appendAssistantMessage({
                conversation,

                ...assistantMessage,

                openCitation:
                    sourcePanel.open,
            });
        } catch (error) {
            /*
             * A session may have expired or been ended elsewhere.
             *
             * Redirect instead of repeatedly sending requests that will
             * continue to return 401.
             */
            if (
                error?.status ===
                401
            ) {
                window.location.assign(
                    "/login",
                );

                return;
            }

            showError(
                error?.message ??
                "The request could not be completed.",
            );
        } finally {
            setBusy(false);

            status.ready();

            questionInput.focus();
        }
    },
);


questionInput.focus();