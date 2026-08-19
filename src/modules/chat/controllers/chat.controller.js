import { randomUUID } from "node:crypto";

import { submitChatQuestion } from "../services/chat.service.js";

/**
 * Accepts one natural-language coaching question and returns the
 * structure produced by the chat service.
 */
export async function submitChatQuestionController(req, res) {
    /*
     * One request writes two telemetry records:
     *
     * - the API request record opened by middleware
     * - the query record opened by the chat service
     *
     * The shared correlation id allows TENISE-27 to connect the
     * HTTP request with its per-stage pipeline telemetry.
     */
    const correlationId = `query:${randomUUID()}`;

    req.telemetry?.setCorrelationId(correlationId);

    const result = await submitChatQuestion(
        req.body.question,
        {
            evidence: req.body.evidence,

            /*
             * The role comes from the authenticated session.
             *
             * Do not accept a role from req.body because that would
             * allow a client to choose its own access level.
             */
            roleId: req.user.roleId,

            /*
             * Links query-stage telemetry to the HTTP request.
             */
            correlationId,
        },
    );

    return res.status(200).json({
        success: true,
        data: result,
    });
}

/**
 * Deliberately returns an error for acceptance testing.
 *
 * The frontend uses this endpoint to verify that a failed backend
 * request produces a visible error rather than an indefinite spinner.
 */
export function deliberatelyFailChatController(req, res) {
    return res.status(503).json({
        success: false,
        error: {
            code: "DEMO_ENDPOINT_FAILURE",
            message:
                "The demo chat endpoint is deliberately unavailable.",
        },
    });
}