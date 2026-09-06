import { QuickQuestion } from
    "../models/quickQuestion.model.js";

/**
 * Used until a user saves their own Quick Questions.
 *
 * These defaults are returned without creating a database row.
 * A database record is created only after the user presses Save.
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

function cloneDefaults() {
    return DEFAULT_QUICK_QUESTIONS.map(
        (question) => ({
            ...question,
        }),
    );
}

/**
 * Normalises values received from the browser before validation.
 */
function normaliseQuestion(question) {
    return {
        title:
            String(
                question?.title ?? "",
            ).trim(),

        description:
            String(
                question?.description ?? "",
            ).trim(),

        prompt:
            String(
                question?.prompt ?? "",
            ).trim(),
    };
}

/**
 * Creates a validation error that the controller can return as HTTP 400.
 */
function validationError(message) {
    const error = new Error(message);

    error.name =
        "QuickQuestionValidationError";

    return error;
}

/**
 * Validates the complete user configuration before it reaches MongoDB.
 */
function validateQuickQuestions(
    quickQuestions,
) {
    if (!Array.isArray(quickQuestions)) {
        throw validationError(
            "quickQuestions must be an array.",
        );
    }

    /*
     * Keep the right panel manageable.
     */
    if (quickQuestions.length > 8) {
        throw validationError(
            "A maximum of 8 Quick Questions is allowed.",
        );
    }

    const normalised =
        quickQuestions.map(
            normaliseQuestion,
        );

    for (
        let index = 0;
        index < normalised.length;
        index += 1
    ) {
        const question =
            normalised[index];

        if (!question.title) {
            throw validationError(
                `Quick Question ${index + 1} requires a title.`,
            );
        }

        if (!question.prompt) {
            throw validationError(
                `Quick Question ${index + 1} requires a question.`,
            );
        }

        if (question.title.length > 60) {
            throw validationError(
                `Quick Question ${index + 1} title is too long.`,
            );
        }

        if (
            question.description.length >
            120
        ) {
            throw validationError(
                `Quick Question ${index + 1} description is too long.`,
            );
        }

        if (question.prompt.length > 500) {
            throw validationError(
                `Quick Question ${index + 1} prompt is too long.`,
            );
        }
    }

    return normalised;
}

/**
 * Returns the Quick Questions for one authenticated account.
 *
 * If the user has never customised them, return the defaults.
 */
export async function getQuickQuestions(
    userId,
) {
    const preference =
        await QuickQuestion.findOne({
            userId: String(userId),
        })
            .lean()
            .exec();

    if (!preference) {
        return cloneDefaults();
    }

    return preference.quickQuestions ?? [];
}

/**
 * Replaces the authenticated user's Quick Question configuration.
 */
export async function saveQuickQuestions(
    userId,
    quickQuestions,
) {
    const validated =
        validateQuickQuestions(
            quickQuestions,
        );

    const preference =
        await QuickQuestion.findOneAndUpdate(
            {
                userId: String(userId),
            },

            {
                $set: {
                    quickQuestions:
                        validated,
                },
            },

            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
            },
        )
            .lean()
            .exec();

    return preference.quickQuestions ?? [];
}