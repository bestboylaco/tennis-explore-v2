import {
    getChatInfo,
    submitChatQuestion,
} from "./api/chatApi.js";

import {
    getCurrentUser,
    logout,
} from "./api/authApi.js";

import {
    appendAssistantMessage,
    appendUserMessage,
} from "./ui/messageRenderer.js";

import {
    createProcessingStatus,
} from "./ui/processingStatus.js";

import {
    createSourcePanel,
} from "./ui/sourcePanel.js";

import {
    createChatHistory,
} from "./ui/chatHistory.js";

import {
    createQuickQuestions,
} from "./ui/quickQuestions.js";

import {
    createPdfUpload,
} from "./ui/pdfUpload.js";


/* ==========================================================================
   AUTH
   ========================================================================== */

const currentUser =
    await getCurrentUser();


if (!currentUser) {

    window.location.replace(
        "/login",
    );

    throw new Error(
        "Redirecting to sign in.",
    );

}


/* ==========================================================================
   DOM HELPERS
   ========================================================================== */

function getRequiredElement(
    selector,
) {

    const element =
        document.querySelector(
            selector,
        );


    if (!element) {

        throw new Error(
            `Required interface element was not found: ${selector}`,
        );

    }


    return element;

}


function getOptionalElement(
    selector,
) {

    return document.querySelector(
        selector,
    );

}


/* ==========================================================================
   MAIN WORKSPACE
   ========================================================================== */

const chatForm =
    getRequiredElement(
        "#chat-form",
    );


const questionInput =
    getRequiredElement(
        "#question",
    );


const sendButton =
    getRequiredElement(
        "#send-button",
    );


const effortSelect =
    getRequiredElement("#effort-select");

const processingMessageText =
    getRequiredElement("#processing-message-text");

const conversation =
    getRequiredElement(
        "#conversation",
    );

/*
 * Remembered per browser, the same way the sidebar collapse state is --
 * a coach who prefers thorough answers shouldn't have to reselect it
 * every time they open the page. Falls back to "low" (the element's own
 * default) if storage is unavailable or holds something unexpected.
 */
try {
    const storedEffort = window.localStorage.getItem("effort");

    if (storedEffort === "low" || storedEffort === "high") {
        effortSelect.value = storedEffort;
    }
} catch {
    // keep the element's own default.
}

effortSelect.addEventListener("change", () => {
    try {
        window.localStorage.setItem("effort", effortSelect.value);
    } catch {
        // the choice still applies to this request; it just won't be remembered.
    }
});


/*
 * New UI landing page.
 */

const conversationEmpty =
    getOptionalElement(
        "#conversation-empty",
    );


const welcomeSourceCount =
    getOptionalElement(
        "#welcome-source-count",
    );


const welcomeSuggestions =
    document.querySelectorAll(
        ".welcome-suggestion",
    );


/* ==========================================================================
   SIDEBAR CONTROLLER
   ========================================================================== */

function createSidebarToggle({
    buttonSelector,
    bodyClass,
    storageKey,
    showLabel,
    hideLabel,
}) {

    const button =
        getOptionalElement(
            buttonSelector,
        );


    if (!button) {

        return null;

    }


    function readStored() {

        try {

            return (
                window.localStorage
                    .getItem(
                        storageKey,
                    ) === "true"
            );

        } catch {

            return false;

        }

    }


    function storePreference(
        collapsed,
    ) {

        try {

            window.localStorage
                .setItem(
                    storageKey,
                    String(
                        collapsed,
                    ),
                );

        } catch {

            // Display preference only.

        }

    }


    function apply(
        collapsed,
    ) {

        document.body
            .classList
            .toggle(
                bodyClass,
                collapsed,
            );


        button.setAttribute(
            "aria-expanded",
            String(
                !collapsed,
            ),
        );


        button.setAttribute(
            "aria-label",
            collapsed
                ? showLabel
                : hideLabel,
        );


        button.title =
            collapsed
                ? showLabel
                : hideLabel;

    }


    apply(
        readStored(),
    );


    button.addEventListener(
        "click",
        () => {

            const collapsed =
                !document.body
                    .classList
                    .contains(
                        bodyClass,
                    );


            apply(
                collapsed,
            );


            storePreference(
                collapsed,
            );

        },
    );


    return button;

}


/* Left navigation */

const sidebarToggleButton =
    createSidebarToggle({

        buttonSelector:
            "#sidebar-toggle-button",

        bodyClass:
            "sidebar-collapsed",

        storageKey:
            "tennisexplore.sidebarCollapsed",

        showLabel:
            "Show sidebar",

        hideLabel:
            "Hide sidebar",

    });


