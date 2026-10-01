import { ALL_EFFORT_LEVELS } from "../../../config/effort.config.js";

const MAX_QUESTION_LENGTH = 4000;
const MAX_CONVERSATION_ID_LENGTH = 200;

/**
 * Validates the natural-language question sent by the chat interface.
 *
 * The interface must send only a question. Users must not be required
 * to select a mode, source, command, model, agent, or backend route.
 *
 * `effort` (TENISE-68) does not change that: it is OPTIONAL and defaults to
 * today's behaviour when omitted, same as `evidence` and `conversationId`
 * below. Nothing here requires a caller to pick anything.
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

    const {
        evidence,
        conversationId,
        effort,
    } = req.body ?? {};

    // Optional. Case-insensitive so "Fast"/"FAST" from a hand-typed query
    // string (the frontend's debug override, see public/scripts/config.js)
    // is not rejected on a technicality the server can resolve itself.
    let normalisedEffort;

    if (effort !== undefined) {
        const candidate = typeof effort === "string" ? effort.trim().toLowerCase() : "";

        if (candidate && ALL_EFFORT_LEVELS.includes(candidate)) {
            normalisedEffort = candidate;
        } else {
            errors.push({
                field: "effort",
                message: `Effort, when provided, must be one of: ${ALL_EFFORT_LEVELS.join(", ")}.`,
            });
        }
    }


    if (
        conversationId !== undefined &&
        (
            typeof conversationId !== "string" ||
            conversationId.trim() === "" ||
            conversationId.trim().length >
            MAX_CONVERSATION_ID_LENGTH
        )
    ) {
        errors.push({
            field:
                "conversationId",

            message:
                `Conversation id, when provided, must be a non-empty string of ${MAX_CONVERSATION_ID_LENGTH} characters or fewer.`,
        });
    }

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

    if (
        conversationId !== undefined
    ) {
        req.body.conversationId =
            conversationId.trim();
    }

    if (normalisedEffort !== undefined) {
        req.body.effort = normalisedEffort;
    }

    return next();
}