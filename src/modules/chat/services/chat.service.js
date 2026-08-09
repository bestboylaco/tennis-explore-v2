import {
    QUERY_CLASSES,
    RUN_STATUSES,
    TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";
import { startTelemetryRun } from "../../telemetry/services/telemetryRecorder.service.js";
import { retrieve } from "../../retrieval/retrieval.service.js";
import { bindCitations, findUnsupportedNumbers } from "../../retrieval/citation.service.js";
import { generateAnswer } from "./generation.service.js";

/**
 * Handles one natural-language coaching question, end to end.
 *
 * retrieve (TENISE-15/17) -> generate (TENISE-19) -> bind citations (TENISE-21).
 *
 * The caller must supply a role. There is deliberately no default: a default
 * would mean a caller that forgets to pass one still gets documents back, and
 * the role they would silently get is whichever we picked. In a real deployment
 * roleId comes off the authenticated session, not the request body -- taking it
 * from the body, as this does, is fine for the local demo and must not survive
 * into anything the partner can reach.
 *
 * `evidence` can still be passed in explicitly. That path is what TENISE-19's
 * control tests use (forced-empty evidence, deliberately incorrect evidence),
 * and it stays supported so those tests keep working without an index.
 */
export async function submitChatQuestion(question, { evidence = null, roleId = "analyst" } = {}) {
    const run = startTelemetryRun({
        runType: TELEMETRY_RUN_TYPES.QUERY,
        queryClass: QUERY_CLASSES.DOCUMENT,
    });

    try {
        let retrieval = null;
        let evidenceSet = evidence;

        // only touch the index when the caller did not hand us evidence.
        if (evidenceSet === null) {
            retrieval = await retrieve(question, { roleId });
            evidenceSet = retrieval.evidence;
        }

        const generation = await generateAnswer({
            question,
            evidence: evidenceSet,
            recorder: run,
        });

        // bind every [n] marker in the answer back to the chunk it names.
        const bound = bindCitations(generation.answer, evidenceSet);

        // a crude but useful grounding check: a figure in the answer that
        // appears nowhere in the evidence is nearly always the model filling in
        // from memory, which is exactly what the prompt is written to prevent.
        const unsupportedNumbers = findUnsupportedNumbers(generation.answer, evidenceSet);

        await run.finish(RUN_STATUSES.SUCCESS);

        return {
            status: "completed",
            response: {
                answer: generation.answer,
                receivedQuestion: question,
                evidenceCount: evidenceSet.length,
                generation: {
                    model: generation.model,
                    promptVersion: generation.promptVersion,
                },
                retrieval: retrieval
                    ? {
                          role: retrieval.roleId,
                          queryKind: retrieval.plan.kind,
                          notes: retrieval.notes,
                          ...retrieval.telemetry,
                      }
                    : { role: roleId, queryKind: "caller_supplied_evidence" },
                // surfaced rather than hidden. an answer that cites nothing, or
                // cites a block that does not exist, is not a good answer even
                // when it reads like one, and the frontend should be able to say so.
                grounding: {
                    grounded: bound.grounded,
                    danglingCitations: bound.dangling,
                    unusedEvidence: bound.unusedEvidence,
                    unsupportedNumbers,
                },
            },

            // Citation binding to source chunks (TENISE-21 / E4-15).
            citations: bound.citations,
        };
    } catch (error) {
        run.fail(error);
        await run.finish(RUN_STATUSES.FAILED);
        throw error;
    }
}
