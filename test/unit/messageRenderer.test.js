import assert from "node:assert/strict";
import {
    describe,
    it,
} from "node:test";

import {
    appendAssistantMessage,
} from "../../public/scripts/ui/messageRenderer.js";


let JSDOM = null;

try {
    ({ JSDOM } =
        await import(
            "jsdom"
        ));
} catch {
    JSDOM = null;
}


function createConversation() {
    const dom =
        new JSDOM(
            `<body>
                <div id="conversation"></div>
            </body>`,
            {
                url:
                    "http://localhost:3000",
            },
        );

    return {
        dom,

        conversation:
            dom.window.document.querySelector(
                "#conversation",
            ),
    };
}


const citations = [
    {
        number:
            1,

        docId:
            "perri-2022",

        title:
            "Serve Kinematics Study",

        link: {
            label:
                "Serve Kinematics Study",
        },
    },

    {
        number:
            2,

        docId:
            "whiteside-2013",

        title:
            "Kinematic comparison",

        link: {
            label:
                "Kinematic comparison",
        },
    },
];


const references = [
    "[1] Thomas Perri. (2022). Serve Kinematics Study. [research_paper]",
    "[2] Whiteside et al. (2013). Kinematic comparison. [research_paper]",
];


describe(
    "direct in-text citation links",

    {
        skip:
            JSDOM
                ? false
                : "jsdom is not installed -- run npm install",
    },

    () => {
        it(
            "opens an APA in-text citation through the existing source resolver",

            () => {
                const {
                    conversation,
                } =
                    createConversation();

                const opened = [];

                appendAssistantMessage({
                    conversation,

                    content:
                        "Serve loading should be monitored carefully (Perri, 2022).",

                    citations,

                    references,

                    openCitation:
                        (
                            citation,
                            anchor,
                        ) =>
                            opened.push({
                                citation,
                                anchor,
                            }),
                });

                const button =
                    conversation.querySelector(
                        ".in-text-citation",
                    );

                assert.ok(
                    button,
                    "expected the visible APA citation to become clickable",
                );

                assert.equal(
                    button.textContent,
                    "Perri, 2022",
                );

                button.click();

                assert.equal(
                    opened.length,
                    1,
                );

                assert.equal(
                    opened[0].citation.docId,
                    "perri-2022",
                );

                assert.equal(
                    opened[0].anchor,
                    button,
                );
            },
        );


        it(
            "supports title-and-year fallback citations when author metadata is missing",

            () => {
                const {
                    conversation,
                } =
                    createConversation();

                let opened = null;

                appendAssistantMessage({
                    conversation,

                    content:
                        'The player was considered predictable ("Opponent Note Details Report Good pace...", 2020).',

                    citations: [
                        {
                            number:
                                1,

                            docId:
                                "opponent-note-2020",

                            title:
                                "Opponent Note Details Report Good pace on first serve but consistent targeting is not quite there yet",

                            link: {
                                label:
                                    "Opponent Note Details Report Good pace on first serve but consistent targeting is not quite there yet",
                            },
                        },
                    ],

                    references: [
                        "[1] (2020). Opponent Note Details Report Good pace on first serve but consistent targeting is not quite there yet. [report]",
                    ],

                    openCitation:
                        (citation) => {
                            opened =
                                citation.docId;
                        },
                });

                const button =
                    conversation.querySelector(
                        ".in-text-citation",
                    );

                assert.ok(
                    button,
                    "expected the title/year citation shown in the UI to become clickable",
                );

                button.click();

                assert.equal(
                    opened,
                    "opponent-note-2020",
                );
            },
        );


        it(
            "links each source separately when an APA group contains two citations",

            () => {
                const {
                    conversation,
                } =
                    createConversation();

                const opened = [];

                appendAssistantMessage({
                    conversation,

                    content:
                        "Both papers support the comparison (Perri, 2022; Whiteside et al., 2013).",

                    citations,

                    references,

                    openCitation:
                        (citation) =>
                            opened.push(
                                citation.docId,
                            ),
                });

                const buttons =
                    [
                        ...conversation.querySelectorAll(
                            ".in-text-citation",
                        ),
                    ];

                assert.equal(
                    buttons.length,
                    2,
                );

                buttons[0].click();
                buttons[1].click();

                assert.deepEqual(
                    opened,
                    [
                        "perri-2022",
                        "whiteside-2013",
                    ],
                );
            },
        );


        it(
            "keeps raw numeric citation markers clickable as a fallback",

            () => {
                const {
                    conversation,
                } =
                    createConversation();

                let opened = null;

                appendAssistantMessage({
                    conversation,

                    content:
                        "The source reports the same result [2].",

                    citations,

                    references,

                    openCitation:
                        (citation) => {
                            opened =
                                citation.docId;
                        },
                });

                const button =
                    conversation.querySelector(
                        ".in-text-citation",
                    );

                assert.ok(
                    button,
                );

                button.click();

                assert.equal(
                    opened,
                    "whiteside-2013",
                );
            },
        );


        it(
            "does not render the old Sources dropdown",

            () => {
                const {
                    conversation,
                } =
                    createConversation();

                appendAssistantMessage({
                    conversation,

                    content:
                        "Evidence is available (Perri, 2022).",

                    citations,

                    references,

                    openCitation:
                        () => {},
                });

                assert.ok(
                    conversation.querySelector(
                        ".in-text-citation",
                    ),
                );

                assert.equal(
                    conversation.querySelector(
                        ".citation-list__toggle",
                    ),
                    null,
                );

                assert.equal(
                    conversation.querySelector(
                        ".citation-list",
                    ),
                    null,
                );
            },
        );


        it(
            "does not show the 'uncited' coverage disclaimer, even when citedFraction is low",

            () => {
                // direct instruction, 2026-10-09: a coach-facing "most of this
                // answer is uncited" banner undermines trust in an answer that
                // may be correct, just imperfectly attributed. the underlying
                // computation stays untouched for the eval corpus (this test
                // only covers the renderer never showing it to begin with).
                const {
                    conversation,
                } =
                    createConversation();

                appendAssistantMessage({
                    conversation,

                    content:
                        "Evidence is available (Perri, 2022).",

                    citations,

                    references,

                    grounding: {
                        grounded: false,

                        warnings: [
                            {
                                kind: "weak_attribution",
                                severity: "medium",
                                detail: "3 of 6 factual sentences carry no citation",
                            },
                        ],
                    },

                    openCitation:
                        () => {},
                });

                assert.equal(
                    conversation.querySelector(
                        ".composer-status",
                    ),
                    null,
                    "the coverage disclaimer must not reach the chat bubble",
                );
            },
        );


        it(
            "still shows a dangling-citation warning -- a different, stronger concern than coverage",

            () => {
                const {
                    conversation,
                } =
                    createConversation();

                appendAssistantMessage({
                    conversation,

                    content:
                        "Evidence is available (Perri, 2022) [9].",

                    citations,

                    references,

                    grounding: {
                        grounded: false,
                        danglingCitations: [9],
                    },

                    openCitation:
                        () => {},
                });

                const warning =
                    conversation.querySelector(
                        ".composer-status",
                    );

                assert.ok(
                    warning,
                    "a citation pointing at nothing must still be flagged",
                );

                assert.match(
                    warning.textContent,
                    /\[9\]/,
                );
            },
        );
    },
);
