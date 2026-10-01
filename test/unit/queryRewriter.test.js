import assert from "node:assert/strict";
import http from "node:http";

import {
    after,
    describe,
    it,
} from "node:test";

import {
    appendTurn,
    clearSession,
    getTurns,
    resetAllSessions,
    sessionStats,
} from "../../src/modules/chat/services/conversation.service.js";


// a stand-in for the chat model. it does not try to be clever -- it returns
// whatever `globalThis.STUB_REPLY` is set to, so each test decides what a good
// or bad rewrite looks like and asserts on how the code reacts.
let lastPrompt = null;


const server =
    http.createServer(
        (
            req,
            res,
        ) => {
            let body = "";


            req.on(
                "data",
                (chunk) => {
                    body += chunk;
                },
            );


            req.on(
                "end",
                () => {
                    lastPrompt =
                        body;

                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "application/json",
                        },
                    );

                    res.end(
                        JSON.stringify({
                            message: {
                                content:
                                    globalThis
                                        .STUB_REPLY ??
                                    "",
                            },
                        }),
                    );
                },
            );
        },
    );


// port 0, never a fixed one. hard-coding ollama's port means the suite hangs
// for minutes on any machine actually running ollama.
await new Promise(
    (resolve) =>
        server.listen(
            0,
            "127.0.0.1",
            resolve,
        ),
);


process.env.OLLAMA_BASE_URL =
    `http://127.0.0.1:${server.address().port}`;

process.env.REWRITE_ENABLED =
    "true";


// imported here, not at the top of the file, and this is the whole reason the
// setup looks like this. static imports are hoisted and run before any test
// hook, so the config would read the environment -- and freeze the real ollama
// url -- before the two lines above ever executed.
const {
    contentWords,
    dependsOnHistory,
    isTopicShift,
    preservesSubject,
    rewriteFollowUp,
} =
    await import(
        "../../src/modules/query/queryRewriter.service.js"
    );


after(
    () =>
        new Promise(
            (resolve) =>
                server.close(
                    () =>
                        resolve(),
                ),
        ),
);


const clayTurn = [
    {
        question:
            "How many matches were played on clay in 2025?",

        answer:
            "142.",
    },
];


describe(
    "deciding whether a question depends on the conversation",

    () => {
        it(
            "treats the first question of a session as standalone",

            () => {
                const result =
                    dependsOnHistory(
                        "What does the research say about serve injury?",
                        [],
                    );

                assert.equal(
                    result.dependent,
                    false,
                );

                assert.equal(
                    result.reason,
                    "no_history",
                );
            },
        );


        it(
            "spots an ellipsis with no verb or object",

            () => {
                assert.equal(
                    dependsOnHistory(
                        "What about hard court?",
                        clayTurn,
                    ).dependent,

                    true,
                );
            },
        );


        it(
            "spots a continuation opener",

            () => {
                assert.equal(
                    dependsOnHistory(
                        "And in 2024?",
                        clayTurn,
                    ).dependent,

                    true,
                );
            },
        );


        it(
            "spots a reference to something already mentioned",

            () => {
                assert.equal(
                    dependsOnHistory(
                        "Who wrote that paper?",
                        clayTurn,
                    ).dependent,

                    true,
                );
            },
        );


        /*
         * E1-02 regression:
         *
         * The previous implementation treated this as standalone because
         * recommend/training/load produced three content words.
         */
        it(
            "treats a pronoun used as the question subject as conversation-dependent",

            () => {
                const history = [
                    {
                        question:
                            "What did Nat Deegan present about female athletes?",

                        answer:
                            "Previous answer.",
                    },
                ];


                const result =
                    dependsOnHistory(
                        "What did she recommend for training load?",
                        history,
                    );


                assert.equal(
                    result.dependent,
                    true,
                );

                assert.equal(
                    result.reason,
                    "subject_coreference",
                );
            },
        );


        it(
            "leaves a full question alone even when it contains a pronoun",

            () => {
                // the guard against over-rewriting. this question names its own subject,
                // so the pronoun is incidental -- rewriting it risks replacing the
                // subject the user actually asked about.
                const question =
                    "What does the acute chronic workload ratio say about their injury risk?";


                assert.equal(
                    dependsOnHistory(
                        question,
                        clayTurn,
                    ).dependent,

                    false,
                );
            },
        );


        it(
            "leaves a long standalone question alone",

            () => {
                const question =
                    "How much strength is lost after a three hour tennis match?";


                assert.equal(
                    dependsOnHistory(
                        question,
                        clayTurn,
                    ).dependent,

                    false,
                );
            },
        );
    },
);


