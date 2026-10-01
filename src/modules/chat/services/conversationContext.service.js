import {
    rewriteFollowUp,
} from "../../query/queryRewriter.service.js";


const MAX_CONTEXT_TURNS = 3;
const MAX_ANSWER_CHARS = 600;


function normaliseConversationId(value) {
    if (typeof value !== "string") {
        return null;
    }

    const id = value.trim();

    return id || null;
}


function cloneTurn(turn) {
    return {
        question: turn.question,
        answer: turn.answer,
    };
}


/*
 * Returns the session context for the requested conversation.
 *
 * A different conversation id resets the context immediately. This means:
 *
 * - New Chat starts fresh.
 * - Selecting another conversation starts fresh.
 * - Context is never reconstructed from MongoDB conversation history.
 */
function ensureContext(
    session,
    conversationId,
) {
    const id =
        normaliseConversationId(
            conversationId,
        );

    if (!session || !id) {
        return null;
    }

    if (
        session.chatContext?.conversationId !==
        id
    ) {
        session.chatContext = {
            conversationId: id,
            turns: [],
        };
    }

    if (
        !Array.isArray(
            session.chatContext.turns,
        )
    ) {
        session.chatContext.turns = [];
    }

    return session.chatContext;
}


/*
 * Read-only context used by the follow-up rewriter.
 */
export function readContext({
    session,
    conversationId,
} = {}) {
    const context =
        ensureContext(
            session,
            conversationId,
        );

    if (!context) {
        return [];
    }

    return context.turns.map(
        cloneTurn,
    );
}


/*
 * Stores one completed Q/A pair.
 *
 * Store the RESOLVED question rather than the ambiguous original wording.
 * This allows chains of follow-ups to remain anchored to the resolved subject.
 */
export function recordTurn({
    session,
    conversationId,
    resolvedQuestion,
    answer = "",
} = {}) {
    const context =
        ensureContext(
            session,
            conversationId,
        );

    const question =
        String(
            resolvedQuestion ?? "",
        ).trim();

    if (!context || !question) {
        return false;
    }

    context.turns.push({
        question,

        /*
         * Only a short answer excerpt is needed by the rewriter.
         *
         * Evidence, chunks and citations are deliberately not stored in
         * session context.
         */
        answer:
            String(
                answer ?? "",
            ).slice(
                -MAX_ANSWER_CHARS,
            ),
    });

    if (
        context.turns.length >
        MAX_CONTEXT_TURNS
    ) {
        context.turns =
            context.turns.slice(
                -MAX_CONTEXT_TURNS,
            );
    }

    return true;
}


/*
 * Resolves a possible follow-up into a standalone question before routing.
 *
 * Existing queryRewriter.service.js owns:
 *
 * - pronoun/coreference detection
 * - ellipsis detection
 * - topic-shift protection
 * - Ollama rewrite
 * - failure fallback
 */
export async function resolveFollowUp({
    session,
    conversationId,
    question,
    signal = null,
} = {}) {
    const originalQuestion =
        String(
            question ?? "",
        ).trim();

    const history =
        readContext({
            session,
            conversationId,
        });

    const rewrite =
        await rewriteFollowUp(
            originalQuestion,
            history,
            {
                signal,
            },
        );

    return {
        originalQuestion,

        resolvedQuestion:
            rewrite.question ??
            originalQuestion,

        contextTurnsUsed:
            rewrite.turnsUsed ??
            0,

        rewriteApplied:
            Boolean(
                rewrite.applied ??
                rewrite.rewritten,
            ),

        rewriteReason:
            rewrite.reason ??
            "unknown",
    };
}


export function clearContext(
    session,
) {
    if (
        session &&
        Object.prototype.hasOwnProperty.call(
            session,
            "chatContext",
        )
    ) {
        delete session.chatContext;
    }
}


export const conversationContextLimits =
    Object.freeze({
        maxTurns:
            MAX_CONTEXT_TURNS,

        maxAnswerChars:
            MAX_ANSWER_CHARS,
    });