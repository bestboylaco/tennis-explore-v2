import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { submitChatQuestion } from "../services/chat.service.js";

import {
  submitAgentChatQuestion,
} from "../services/agentChat.service.js";

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
             * The one deliberate exception to "no mode/route/model from the
             * client" (see chat.validation.js) -- a speed-vs-thoroughness
             * preference the coach chose for this question, not a routing or
             * access decision. Validated to "low"/"high" before this point.
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


  const result =
    await submitAgentChatQuestion(
      req.body.question,
      {
        roleId:
          req.user.roleId,

        correlationId,

        /*
         * Presentation-only information.
         * The client cannot use this to alter routing,
         * permissions or evidence access.
         */
        responseTimeZone:
          req.get("X-Time-Zone") ??
          "UTC",
      },
    );


  return res
    .status(200)
    .json({
      success:
        true,

      data:
        result,
    });
}