describe(
    "topic shift",

    () => {
        it(
            "detects a clean change of subject",

            () => {
                assert.equal(
                    isTopicShift(
                        "What does the research say about sleep and recovery?",
                        clayTurn,
                    ),

                    true,
                );
            },
        );


        it(
            "does not call a genuine follow-up a topic shift",

            () => {
                assert.equal(
                    isTopicShift(
                        "How many of those clay matches were won?",
                        clayTurn,
                    ),

                    false,
                );
            },
        );


        /*
         * E1-02 regression:
         *
         * Once subject coreference has identified "she" as dependent, the absence
         * of lexical overlap must not turn the same question back into a topic
         * shift.
         */
        it(
            "does not treat a grammatical subject pronoun as a topic shift",

            () => {
                const history = [
                    {
                        question:
                            "What did Nat Deegan present about female athletes?",

                        answer:
                            "Previous answer.",
                    },
                ];


                assert.equal(
                    isTopicShift(
                        "What did she recommend for training load?",
                        history,
                    ),

                    false,
                );
            },
        );


        it(
            "does not treat a shift as a follow-up just because a word is shared",

            () => {
                // the hard case, and the one a naive similarity check gets wrong.
                // both mention clay; only one continues the previous question.
                const shifted =
                    isTopicShift(
                        "What does the research say about clay court movement?",
                        clayTurn,
                    );


                assert.equal(
                    shifted,

                    false,

                    "shares 'clay', so this is correctly not a shift by overlap",
                );
            },
        );
    },
);


describe(
    "protecting the user's subject",

    () => {
        it(
            "accepts a rewrite that keeps every content word of the follow-up",

            () => {
                assert.equal(
                    preservesSubject(
                        "What about hard court?",
                        "How many matches were played on hard court in 2025?",
                    ),

                    true,
                );
            },
        );


        /*
         * E1-02 regression:
         *
         * A model is allowed to normalise a simple noun from plural to singular
         * without being accused of dropping the user's requested subject.
         */
        it(
            "accepts a safe singular or plural form of the same subject",

            () => {
                assert.equal(
                    preservesSubject(
                        "What about groundstrokes?",
                        "How does groundstroke load differ between training and tournaments?",
                    ),

                    true,
                );
            },
        );


        it(
            "rejects a rewrite that dropped the new subject",

            () => {
                // the dangerous failure. the model has re-asked turn 1 and thrown away
                // what the user just said. the answer would be fluent, cited, and wrong.
                assert.equal(
                    preservesSubject(
                        "What about hard court?",
                        "How many matches were played on clay in 2025?",
                    ),

                    false,
                );
            },
        );


        it(
            "still rejects a rewrite that replaces the requested subject",

            () => {
                assert.equal(
                    preservesSubject(
                        "What about groundstrokes?",
                        "How does serve load differ between training and tournaments?",
                    ),

                    false,
                );
            },
        );


        it(
            "extracts content words and ignores grammar",

            () => {
                const words =
                    contentWords(
                        "How many of those matches were played on clay?",
                    );


                assert.ok(
                    words.has(
                        "matches",
                    ),
                );

                assert.ok(
                    words.has(
                        "clay",
                    ),
                );

                assert.ok(
                    !words.has(
                        "how",
                    ),
                );

                assert.ok(
                    !words.has(
                        "those",
                    ),
                );
            },
        );
    },
);


