import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { submitChatQuestion } from "../services/chat.service.js";

import {
  submitAgentChatQuestion,
} from "../services/agentChat.service.js";

import {
    recordTurn,
    resolveFollowUp,
} from "../services/conversationContext.service.js";

import { retrievalConfig } from "../../../config/retrieval.config.js";

/**
 * The corpus file count, read once and cached -- the manifest only changes
 * when the index is rebuilt, which restarts the process, so there is no
 * point re-reading it on every greeting.
 */
let cachedSourceCount = null;

async function readSourceCount() {
  if (cachedSourceCount !== null) return cachedSourceCount;

  try {
    const manifestPath = path.join(retrievalConfig.index.dir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

    cachedSourceCount = manifest.fileCount ?? null;
  } catch {
    cachedSourceCount = null;
  }

  return cachedSourceCount;
}

/**
 * GET /api/chat/info -- static facts the frontend greets a fresh
 * conversation with (how many documents this can actually answer from).
 * Not query-specific, so it carries no telemetry correlation id.
 */
export async function getChatInfoController(req, res) {
  const sourceCount = await readSourceCount();

  return res.status(200).json({
    success: true,
    data: { sourceCount },
  });
}

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

            /*
             * Conversation memory is keyed on the authenticated session, not on
             * anything the client sends. A caller who could choose their own
             * session id could read someone else's conversation.
             */
            sessionId: req.sessionID ?? req.session?.id ?? null,

            /*
             * TENISE-68: optional speed/thoroughness control. Already
             * validated and normalised to "fast"/"thorough"/undefined by
             * validateChatQuestion -- undefined here means the caller never
             * mentioned it, and answerQuestion treats that as "no override".
             */
            effort: req.body.effort,
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



/**
 * Executes the new Agent-based intelligence pipeline.
 *
 * The authenticated role still comes exclusively
 * from the server-side session.
 */
export async function submitAgentChatQuestionController(
    req,
    res,
) {
    const correlationId =
        `agent-query:${randomUUID()}`;

    req.telemetry?.setCorrelationId(
        correlationId,
    );


    const originalQuestion =
        req.body.question;

    const conversationId =
        req.body.conversationId ??
        null;


    /*
     * Resolve conversation-dependent wording BEFORE routing/retrieval.
     *
     * The browser sends only conversationId. Previous turns are read from the
     * authenticated server-side session and are never reconstructed client-side.
     */
    const resolution =
        await resolveFollowUp({
            session:
                req.session,

            conversationId,

            question:
                originalQuestion,
        });


    /*
     * The Agent receives the resolved standalone question.
     *
     * Everything after this point -- routing, actions, retrieval, synthesis and
     * verification -- continues through the existing pipeline unchanged.
     */
    const result =
        await submitAgentChatQuestion(
            resolution.resolvedQuestion,
            {
                roleId:
                    req.user.roleId,

                correlationId,

                responseTimeZone:
                    req.get("X-Time-Zone") ??
                    "UTC",
            },
        );


    /*
     * Keep only the resolved question plus a short assistant-answer excerpt in
     * the authenticated session.
     */
    const answer =
        result?.response?.answerApa ??
        result?.response?.answer ??
        result?.answer ??
        "";


    recordTurn({
        session:
            req.session,

        conversationId,

        resolvedQuestion:
            resolution.resolvedQuestion,

        answer,
    });


    /*
     * Acceptance evidence is returned explicitly so tests can verify whether
     * context was used without inspecting session internals.
     */
    const metadata = {
        ...(result?.metadata ?? {}),

        originalQuestion:
            resolution.originalQuestion,

        resolvedQuestion:
            resolution.resolvedQuestion,

        contextTurnsUsed:
            resolution.contextTurnsUsed,

        rewriteApplied:
            resolution.rewriteApplied,

        rewriteReason:
            resolution.rewriteReason,
    };


    return res
        .status(200)
        .json({
            success:
                true,

            data: {
                ...result,
                metadata,
            },
        });
}