/* Saved Questions */

const quickQuestionsToggle =
    createSidebarToggle({

        buttonSelector:
            "#quick-start-toggle-button",

        bodyClass:
            "sidebar-collapsed-right",

        storageKey:
            "tennisexplore.quickStartCollapsed",

        showLabel:
            "Show saved questions",

        hideLabel:
            "Hide saved questions",

    });


/* Legacy left-side reopen button */

const sidebarReopenButton =
    getOptionalElement(
        "#sidebar-reopen-button",
    );


sidebarReopenButton
    ?.addEventListener(
        "click",
        () => {

            sidebarToggleButton
                ?.click();

        },
    );


/* Saved Questions collapsed tab */

const quickQuestionsReopen =
    getOptionalElement(
        "#quick-questions-reopen-button",
    );


quickQuestionsReopen
    ?.addEventListener(
        "click",
        () => {

            quickQuestionsToggle
                ?.click();

        },
    );


/* Inline collapse control uses the existing stateful sidebar toggle. */
getOptionalElement("#quick-questions-collapse-handle")
    ?.addEventListener("click", () => {
        if (!document.body.classList.contains("sidebar-collapsed-right")) {
            quickQuestionsToggle?.click();
        }
    });

/* In compact rail mode, open the full left sidebar before revealing history.
   This removes the small flyout but keeps History accessible. */
getOptionalElement("#chat-history-toggle")
    ?.addEventListener("click", (event) => {
        if (!document.body.classList.contains("sidebar-collapsed") ||
            window.matchMedia("(max-width: 69.99rem)").matches) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        sidebarToggleButton?.click();
        queueMicrotask(() => {
            getOptionalElement("#chat-history-toggle")?.click();
        });
    }, true);

/* ==========================================================================
   QUICK QUESTIONS ELEMENTS
   ========================================================================== */

const quickQuestionsEditButton =
    getRequiredElement(
        "#quick-questions-edit",
    );


const quickQuestionsEditor =
    getRequiredElement(
        "#quick-questions-editor",
    );


const quickQuestionsEditorList =
    getRequiredElement(
        "#quick-questions-editor-list",
    );


const quickQuestionAddButton =
    getRequiredElement(
        "#quick-question-add",
    );


const quickQuestionsSaveButton =
    getRequiredElement(
        "#quick-questions-save",
    );


const quickQuestionsCancelButton =
    getRequiredElement(
        "#quick-questions-cancel",
    );


/* ==========================================================================
   ERROR STATE
   ========================================================================== */

const errorBanner =
    getRequiredElement(
        "#error-banner",
    );


const errorMessage =
    getRequiredElement(
        "#error-message",
    );


const dismissErrorButton =
    getRequiredElement(
        "#dismiss-error-button",
    );


/*
 * Support both:
 *
 * 1. the newer index.html containing #error-title
 *    and #retry-error-button;
 *
 * 2. the older index.html with only a <strong> and Dismiss.
 */

let errorTitle =
    getOptionalElement(
        "#error-title",
    );


if (!errorTitle) {

    errorTitle =
        errorBanner.querySelector(
            "strong",
        );


    if (errorTitle) {

        errorTitle.id =
            "error-title";

    }

}


let errorActions =
    errorBanner.querySelector(
        ".error-banner__actions",
    );


if (!errorActions) {

    errorActions =
        document.createElement(
            "div",
        );


    errorActions.className =
        "error-banner__actions";


    dismissErrorButton
        .before(
            errorActions,
        );


    errorActions.append(
        dismissErrorButton,
    );

}


let retryErrorButton =
    getOptionalElement(
        "#retry-error-button",
    );


if (!retryErrorButton) {

    retryErrorButton =
        document.createElement(
            "button",
        );


    retryErrorButton.id =
        "retry-error-button";


    retryErrorButton.type =
        "button";


    retryErrorButton.className =
        "text-button error-banner__retry";


    retryErrorButton.textContent =
        "Try again";


    retryErrorButton.hidden =
        true;


    errorActions.prepend(
        retryErrorButton,
    );

}


let retryAction =
    null;


/* ==========================================================================
   FRIENDLY ERROR MESSAGES
   ========================================================================== */