describe(
    "rewriting end to end",

    () => {
        it(
            "resolves an ellipsis into a standalone question",

            async () => {
                globalThis.STUB_REPLY =
                    "How many matches were played on hard court in 2025?";


                const result =
                    await rewriteFollowUp(
                        "What about hard court?",
                        clayTurn,
                    );


                assert.equal(
                    result.rewritten,
                    true,
                );

                assert.match(
                    result.question,
                    /hard court/i,
                );

                assert.match(
                    result.question,
                    /2025/,
                );

                assert.equal(
                    result.original,
                    "What about hard court?",
                );
            },
        );


        /*
         * E1-02 case 1 end-to-end regression.
         */
        it(
            "resolves a grammatical subject pronoun into a standalone question",

            async () => {
                const history = [
                    {
                        question:
                            "What did Nat Deegan present about female athletes?",

                        answer:
                            "Nat Deegan discussed female athlete training considerations.",
                    },
                ];


                globalThis.STUB_REPLY =
                    "What did Nat Deegan recommend for training load?";


                const result =
                    await rewriteFollowUp(
                        "What did she recommend for training load?",
                        history,
                    );


                assert.equal(
                    result.rewritten,
                    true,
                );

                assert.equal(
                    result.reason,
                    "subject_coreference",
                );

                assert.match(
                    result.question,
                    /Deegan/i,
                );

                assert.match(
                    result.question,
                    /training load/i,
                );
            },
        );


        /*
         * E1-02 case 4 regression.
         */
        it(
            "accepts an ellipsis rewrite with a singularised subject noun",

            async () => {
                const history = [
                    {
                        question:
                            "How does serve load differ between training and tournaments?",

                        answer:
                            "Previous answer.",
                    },
                ];


                globalThis.STUB_REPLY =
                    "How does groundstroke load differ between training and tournaments?";


                const result =
                    await rewriteFollowUp(
                        "What about groundstrokes?",
                        history,
                    );


                assert.equal(
                    result.rewritten,
                    true,
                );

                assert.match(
                    result.question,
                    /groundstroke/i,
                );

                assert.match(
                    result.question,
                    /tournament/i,
                );
            },
        );


        it(
            "makes no model call at all for a standalone question",

            async () => {
                lastPrompt =
                    null;

                globalThis.STUB_REPLY =
                    "should never be used";


                const result =
                    await rewriteFollowUp(
                        "What does the research say about sleep and athlete recovery?",
                        clayTurn,
                    );


                assert.equal(
                    result.rewritten,
                    false,
                );

                assert.equal(
                    lastPrompt,
                    null,
                    "a standalone question must not cost a model call",
                );
            },
        );


        it(
            "drops the history when the user changes topic",

            async () => {
                globalThis.STUB_REPLY =
                    "How many matches on clay involved sleep and recovery?";


                const result =
                    await rewriteFollowUp(
                        "And what does the research say about sleep and recovery?",
                        clayTurn,
                    );


                // opens with "and", so it looks like a continuation -- but it is a new
                // topic, and the previous subject must not be dragged along.
                assert.equal(
                    result.rewritten,
                    false,
                );

                assert.equal(
                    result.reason,
                    "topic_shift",
                );

                assert.equal(
                    result.question,
                    "And what does the research say about sleep and recovery?",
                );
            },
        );


        it(
            "refuses a rewrite that lost the subject and keeps the original",

            async () => {
                globalThis.STUB_REPLY =
                    "How many matches were played on clay in 2025?";


                const result =
                    await rewriteFollowUp(
                        "What about hard court?",
                        clayTurn,
                    );


                assert.equal(
                    result.rewritten,
                    false,
                );

                assert.equal(
                    result.reason,
                    "subject_lost",
                );

                assert.equal(
                    result.question,
                    "What about hard court?",
                );
            },
        );


        it(
            "refuses a rewrite that started answering instead of rewriting",

            async () => {
                globalThis.STUB_REPLY =
                    `On hard court there were 219 matches ${"and a great deal more besides ".repeat(20)}`;


                const result =
                    await rewriteFollowUp(
                        "What about hard court?",
                        clayTurn,
                    );


                assert.equal(
                    result.rewritten,
                    false,
                );

                assert.equal(
                    result.reason,
                    "rewrite_too_long",
                );
            },
        );


        it(
            "returns the question unchanged when the model is unreachable",

            async () => {
                const saved =
                    process.env.OLLAMA_BASE_URL;


                process.env.OLLAMA_BASE_URL =
                    "http://127.0.0.1:1";


                // config froze the url at import, so this call still reaches the stub.
                // the contract remains: a rewrite failure must return the original.
                globalThis.STUB_REPLY =
                    "";


                const result =
                    await rewriteFollowUp(
                        "What about hard court?",
                        clayTurn,
                    );


                assert.equal(
                    result.rewritten,
                    false,
                );

                assert.equal(
                    result.question,
                    "What about hard court?",
                );


                process.env.OLLAMA_BASE_URL =
                    saved;
            },
        );


        it(
            "resolves a bare acknowledgement against what the assistant offered, not the user's own question",

            () => {
                globalThis.STUB_REPLY =
                    "Can you look for the biological or methodological reasons for the variability in maturity estimation?";


                const offerTurn = [
                    {
                        question:
                            "How predictable is maturity estimation around peak height velocity?",

                        answer:
                            "Estimation accuracy decreases around peak height velocity. " +
                            "The evidence does not explain why. " +
                            "Let me know if you'd like me to look for the biological or " +
                            "methodological reasons for this variability.",
                    },
                ];


                return rewriteFollowUp(
                    "yep can you do that",
                    offerTurn,
                ).then(
                    (result) => {
                        assert.equal(
                            result.rewritten,
                            true,
                        );

                        assert.notEqual(
                            result.reason,
                            "subject_lost",
                        );

                        assert.match(
                            result.question,
                            /biological|methodological/i,
                        );
                    },
                );
            },
        );


        it(
            "shows the model what the assistant answered, not just what the user asked",

            async () => {
                lastPrompt =
                    null;

                globalThis.STUB_REPLY =
                    "Can you look for that?";


                const offerTurn = [
                    {
                        question:
                            "How predictable is maturity estimation?",

                        answer:
                            "It decreases near peak height velocity. " +
                            "Let me know if you want the reasons why.",
                    },
                ];


                await rewriteFollowUp(
                    "yep can you do that",
                    offerTurn,
                );


                assert.ok(
                    lastPrompt,
                    "expected a model call",
                );


                assert.match(
                    JSON.parse(
                        lastPrompt,
                    ).messages[1].content,

                    /Assistant answered:.*reasons why/s,
                );
            },
        );


        it(
            "only shows the model the most recent turns",

            async () => {
                globalThis.STUB_REPLY =
                    "How many matches were played on grass in 2025?";


                const long =
                    Array.from(
                        {
                            length:
                                9,
                        },

                        (
                            _,
                            index,
                        ) => ({
                            question:
                                `Filler question number ${index} about ranking points`,

                            answer:
                                "x",
                        }),
                    );


                await rewriteFollowUp(
                    "What about grass?",
                    [
                        ...long,
                        ...clayTurn,
                    ],
                );


                const sent =
                    JSON.parse(
                        lastPrompt,
                    );


                const prompt =
                    sent.messages
                        .map(
                            (message) =>
                                message.content,
                        )
                        .join(
                            " ",
                        );


                assert.ok(
                    !prompt.includes(
                        "Filler question number 0",
                    ),

                    "the oldest turn must not be sent",
                );
            },
        );
    },
);


