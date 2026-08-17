import {
    PIPELINE_STAGES,
    RUN_STATUSES,
    TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";

import { bindCitations } from "../../retrieval/citation.service.js";
import { startTelemetryRun } from "../../telemetry/services/telemetryRecorder.service.js";
import { answerQuestion } from "./answer.service.js";
import { generateAnswer } from "./generation.service.js";
import { routeQuery } from "./routing.service.js";

/**
 * Handles one natural-language question from the browser.
 *
 * Normal browser requests use answerQuestion(), which provides the complete
 * retrieval, routing, table-answer, grounding, abstention and citation flow.
 *
 * The supplied-evidence path is kept for TENISE-19 control tests and
 * TENISE-30 telemetry tests, where evidence or a telemetry recorder is
 * deliberately injected by the caller.
 */
export async function submitChatQuestion(
    question,
    {
        evidence = null,
        roleId,
        correlationId = null,
        telemetryRun = null,
    } = {},
) {
    /*
     * Demo default only.
     * In production, the role should come from the authenticated session
     * rather than being supplied by the client.
     */
    const role =
        roleId && String(roleId).trim() !== ""
            ? roleId
            : "admin";

    /*
     * Explicit evidence is used by grounding/control tests.
     *
     * An injected telemetry run also uses this path because TENISE-30
     * tests need direct access to the measured routing and generation stages.
     */
    if (evidence !== null || telemetryRun !== null) {
        return answerFromSuppliedEvidence(
            question,
            evidence ?? [],
            role,
            {
                correlationId,
                telemetryRun,
            },
        );
    }

    /*
     * Normal application path.
     *
     * answerQuestion() owns the complete query flow so the browser and CLI
     * use the same retrieval, structured-query and citation behaviour.
     */
    const result = await answerQuestion(
        question,
        {
            roleId: role,
        },
    );

    return {
        status: "completed",

        response: {
            answer: result.answer,
            receivedQuestion: question,
            answered: result.answered,
            evidenceCount: result.citations.length,
            intent: result.intent,
            route: result.route,

            /*
             * Structured-query fields are returned only when applicable.
             * The frontend already ignores them when they are null.
             */
            table: result.table ?? null,
            data: result.data ?? null,
            sql: result.sql ?? null,

            grounding: result.grounding,
            retrieval: result.telemetry,
        },

        citations: result.citations,
    };
}

/**
 * Handles requests where evidence is deliberately supplied by the caller.
 *
 * This path is retained for:
 * - TENISE-19 grounding/control tests
 * - TENISE-30 stage telemetry tests
 *
 * It also binds any generated citation markers back to the supplied chunks.
 */
async function answerFromSuppliedEvidence(
    question,
    evidence,
    roleId,
    {
        correlationId = null,
        telemetryRun = null,
    } = {},
) {
    const suppliedEvidence =
        Array.isArray(evidence)
            ? evidence
            : [];

    const run =
        telemetryRun ||
        startTelemetryRun({
            runType: TELEMETRY_RUN_TYPES.QUERY,
            correlationId,
        });

    try {
        /*
         * Measure and record the query class before generation.
         * This preserves the TENISE-30 routing telemetry behaviour.
         */
        const routing = await routeQuery({
            question,
            recorder: run,
        });

        /*
         * Retrieval is not performed on this path because evidence was
         * explicitly supplied by the caller.
         */
        run.skipStage(
            PIPELINE_STAGES.RETRIEVAL,
            suppliedEvidence.length > 0
                ? "evidence_supplied_by_caller"
                : "not_implemented",
        );

        const generation = await generateAnswer({
            question,
            evidence: suppliedEvidence,
            recorder: run,
        });

        /*
         * Bind model citation markers such as [1] back to actual
         * supplied evidence chunks.
         */
        const bound = bindCitations(
            generation.answer,
            suppliedEvidence,
        );

        await run.finish(RUN_STATUSES.SUCCESS);

        return {
            status: "completed",

            response: {
                answer: generation.answer,
                receivedQuestion: question,
                answered: true,
                evidenceCount: suppliedEvidence.length,

                queryClass: routing.queryClass,

                intent: "caller_supplied_evidence",
                route: "unstructured",

                generation: {
                    model: generation.model,
                    promptVersion: generation.promptVersion,
                },

                grounding: {
                    grounded: bound.grounded,
                    danglingCitations: bound.dangling,
                    abstained: false,
                },

                retrieval: {
                    role: roleId,
                    queryKind: "caller_supplied_evidence",
                },
            },

            citations: bound.citations,

            /*
             * Allows telemetry measurements to be retrieved through
             * GET /api/telemetry/:recordId.
             */
            telemetry: {
                recordId: run.recordId,
            },
        };
    } catch (error) {
        run.fail(error);

        await run.finish(
            RUN_STATUSES.FAILED,
        );

        throw error;
    }
}