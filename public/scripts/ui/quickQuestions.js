import {
    getQuickQuestions,
    saveQuickQuestions,
} from "../api/quickQuestionApi.js";

/*
 * Default Quick Questions shown before a user has saved
 * their own configuration.
 *
 * The backend also owns the same defaults, so these mainly
 * prevent the Explore panel from appearing empty while the
 * account settings are loading.
 */
const DEFAULT_QUICK_QUESTIONS = [
    {
        title: "Recent insights",
        description: "Review key player trends",
        prompt:
            "What recent player insights should I review?",
    },

    {
        title: "Create a plan",
        description: "Prepare the next session",
        prompt:
            "Create a coaching plan for the next training session.",
    },

    {
        title: "Technique analysis",
        description: "Identify technical priorities",
        prompt:
            "What technical priorities should I focus on?",
    },

    {
        title: "Match review",
        description: "Analyse recent performance",
        prompt:
            "Review the player's recent match performance.",
    },

    {
        title: "Video evidence",
        description: "Review cited video moments",
        prompt:
            "Find relevant video evidence for the player's technique.",
    },
];


function cloneQuestions(
    quickQuestions,
) {
    return quickQuestions.map(
        (question) => ({
            ...question,
        }),
    );
}

/**
 * Creates one editable Quick Question row.
 *
 * User text is assigned with .value rather than interpolated into HTML,
 * so saved content is never treated as markup.
 */
function createEditorRow(
    doc,
    question = {
        title: "",
        description: "",
        prompt: "",
    },
) {
    const row =
        doc.createElement("div");

    row.className =
        "quick-question-editor-row";

    const titleLabel =
        doc.createElement("label");

    const titleText =
        doc.createElement("span");

    const titleInput =
        doc.createElement("input");

    titleText.textContent = "Title";

    titleInput.type = "text";
    titleInput.maxLength = 60;
    titleInput.className =
        "quick-question-title";

    titleInput.value =
        question.title ?? "";

    titleLabel.append(
        titleText,
        titleInput,
    );


    const descriptionLabel =
        doc.createElement("label");

    const descriptionText =
        doc.createElement("span");

    const descriptionInput =
        doc.createElement("input");

    descriptionText.textContent =
        "Description";

    descriptionInput.type = "text";
    descriptionInput.maxLength = 120;

    descriptionInput.className =
        "quick-question-description";

    descriptionInput.value =
        question.description ?? "";

    descriptionLabel.append(
        descriptionText,
        descriptionInput,
    );


    const promptLabel =
        doc.createElement("label");

    const promptText =
        doc.createElement("span");

    const promptInput =
        doc.createElement("textarea");

    promptText.textContent =
        "Question";

    promptInput.rows = 3;
    promptInput.maxLength = 500;

    promptInput.className =
        "quick-question-prompt";

    promptInput.value =
        question.prompt ?? "";

    promptLabel.append(
        promptText,
        promptInput,
    );


    const removeButton =
        doc.createElement("button");

    removeButton.type = "button";

    removeButton.className =
        "quick-question-remove";

    removeButton.textContent =
        "Remove";

    removeButton.addEventListener(
        "click",
        () => {
            row.remove();
        },
    );


    row.append(
        titleLabel,
        descriptionLabel,
        promptLabel,
        removeButton,
    );

    return row;
}

/**
 * Handles the right-side Quick Questions panel.
 *
 * The backend provides account-level persistence.
 */
