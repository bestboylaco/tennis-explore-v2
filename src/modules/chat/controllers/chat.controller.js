import { randomUUID } from "node:crypto";

import { submitChatQuestion } from "../services/chat.service.js";

/**
 * Accepts one natural-language coaching question and returns the
 * structure produced by the chat service.
 */
export async function submitChatQuestionController(req, res) {
    // One request writes two telemetry records: the api_request record opened
    // by the middleware and the query record opened by the chat service. They
    // are stamped with the same correlation id so TENISE-27 can join the HTTP
    // view of a query to its per-stage view; without it the two are unrelated
    // rows and the stage figures cannot be tied to a status code.
    const correlationId = `query:${randomUUID()}`;

    req.telemetry?.setCorrelationId(correlationId);

    const result = await submitChatQuestion(req.body.question, {
        evidence: req.body.evidence,

        // Demo only. This should eventually come from the authenticated
        // user session rather than directly from the request body.
        roleId: req.body.role,

        // Links chat-stage telemetry to the HTTP request telemetry.
        correlationId,
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