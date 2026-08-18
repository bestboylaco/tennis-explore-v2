import {
    PIPELINE_STAGES,
    RUN_STATUSES,
    TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";
import { startTelemetryRun } from "../../telemetry/services/telemetryRecorder.service.js";
import { answerQuestion } from "./answer.service.js";
import { generateAnswer } from "./generation.service.js";
import { routeQuery } from "./routing.service.js";
import { bindCitations } from "../../retrieval/citation.service.js";

/**
 * Handles one natural-language question from the browser.
 *
 * Two paths, chosen by whether the caller supplied evidence directly:
 *
 * - `evidence` present (even `[]`): the explicit-evidence path. TENISE-19's
 *   control tests, and the routing/retrieval-stage telemetry contract from
 *   TENISE-30, both depend on this path -- it must keep working without an
 *   index. Real retrieval never runs here by design, so the retrieval stage
 *   is recorded as skipped rather than not_implemented.
 * - `evidence` omitted (`null`): delegates to answerQuestion, the real
 *   plan -> retrieve -> compose -> verify pipeline (TENISE-15/17/21), which
 *   is also what `npm run ask` uses so the browser and CLI cannot drift
 *   apart. This is the path with role-based access filtering (E5-17).
 *
 * roleId is required and has no default -- the same rule answerQuestion and
 * retrieve already enforce (E5-17). It comes from req.user.roleId, which
 * requireAuth (app.js) sets from the session; there is no path from here
 * back to a client-supplied value. A caller who picks their own role has
 * every role, which is exactly the T-01 gap this closes.
 *
 * `telemetryRun` is injectable on the explicit-evidence path so a test can
 * hold the recorder and read the finished record back; production passes
 * nothing and gets its own.
 */
export async function submitChatQuestion(
    question,
    { evidence = null, correlationId = null, roleId, telemetryRun = null } = {},
) {
    if (!roleId || String(roleId).trim() === "") {
        throw new Error("submitChatQuestion requires a roleId. There is no default role on purpose.");
    }

    if (evidence !== null) {
        return answerFromSuppliedEvidence(question, evidence, roleId, {
            correlationId,
            telemetryRun,
        });
    }

    const result = await answerQuestion(question, { roleId, correlationId });

    return {
        status: "completed",
        response: {
            answer: result.answer,
            receivedQuestion: question,
            answered: result.answered,
            evidenceCount: result.citations.length,
            intent: result.intent,
            route: result.route,
            // present only when the question was answered from the tables. the
            // renderer ignores them when absent, so one path covers both.
            table: result.table ?? null,
            data: result.data ?? null,
            sql: result.sql ?? null,
            grounding: result.grounding,
            retrieval: result.telemetry,
        },
        citations: result.citations,
    };
}

async function answerFromSuppliedEvidence(
    question,
    evidence,
    roleId,
    { correlationId = null, telemetryRun = null } = {},
) {
    const run =
        telemetryRun ||
        startTelemetryRun({
            runType: TELEMETRY_RUN_TYPES.QUERY,
            correlationId,
        });

    try {
        // Sets the record's query class from the question rather than leaving
        // the schema default, so per-class aggregation reports real classes.
        const routing = await routeQuery({ question, recorder: run });

        // Real retrieval (answerQuestion) never runs on this path -- the
        // caller supplied evidence directly, so there is nothing to retrieve.
        // aggregateStageCoverage still counts this as uninstrumented, so
        // coverage stays honest either way.
        run.skipStage(PIPELINE_STAGES.RETRIEVAL, "evidence_supplied_by_caller");

        const generation = await generateAnswer({ question, evidence, recorder: run });
        const bound = bindCitations(generation.answer, evidence);

        await run.finish(RUN_STATUSES.SUCCESS);

        return {
            status: "completed",
            response: {
                answer: generation.answer,
                receivedQuestion: question,
                answered: true,
                evidenceCount: evidence.length,
                queryClass: routing.queryClass,
                intent: "caller_supplied_evidence",
                route: "unstructured",
                generation: {
                    model: generation.model,
                    promptVersion: generation.promptVersion,
                },
                grounding: { grounded: bound.grounded, abstained: false },
                retrieval: { role: roleId, queryKind: "caller_supplied_evidence" },
            },
            citations: bound.citations,

            // The record id, so a caller can read the measurements back from
            // GET /api/telemetry/:recordId. An opaque uuid, no content.
            telemetry: { recordId: run.recordId },
        };
    } catch (error) {
        run.fail(error);
        await run.finish(RUN_STATUSES.FAILED);
        throw error;
    }
}
