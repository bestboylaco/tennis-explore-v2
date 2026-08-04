const MAX_QUESTION_LENGTH = 4000;

/**
 * Validates the natural-language question sent by the chat interface.
 *
 * The interface must send only a question. Users must not be required
 * to select a mode, source, command, model, agent, or backend route.
 */
export function validateChatQuestion(req, res, next) {
    const question = req.body?.question;
    const errors = [];

    if (typeof question !== "string" || question.trim() === "") {
        errors.push({
            field: "question",
            message: "Question is required and must be a non-empty string.",
        });
    } else if (question.trim().length > MAX_QUESTION_LENGTH) {
        errors.push({
            field: "question",
            message: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer.`,
        });
    }

    const { evidence } = req.body ?? {};

    // evidence is optional and normally supplied by retrieval (TENISE-15/17,
    // not yet wired in). Accepted here too so the generation stage (TENISE-19)
    // can be exercised directly, including with a forced-empty evidence set.
    if (
        evidence !== undefined &&
        (!Array.isArray(evidence) || evidence.some((item) => typeof item !== "string"))
    ) {
        errors.push({
            field: "evidence",
            message: "Evidence, when provided, must be an array of strings.",
        });
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: {
                code: "VALIDATION_ERROR",
                message: "The chat request contains invalid data.",
                details: errors,
            },
        });
    }

    // Store the cleaned question so later layers do not repeat this work.
    req.body.question = question.trim();

    return next();
}