describe(
    "session memory",

    () => {
        it(
            "starts empty and returns turns in order",

            () => {
                resetAllSessions();


                assert.deepEqual(
                    getTurns(
                        "s1",
                    ),

                    [],
                );


                appendTurn(
                    "s1",
                    {
                        question:
                            "first",

                        answer:
                            "a",
                    },
                );


                appendTurn(
                    "s1",
                    {
                        question:
                            "second",

                        answer:
                            "b",
                    },
                );


                assert.deepEqual(
                    getTurns(
                        "s1",
                    ).map(
                        (turn) =>
                            turn.question,
                    ),

                    [
                        "first",
                        "second",
                    ],
                );
            },
        );


        it(
            "keeps conversations separate",

            () => {
                resetAllSessions();


                appendTurn(
                    "s1",
                    {
                        question:
                            "clay question",
                    },
                );


                appendTurn(
                    "s2",
                    {
                        question:
                            "sleep question",
                    },
                );


                assert.equal(
                    getTurns(
                        "s1",
                    ).length,

                    1,
                );


                assert.equal(
                    getTurns(
                        "s2",
                    )[0].question,

                    "sleep question",
                );
            },
        );


        it(
            "does not store turns against a missing session id",

            () => {
                resetAllSessions();


                appendTurn(
                    null,
                    {
                        question:
                            "orphan",
                    },
                );


                assert.equal(
                    sessionStats().turns,
                    0,
                );
            },
        );


        it(
            "bounds how much of one conversation is kept",

            () => {
                resetAllSessions();


                for (
                    let index = 0;
                    index < 30;
                    index += 1
                ) {
                    appendTurn(
                        "s1",
                        {
                            question:
                                `q${index}`,
                        },
                    );
                }


                const turns =
                    getTurns(
                        "s1",
                    );


                assert.ok(
                    turns.length <= 12,
                    `kept ${turns.length}, expected at most 12`,
                );


                assert.equal(
                    turns.at(
                        -1,
                    ).question,

                    "q29",

                    "the most recent turn must survive",
                );
            },
        );


        it(
            "truncates the stored answer rather than keeping retrieved content",

            () => {
                resetAllSessions();


                appendTurn(
                    "s1",
                    {
                        question:
                            "q",

                        answer:
                            "x".repeat(
                                5000,
                            ),
                    },
                );


                assert.ok(
                    getTurns(
                        "s1",
                    )[0].answer.length <=
                    400,
                );
            },
        );


        it(
            "forgets a conversation on request",

            () => {
                resetAllSessions();


                appendTurn(
                    "s1",
                    {
                        question:
                            "q",
                    },
                );


                clearSession(
                    "s1",
                );


                assert.deepEqual(
                    getTurns(
                        "s1",
                    ),

                    [],
                );
            },
        );
    },
);