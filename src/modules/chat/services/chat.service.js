import {
    QUERY_CLASSES,
    RUN_STATUSES,
    TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";
import { startTelemetryRun } from "../../telemetry/services/telemetryRecorder.service.js";
import { generateAnswer } from "./generation.service.js";

/**
 * Handles one natural-language coaching question.
 *
 * Generation (TENISE-19) is real: it calls a local Ollama model grounded in
 * `evidence`. Real retrieval (TENISE-15/17) is not wired in yet, so evidence
 * defaults to empty until that lands -- the response is deliberately not
 * forced into the TENISE-22 four-section template; the frontend renders
 * whatever structure the backend returns.
 */
export async function submitChatQuestion(question, { evidence = [] } = {}) {
    const run = startTelemetryRun({
        runType: TELEMETRY_RUN_TYPES.QUERY,
        queryClass: QUERY_CLASSES.DOCUMENT,
    });

    try {
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
                generation: {
                    model: generation.model,
                    promptVersion: generation.promptVersion,
                },
            },

            // Citation binding to source chunks is TENISE-21; empty until
            // retrieval supplies real evidence with resolvable citations.
            citations: [],
        };
    } catch (error) {
        run.fail(error);
        await run.finish(RUN_STATUSES.FAILED);
        throw error;
    }
}
