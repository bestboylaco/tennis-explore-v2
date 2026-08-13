import {
    QUERY_CLASSES,
    RUN_STATUSES,
    TELEMETRY_RUN_TYPES,
} from "../../../shared/constants/telemetry.js";
import { startTelemetryRun } from "../../telemetry/services/telemetryRecorder.service.js";
import { answerQuestion } from "./answer.service.js";
import { generateAnswer } from "./generation.service.js";
import { bindCitations } from "../../retrieval/citation.service.js";

/**
 * Handles one natural-language question from the browser.
 *
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

        await run.finish(RUN_STATUSES.SUCCESS);

        return {
            status: "completed",
            response: {
                answer: generation.answer,
                receivedQuestion: question,
                answered: true,
                evidenceCount: evidence.length,
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
        };
    } catch (error) {
        run.fail(error);
        await run.finish(RUN_STATUSES.FAILED);
        throw error;
    }
}