export async function createQuickQuestions({
    list,
    editButton,
    editor,
    editorList,
    addButton,
    saveButton,
    cancelButton,
    onSelectQuestion,
    onError,
}) {
    const doc =
        list.ownerDocument;

    let quickQuestions =
        cloneQuestions(
            DEFAULT_QUICK_QUESTIONS,
        );

    function reportError(error) {
        console.error(
            "Quick Questions:",
            error,
        );

        onError?.(error);
    }

    /**
     * Renders the normal clickable cards.
     */
    function renderQuestions() {
        list.replaceChildren();

        for (
            const question
            of quickQuestions
        ) {
            const button =
                doc.createElement("button");

            const title =
                doc.createElement("strong");

            const description =
                doc.createElement("small");

            button.type = "button";

            button.className =
                "explore-card";

            title.textContent =
                question.title;

            description.textContent =
                question.description ?? "";

            button.append(
                title,
                description,
            );

            button.addEventListener(
                "click",
                () => {
                    onSelectQuestion?.(
                        question.prompt,
                    );
                },
            );

            list.append(button);
        }

        if (
            quickQuestions.length === 0
        ) {
            const empty =
                doc.createElement("p");

            empty.className =
                "quick-questions-empty";

            empty.textContent =
                "No Quick Questions saved. Select Edit to add one.";

            list.append(empty);
        }
    }

    /**
     * Builds the editor from the currently saved list.
     */
    function renderEditor() {
        editorList.replaceChildren();

        for (
            const question
            of quickQuestions
        ) {
            editorList.append(
                createEditorRow(
                    doc,
                    question,
                ),
            );
        }
    }

    function openEditor() {
        renderEditor();

        list.hidden = true;
        editor.hidden = false;
        editButton.hidden = true;
    }

    function closeEditor() {
        editor.hidden = true;
        list.hidden = false;
        editButton.hidden = false;
    }

    function readEditorQuestions() {
        const rows = [
            ...editorList.querySelectorAll(
                ".quick-question-editor-row",
            ),
        ];

        return rows
            .map((row) => {
                const title =
                    row.querySelector(
                        ".quick-question-title",
                    );

                const description =
                    row.querySelector(
                        ".quick-question-description",
                    );

                const prompt =
                    row.querySelector(
                        ".quick-question-prompt",
                    );

                return {
                    title:
                        title.value.trim(),

                    description:
                        description.value.trim(),

                    prompt:
                        prompt.value.trim(),
                };
            })
            .filter(
                (question) =>
                    question.title !== "" ||
                    question.prompt !== "",
            );
    }

    editButton.addEventListener(
        "click",
        openEditor,
    );

    cancelButton.addEventListener(
        "click",
        closeEditor,
    );

    addButton.addEventListener(
        "click",
        () => {
            const count =
                editorList.querySelectorAll(
                    ".quick-question-editor-row",
                ).length;

            if (count >= 8) {
                reportError(
                    new Error(
                        "A maximum of 8 Quick Questions is allowed.",
                    ),
                );

                return;
            }

            const row =
                createEditorRow(doc);

            editorList.append(row);

            row.querySelector(
                ".quick-question-title",
            )?.focus();
        },
    );

    saveButton.addEventListener(
        "click",
        async () => {
            const nextQuestions =
                readEditorQuestions();

            for (
                let index = 0;
                index < nextQuestions.length;
                index += 1
            ) {
                const question =
                    nextQuestions[index];

                if (!question.title) {
                    reportError(
                        new Error(
                            `Quick Question ${index + 1} requires a title.`,
                        ),
                    );

                    return;
                }

                if (!question.prompt) {
                    reportError(
                        new Error(
                            `Quick Question ${index + 1} requires a question.`,
                        ),
                    );

                    return;
                }
            }

            saveButton.disabled = true;
            saveButton.textContent = "Saving...";

            console.log(
                "[QuickQuestions] Saving",
                nextQuestions,
            );

            try {
                const savedQuestions =
                    await saveQuickQuestions(
                        nextQuestions,
                    );

                console.log(
                    "[QuickQuestions] Saved successfully",
                    savedQuestions,
                );

                /*
                 * Empty array is valid.
                 */
                quickQuestions =
                    Array.isArray(savedQuestions)
                        ? savedQuestions
                        : [];

                renderQuestions();

                /*
                 * Leave editing mode only after the save succeeds.
                 */
                editor.hidden = true;
                list.hidden = false;
                editButton.hidden = false;

                console.log(
                    "[QuickQuestions] Editor closed",
                );
            } catch (error) {
                console.error(
                    "[QuickQuestions] Save failed",
                    error,
                );

                reportError(error);
            } finally {
                /*
                 * Always restore the Save button.
                 */
                saveButton.disabled = false;
                saveButton.textContent = "Save";

                console.log(
                    "[QuickQuestions] Save finished",
                );
            }
        },
    );

    /*
     * Load the account's saved configuration.
     */
    try {
        quickQuestions =
            await getQuickQuestions();
    } catch (error) {
        reportError(error);

        quickQuestions = [];
    }

    renderQuestions();

    return {
        getQuestions() {
            return cloneQuestions(
                quickQuestions,
            );
        },

        openEditor,
    };
}