function friendlyErrorMessage(
    error,
    fallback,
) {

    const raw =
        String(
            error?.message ??
            "",
        );


    if (
        error?.status ===
        429
    ) {

        return (
            "TennisExplore is receiving a lot of requests right now. " +
            "Please wait a moment and try again."
        );

    }


    if (
        error?.status >=
        500
    ) {

        return (
            "The AI service is temporarily unavailable. " +
            "Please try again in a moment."
        );

    }


    if (
        error?.name ===
        "AbortError" ||
        error?.status ===
        408 ||
        /timeout|timed out/i
            .test(
                raw,
            )
    ) {

        return (
            "This request took longer than expected. " +
            "Please try again."
        );

    }


    if (
        /failed to fetch|network|fetch failed|networkerror/i
            .test(
                raw,
            )
    ) {

        return (
            "TennisExplore could not reach the AI service. " +
            "Please check the connection and try again."
        );

    }


    if (
        fallback
    ) {

        return fallback;

    }


    if (
        raw.trim() !==
        ""
    ) {

        return raw;

    }


    return (
        "TennisExplore could not complete this request. " +
        "Please try again."
    );

}


/* ==========================================================================
   ERROR CONTROLS
   ========================================================================== */

function showError(
    message,
    {
        title =
        "Something went wrong",

        retry =
        null,
    } = {},
) {

    if (errorTitle) {

        errorTitle.textContent =
            title;

    }


    errorMessage.textContent =
        message;


    retryAction =
        retry;


    retryErrorButton.hidden =
        typeof retry !==
        "function";


    errorBanner.hidden =
        false;

}


function clearError() {

    errorBanner.hidden =
        true;


    errorMessage.textContent =
        "";


    retryAction =
        null;


    retryErrorButton.hidden =
        true;

}


dismissErrorButton
    .addEventListener(
        "click",
        clearError,
    );


retryErrorButton
    .addEventListener(
        "click",
        async () => {

            if (
                typeof retryAction !==
                "function"
            ) {

                return;

            }


            const action =
                retryAction;


            clearError();


            await action();

        },
    );


/* ==========================================================================
   USER BADGE
   ========================================================================== */

const userBadge =
    getRequiredElement(
        "#user-badge",
    );


const userBadgeRole =
    getRequiredElement(
        "#user-badge-role",
    );


const logoutButton =
    getRequiredElement(
        "#logout-button",
    );


userBadgeRole.textContent =
    currentUser.displayName;


userBadge.hidden =
    false;


logoutButton
    .addEventListener(
        "click",
        async () => {

            logoutButton.disabled =
                true;


            await logout();


            window.location.assign(
                "/login",
            );

        },
    );


/* ==========================================================================
   PROCESSING STATUS
   ========================================================================== */

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


/* ==========================================================================
   SOURCE PANEL
   ========================================================================== */

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


/* ==========================================================================
   EMPTY CONVERSATION
   ========================================================================== */

function setConversationEmpty(
    isEmpty,
) {

    if (!conversationEmpty) {

        return;

    }


    conversationEmpty.hidden =
        !isEmpty;

}


/* ==========================================================================
   SAVE USER QUESTION
   ========================================================================== */

function makeQuickQuestionTitle(
    question,
) {

    const clean =
        question
            .replace(
                /\s+/g,
                " ",
            )
            .trim();


    if (
        clean.length <=
        34
    ) {

        return clean;

    }


    return (
        clean
            .slice(
                0,
                31,
            )
            .trimEnd() +
        "..."
    );

}


function prefillSavedQuestionEditor(
    question,
) {

    /*
     * Open Saved Questions if collapsed.
     */

    if (
        document.body
            .classList
            .contains(
                "sidebar-collapsed-right",
            )
    ) {

        quickQuestionsToggle
            ?.click();

    }


    /*
     * Enter Edit mode.
     */

    if (
        quickQuestionsEditor.hidden
    ) {

        quickQuestionsEditButton
            .click();

    }


    /*
     * Allow Quick Questions to render the editor before
     * inserting a new row.
     */

    requestAnimationFrame(
        () => {

            quickQuestionAddButton
                .click();


            requestAnimationFrame(
                () => {

                    const rows =
                        quickQuestionsEditorList
                            .querySelectorAll(
                                ".quick-question-editor-row",
                            );


                    const row =
                        rows[
                        rows.length -
                        1
                        ];


                    if (!row) {

                        return;

                    }


                    const titleInput =
                        row.querySelector(
                            "input",
                        );


                    const questionTextarea =
                        row.querySelector(
                            "textarea",
                        );


                    if (
                        titleInput &&
                        titleInput.value
                            .trim() ===
                        ""
                    ) {

                        titleInput.value =
                            makeQuickQuestionTitle(
                                question,
                            );

                    }


                    if (
                        questionTextarea
                    ) {

                        questionTextarea.value =
                            question;


                        questionTextarea.focus();

                    }

                },
            );

        },
    );

}


