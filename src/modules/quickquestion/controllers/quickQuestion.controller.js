import {
    getQuickQuestions,
    saveQuickQuestions,
} from "../services/quickQuestion.service.js";

/**
 * Gets the authenticated account id.
 *
 * requireAuth should already have populated req.user before
 * these routes are reached.
 */
function getAuthenticatedUserId(req) {
    const userId =
        req.user?.id ??
        req.user?._id?.toString();

    if (!userId) {
        throw new Error(
            "Authenticated user id is missing.",
        );
    }

    return userId;
}

/**
 * GET /api/quickquestions
 *
 * Returns only the currently authenticated user's Quick Questions.
 */
export async function getQuickQuestionsController(
    req,
    res,
) {
    const userId =
        getAuthenticatedUserId(req);

    const quickQuestions =
        await getQuickQuestions(userId);

    return res.status(200).json({
        success: true,

        data: {
            quickQuestions,
        },
    });
}

/**
 * PUT /api/quickquestions
 *
 * Replaces only the currently authenticated user's Quick Questions.
 */
export async function updateQuickQuestionsController(
    req,
    res,
) {
    const userId =
        getAuthenticatedUserId(req);

    console.log(
        "[QuickQuestions API] PUT received",
        {
            userId,
            quickQuestions:
                req.body.quickQuestions,
        },
    );

    try {
        const quickQuestions =
            await saveQuickQuestions(
                userId,
                req.body.quickQuestions,
            );

        console.log(
            "[QuickQuestions API] Save completed",
        );

        return res.status(200).json({
            success: true,

            data: {
                quickQuestions,
            },
        });
    } catch (error) {
        console.error(
            "[QuickQuestions API] Save error",
            error,
        );

        if (
            error.name ===
            "QuickQuestionValidationError"
        ) {
            return res.status(400).json({
                success: false,

                error: {
                    code:
                        "INVALID_QUICK_QUESTIONS",

                    message:
                        error.message,
                },
            });
        }

        throw error;
    }
}