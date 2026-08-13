import { submitChatQuestion } from "../services/chat.service.js";

/**
 * Accepts one natural-language coaching question and returns the
 * structure produced by the chat service.
 */
export async function submitChatQuestionController(req, res) {
    const result = await submitChatQuestion(req.body.question, {
        evidence: req.body.evidence,
        // demo only. see the note in chat.service -- this must come off an
        // authenticated session before anything the partner can reach.
        roleId: req.body.role,
    });

    return res.status(200).json({
        success: true,
        data: result,
    });
}

/**
 * Deliberately returns an error for acceptance testing.
 *
 * The frontend will be pointed at this endpoint to confirm that it
 * displays a visible error instead of a blank screen or endless spinner.
 */
export function deliberatelyFailChatController(req, res) {
    return res.status(503).json({
        success: false,
        error: {
            code: "DEMO_ENDPOINT_FAILURE",
            message: "The demo chat endpoint is deliberately unavailable.",
        },
    });
}