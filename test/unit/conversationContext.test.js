import assert from "node:assert/strict";

import {
    describe,
    it,
} from "node:test";

import {
    clearContext,
    conversationContextLimits,
    readContext,
    recordTurn,
    resolveFollowUp,
} from "../../src/modules/chat/services/conversationContext.service.js";


describe(
    "E1-02 session-scoped conversation context",

    () => {
        it(
            "starts with no context",

            () => {
                const session = {};

                assert.deepEqual(
                    readContext({
                        session,

                        conversationId:
                            "conversation-a",
                    }),

                    [],
                );
            },
        );


        it(
            "stores the resolved question",

            () => {
                const session = {};

                recordTurn({
                    session,

                    conversationId:
                        "conversation-a",

                    resolvedQuestion:
                        "What did Nat Deegan recommend for training load?",

                    answer:
                        "Example answer",
                });

                const [turn] =
                    readContext({
                        session,

                        conversationId:
                            "conversation-a",
                    });

                assert.equal(
                    turn.question,

                    "What did Nat Deegan recommend for training load?",
                );
            },
        );


        it(
            "keeps only the latest three exchanges",

            () => {
                const session = {};

                for (
                    let index = 1;
                    index <= 5;
                    index += 1
                ) {
                    recordTurn({
                        session,

                        conversationId:
                            "conversation-a",

                        resolvedQuestion:
                            `Question ${index}`,

                        answer:
                            `Answer ${index}`,
                    });
                }

                const turns =
                    readContext({
                        session,

                        conversationId:
                            "conversation-a",
                    });

                assert.equal(
                    turns.length,
                    conversationContextLimits.maxTurns,
                );

                assert.deepEqual(
                    turns.map(
                        (turn) =>
                            turn.question,
                    ),

                    [
                        "Question 3",
                        "Question 4",
                        "Question 5",
                    ],
                );
            },
        );


        it(
            "changing conversation id clears context",

            () => {
                const session = {};

                recordTurn({
                    session,

                    conversationId:
                        "conversation-a",

                    resolvedQuestion:
                        "Who is Nat Deegan?",

                    answer:
                        "Answer",
                });

                assert.equal(
                    readContext({
                        session,

                        conversationId:
                            "conversation-a",
                    }).length,

                    1,
                );

                assert.deepEqual(
                    readContext({
                        session,

                        conversationId:
                            "conversation-b",
                    }),

                    [],
                );
            },
        );


        it(
            "a fresh session cannot access the old session context",

            () => {
                const firstSession = {};
                const secondSession = {};

                recordTurn({
                    session:
                        firstSession,

                    conversationId:
                        "conversation-a",

                    resolvedQuestion:
                        "Summarise Whiteside et al. 2013.",

                    answer:
                        "Answer",
                });

                assert.deepEqual(
                    readContext({
                        session:
                            secondSession,

                        conversationId:
                            "conversation-a",
                    }),

                    [],
                );
            },
        );


        it(
            "the first question uses zero prior turns",

            async () => {
                const result =
                    await resolveFollowUp({
                        session:
                            {},

                        conversationId:
                            "conversation-a",

                        question:
                            "What did Nat Deegan present about female athletes?",
                    });

                assert.equal(
                    result.resolvedQuestion,

                    "What did Nat Deegan present about female athletes?",
                );

                assert.equal(
                    result.contextTurnsUsed,
                    0,
                );
            },
        );


        it(
            "clearContext removes session context",

            () => {
                const session = {};

                recordTurn({
                    session,

                    conversationId:
                        "conversation-a",

                    resolvedQuestion:
                        "Question",

                    answer:
                        "Answer",
                });

                clearContext(
                    session,
                );

                assert.equal(
                    session.chatContext,
                    undefined,
                );
            },
        );
    },
);