/*
 * Keep messageRenderer.js responsible for the message itself.
 * This function adds only a small UI action beneath user messages.
 */

function appendUserMessageWithActions({
    content,
}) {

    const row =
        appendUserMessage({

            conversation,

            content,

        });


    const actions =
        document.createElement(
            "div",
        );


    actions.className =
        "user-message-actions";


    const saveButton =
        document.createElement(
            "button",
        );


    saveButton.type =
        "button";


    saveButton.className =
        "user-message-save";


    saveButton.textContent =
        "Save question";


    saveButton.setAttribute(
        "aria-label",
        "Add this question to Saved Questions",
    );


    saveButton.addEventListener(
        "click",
        () => {

            prefillSavedQuestionEditor(
                content,
            );


            saveButton.textContent =
                "Added to editor";


            saveButton.disabled =
                true;

        },
    );


    actions.append(
        saveButton,
    );


    row.append(
        actions,
    );


    return row;

}


/* ==========================================================================
   CONVERSATION RENDERING
   ========================================================================== */

function renderConversation(
    messages,
) {

    sourcePanel.close();


    clearError();


    setConversationEmpty(
        messages.length ===
        0,
    );


    for (
        const message
        of conversation
            .querySelectorAll(
                ".message",
            )
    ) {

        message.remove();

    }


    for (
        const message
        of messages
    ) {

        if (
            message.role ===
            "user"
        ) {

            appendUserMessageWithActions({

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

                sections:
                    message.sections ??
                    [],

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


/* ==========================================================================
   CHAT HISTORY
   ========================================================================== */

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
            ({
                messages,
            }) => {

                status.ready();


                renderConversation(
                    messages,
                );

            },

        onError:
            (
                error,
            ) => {

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

                    friendlyErrorMessage(
                        error,
                        "Chat history could not be loaded or saved.",
                    ),

                    {
                        title:
                            "Chat history unavailable",
                    },

                );

            },

    });


/* ==========================================================================
   WELCOME INFORMATION
   ========================================================================== */

async function loadWelcomeInfo() {

    if (!welcomeSourceCount) {

        return;

    }


    let sourceCount =
        null;


    try {

        ({
            sourceCount,
        } = await getChatInfo());

    } catch {

        return;

    }


    if (
        typeof sourceCount !==
        "number"
    ) {

        return;

    }


    welcomeSourceCount.textContent =
        `Currently connected to ${sourceCount.toLocaleString()} indexed sources.`;

}


void loadWelcomeInfo();


/* ==========================================================================
   COMPOSER
   ========================================================================== */

function resizeInput() {

    questionInput.style.height =
        "auto";


    questionInput.style.height =
        `${questionInput.scrollHeight}px`;

}


questionInput
    .addEventListener(
        "input",
        resizeInput,
    );


/* ==========================================================================
   LANDING SUGGESTIONS
   ========================================================================== */

for (
    const suggestion
    of welcomeSuggestions
) {

    suggestion
        .addEventListener(
            "click",
            () => {

                const prompt =
                    suggestion
                        .dataset
                        .prompt ??
                    "";


                questionInput.value =
                    prompt;


                resizeInput();


                questionInput.focus();

            },
        );

}


/* ==========================================================================
   QUICK QUESTIONS
   ========================================================================== */

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
        quickQuestionsEditButton,

    editor:
        quickQuestionsEditor,

    editorList:
        quickQuestionsEditorList,

    addButton:
        quickQuestionAddButton,

    saveButton:
        quickQuestionsSaveButton,

    cancelButton:
        quickQuestionsCancelButton,


    onSelectQuestion(
        question,
    ) {

        questionInput.value =
            question;


        resizeInput();


        questionInput.focus();

    },


    onError(
        error,
    ) {

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

            friendlyErrorMessage(
                error,
                "Saved Questions could not be loaded or saved.",
            ),

            {
                title:
                    "Saved Questions unavailable",
            },

        );

    },

});


/* ==========================================================================
   KEYBOARD SUBMIT
   ========================================================================== */

