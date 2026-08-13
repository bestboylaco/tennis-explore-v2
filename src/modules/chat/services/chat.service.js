import {
    PIPELINE_STAGES,
    RUN_STATUSES,
    TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";
import { startTelemetryRun } from "../../telemetry/services/telemetryRecorder.service.js";
import { generateAnswer } from "./generation.service.js";
import { routeQuery } from "./routing.service.js";

/**
 * Handles one natural-language coaching question.
 *
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

        await run.finish(RUN_STATUSES.SUCCESS);

        return {
            status: "completed",
            response: {
                answer: generation.answer,
                receivedQuestion: question,
                evidenceCount: evidence.length,
                queryClass: routing.queryClass,
                generation: {
                    model: generation.model,
                    promptVersion: generation.promptVersion,
                },
            },

            // Citation binding to source chunks is TENISE-21; empty until
            // retrieval supplies real evidence with resolvable citations.
            citations: [],

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
