import {
    PIPELINE_STAGES,
    RUN_STATUSES,
    TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";
import { startTelemetryRun } from "../../telemetry/services/telemetryRecorder.service.js";
import { answerQuestion } from "./answer.service.js";
import { generateAnswer } from "./generation.service.js";
<<<<<<< HEAD
import { bindCitations } from "../../retrieval/citation.service.js";
=======
import { routeQuery } from "./routing.service.js";
>>>>>>> origin/main

/**
 * Handles one natural-language question from the browser.
 *
<<<<<<< HEAD
 * Delegates to answerQuestion, which is the same path `npm run ask` uses, so
 * the browser and the command line cannot drift apart. They did: this file
 * previously ran its own retrieve-then-generate sequence, so the web UI never
 * got query routing, table answers, evidence grading, abstention or
 * deep-linked citations -- and nothing said so.
 *
 * The role is normalised rather than defaulted in the signature, because a
 * form submits an empty string and `?? "analyst"` would not catch it. In a real
 * deployment roleId comes off the authenticated session and is never
 * client-supplied: a caller who picks their own role has every role.
 */
export async function submitChatQuestion(question, { evidence = null, roleId } = {}) {
    // DEMO DEFAULT. admin sees everything, which is what you want while
    // building and testing. it is the wrong default for anything real: the
    // role must come off the authenticated session, and a caller who picks
    // their own role has every role. change this before the partner sees it.
    const role = roleId && String(roleId).trim() !== "" ? roleId : "admin";

    // the explicit-evidence path stays, because TENISE-19's control tests use
    // it -- forced-empty evidence, and evidence carrying a deliberately
    // incorrect fact -- and those must keep working without an index.
    if (evidence !== null) {
        return answerFromSuppliedEvidence(question, evidence, role);
    }

    const result = await answerQuestion(question, { roleId: role });

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

async function answerFromSuppliedEvidence(question, evidence, roleId) {
    const run = startTelemetryRun({
        runType: TELEMETRY_RUN_TYPES.QUERY,
        queryClass: QUERY_CLASSES.DOCUMENT,
    });

    try {
        const generation = await generateAnswer({ question, evidence, recorder: run });
        const bound = bindCitations(generation.answer, evidence);
=======
 * Routing (TENISE-30) and generation (TENISE-19) are real. Real retrieval
 * (TENISE-15/17) is not wired in yet, so evidence arrives from the caller until
 * that lands -- the response is deliberately not forced into the TENISE-22
 * four-section template; the frontend renders whatever structure the backend
 * returns.
 *
 * Every stage that exists reports its own latency, tokens and compute, so the
 * record can name the bottleneck rather than only the total (TENISE-30).
 *
 * `telemetryRun` is injectable so a test can hold the recorder and read the
 * finished record back; production passes nothing and gets its own.
 */
export async function submitChatQuestion(
    question,
    { evidence = [], correlationId = null, telemetryRun = null } = {},
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

        // Retrieval has no implementation yet, but leaving the stage at
        // not_implemented would hide which of the two reasons applies. Skipped
        // with a reason states it: aggregateStageCoverage still counts both as
        // uninstrumented, so coverage stays honest either way.
        //
        // TODO(TENISE-15/17): replace with the real search, measured as
        //   await withColdStartDetection(run, { resource, stage: "retrieval" },
        //     () => run.measureStage("retrieval", () => search(question), {
        //       apiType, apiCalls: 1, itemsIn, itemsOut, ocuResource }));
        run.skipStage(
            PIPELINE_STAGES.RETRIEVAL,
            evidence.length > 0 ? "evidence_supplied_by_caller" : "not_implemented",
        );

        // Rerank keeps its seeded not_implemented status: TENISE-18 builds it
        // and emits into the same fields with no schema change.

        const generation = await generateAnswer({
            question,
            evidence,
            recorder: run,
        });
>>>>>>> origin/main

        await run.finish(RUN_STATUSES.SUCCESS);

        return {
            status: "completed",
            response: {
                answer: generation.answer,
                receivedQuestion: question,
                answered: true,
                evidenceCount: evidence.length,
<<<<<<< HEAD
                intent: "caller_supplied_evidence",
                route: "unstructured",
=======
                queryClass: routing.queryClass,
>>>>>>> origin/main
                generation: {
                    model: generation.model,
                    promptVersion: generation.promptVersion,
                },
                grounding: { grounded: bound.grounded, abstained: false },
                retrieval: { role: roleId, queryKind: "caller_supplied_evidence" },
            },
<<<<<<< HEAD
            citations: bound.citations,
=======

            // Citation binding to source chunks is TENISE-21; empty until
            // retrieval supplies real evidence with resolvable citations.
            citations: [],

            // The record id, so a caller can read the measurements back from
            // GET /api/telemetry/:recordId. An opaque uuid, no content.
            telemetry: { recordId: run.recordId },
>>>>>>> origin/main
        };
    } catch (error) {
        run.fail(error);
        await run.finish(RUN_STATUSES.FAILED);
        throw error;
    }
}