questionInput
    .addEventListener(
        "keydown",
        (
            event,
        ) => {

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


/* ==========================================================================
   BUSY STATE
   ========================================================================== */

function setBusy(
    busy,
) {

    sendButton.disabled =
        busy;


    questionInput.disabled =
        busy;


    chatHistory.setBusy(
        busy,
    );


    effortSelect.disabled =
        busy;

}


/* ==========================================================================
   PDF UPLOAD
   ========================================================================== */

createPdfUpload({

    button:
        getRequiredElement(
            "#composer-plus-button",
        ),

    anchor:
        chatForm,

    onBusyChange:
        setBusy,


    onError(
        error,
    ) {

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

            friendlyErrorMessage(
                error,
                "The PDF could not be uploaded.",
            ),

            {
                title:
                    "Upload failed",
            },

        );

    },

});


/* ==========================================================================
   ACTIVE CONVERSATION
   ========================================================================== */

function getActiveConversationId() {

    if (
        typeof chatHistory
            .getActiveConversation !==
        "function"
    ) {

        return null;

    }


    return (
        chatHistory
            .getActiveConversation()
            ?.id ??
        null
    );

}


/* ==========================================================================
   ASSISTANT REQUEST
   ========================================================================== */

async function requestAssistantAnswer(
    question,
) {

    clearError();


    setBusy(
        true,
    );

    // sets expectations honestly before the wait starts -- the citation
    // check always runs now, on both levels, so neither is a quick
    // guarantee any more, and a spinner with no indication of that reads
    // as the app having stalled.
    processingMessageText.textContent =
        effortSelect.value === "high"
            ? "Thinking it through with extra sources -- this can take several minutes..."
            : "Analysing your question -- checking citations can take a little while...";


    status.start();


    try {

        const conversationId =
            getActiveConversationId();


        const result =
            await submitChatQuestion(

                question,

                conversationId,

                effortSelect.value,

            );


        const response =
            result?.response ??
            {};


        const assistantMessage = {

            content:
                response.answerApa ??
                response.answer ??
                "No answer was returned.",

            sections:
                response.sections ??
                [],

            citations:
                result?.citations ??
                [],

            references:
                response.references ??
                [],

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
         * History persistence should not prevent an otherwise
         * successful AI response from being displayed.
         */

        try {

            await chatHistory
                .recordAssistantMessage(
                    assistantMessage,
                );

        } catch (
        historyError
        ) {

            if (
                historyError?.status ===
                401
            ) {

                window.location.assign(
                    "/login",
                );


                return false;

            }


            showError(

                "The answer was generated, but it could not be saved to Chat History.",

                {
                    title:
                        "History was not saved",
                },

            );

        }


        appendAssistantMessage({

            conversation,

            ...assistantMessage,

            openCitation:
                sourcePanel.open,

        });


        conversation.scrollTop =
            conversation.scrollHeight;


        return true;

    } catch (
    error
    ) {

        if (
            error?.status ===
            401
        ) {

            window.location.assign(
                "/login",
            );


            return false;

        }


        showError(

            friendlyErrorMessage(
                error,
                "TennisExplore could not complete this request. Please try again.",
            ),

            {
                title:
                    "Something went wrong",

                /*
                 * Retry repeats only the assistant request.
                 *
                 * It does not add another user bubble
                 * and does not save the user turn again.
                 */
                retry:
                    () =>
                        requestAssistantAnswer(
                            question,
                        ),
            },

        );


        return false;

    } finally {

        setBusy(
            false,
        );


        status.ready();


        questionInput.focus();

    }

}


/* ==========================================================================
   SEND QUESTION
   ========================================================================== */

chatForm
    .addEventListener(
        "submit",
        async (
            event,
        ) => {

            event.preventDefault();


            clearError();


            const question =
                questionInput
                    .value
                    .trim();


            if (
                question ===
                ""
            ) {

                return;

            }


            setConversationEmpty(
                false,
            );


            /*
             * Render immediately so the UI responds without waiting
             * for persistence or retrieval.
             */

            appendUserMessageWithActions({

                content:
                    question,

            });


            questionInput.value =
                "";


            resizeInput();


            /*
             * History failure should not stop the actual AI request.
             */

            try {

                await chatHistory
                    .recordUserMessage(
                        question,
                    );

            } catch (
            historyError
            ) {

                if (
                    historyError?.status ===
                    401
                ) {

                    window.location.assign(
                        "/login",
                    );


                    return;

                }


                showError(

                    "Your question can still be answered, but this turn could not be saved to Chat History.",

                    {
                        title:
                            "History was not saved",
                    },

                );

            }


            await requestAssistantAnswer(
                question,
            );

        },
    );


questionInput.focus();