import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createChatHistory } from "../../public/scripts/ui/chatHistory.js";

let JSDOM = null;

try {
    ({ JSDOM } = await import("jsdom"));
} catch {
    JSDOM = null;
}

const MARKUP = `<body>
    <button id="toggle" aria-expanded="false"></button>
    <button id="new-chat"></button>
    <span id="count"></span>
    <div id="panel" hidden>
        <p id="empty"></p>
        <div id="list"></div>
    </div>
</body>`;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createStore(initial = []) {
    let conversations = clone(initial);
    let nextId = 10;
    let tick = 30;

    function summary(conversation) {
        const { messages, ...rest } = conversation;

        return {
            ...rest,
            messageCount: messages.length,
        };
    }

    function orderedSummaries() {
        return conversations
            .map(summary)
            .sort(
                (left, right) =>
                    new Date(right.lastMessageAt) -
                    new Date(left.lastMessageAt),
            );
    }

    return {
        async listConversations() {
            return clone(
                orderedSummaries(),
            );
        },

        async getConversation(id) {
            return clone(
                conversations.find(
                    (item) =>
                        item.id === id,
                ),
            );
        },

        async createConversation(message) {
            const timestamp =
                `2026-09-02T10:${String(tick++).padStart(2, "0")}:00.000Z`;

            const conversation = {
                id:
                    `conversation-${nextId++}`,

                title:
                    message.content,

                createdAt:
                    timestamp,

                updatedAt:
                    timestamp,

                lastMessageAt:
                    timestamp,

                messages: [
                    clone(message),
                ],
            };

            conversations.push(
                conversation,
            );

            return clone({
                ...summary(
                    conversation,
                ),

                messages:
                    conversation.messages,
            });
        },

        async appendConversationMessage(
            id,
            message,
        ) {
            const conversation =
                conversations.find(
                    (item) =>
                        item.id === id,
                );

            const timestamp =
                `2026-09-02T10:${String(tick++).padStart(2, "0")}:00.000Z`;

            conversation.messages.push(
                clone(message),
            );

            conversation.updatedAt =
                timestamp;

            conversation.lastMessageAt =
                timestamp;

            return clone(
                summary(conversation),
            );
        },
    };
}

async function flush() {
    await new Promise(
        (resolve) =>
            setTimeout(
                resolve,
                0,
            ),
    );
}

async function mount({
    initial = [],
    store = createStore(initial),
} = {}) {
    const dom =
        new JSDOM(
            MARKUP,
            {
                url:
                    "http://localhost:3000",
            },
        );

    const { document } =
        dom.window;

    const selected = [];
    const errors = [];

    const history =
        await createChatHistory({
            toggleButton:
                document.querySelector(
                    "#toggle",
                ),

            panel:
                document.querySelector(
                    "#panel",
                ),

            list:
                document.querySelector(
                    "#list",
                ),

            emptyState:
                document.querySelector(
                    "#empty",
                ),

            countNode:
                document.querySelector(
                    "#count",
                ),

            newChatButton:
                document.querySelector(
                    "#new-chat",
                ),

            onSelectConversation:
                (conversation) =>
                    selected.push(
                        conversation,
                    ),

            onError:
                (error) =>
                    errors.push(
                        error,
                    ),

            store,
        });

    return {
        document,
        history,
        selected,
        errors,
        store,
    };
}

const SAVED = [
    {
        id:
            "conversation-newer",

        title:
            "Review the latest match",

        createdAt:
            "2026-09-02T09:00:00.000Z",

        updatedAt:
            "2026-09-02T09:20:00.000Z",

        lastMessageAt:
            "2026-09-02T09:20:00.000Z",

        messages: [
            {
                role: "user",
                content:
                    "Review the latest match",
            },
            {
                role: "assistant",
                content:
                    "Newer answer",
            },
        ],
    },

    {
        id:
            "conversation-older",

        title:
            "Plan tomorrow's serve session",

        createdAt:
            "2026-09-01T08:00:00.000Z",

        updatedAt:
            "2026-09-01T08:15:00.000Z",

        lastMessageAt:
            "2026-09-01T08:15:00.000Z",

        messages: [
            {
                role: "user",
                content:
                    "Plan tomorrow's serve session",
            },
            {
                role: "assistant",
                content:
                    "Older answer",
            },
        ],
    },
];

describe(
    "account-scoped chat history",

    {
        skip:
            JSDOM
                ? false
                : "jsdom is not installed -- run npm install",
    },

    () => {
        it(
            "starts expanded with a defined empty state when the account has no history",

            async () => {
                const { document } =
                    await mount();

                /*
                 * Chat History is visible by default.
                 */
                assert.equal(
                    document
                        .querySelector(
                            "#panel",
                        )
                        .hidden,
                    false,
                );

                assert.equal(
                    document
                        .querySelector(
                            "#toggle",
                        )
                        .getAttribute(
                            "aria-expanded",
                        ),
                    "true",
                );

                assert.equal(
                    document
                        .querySelector(
                            "#count",
                        )
                        .textContent,
                    "0",
                );

                assert.equal(
                    document
                        .querySelector(
                            "#empty",
                        )
                        .hidden,
                    false,
                );

                assert.match(
                    document
                        .querySelector(
                            "#empty",
                        )
                        .textContent,

                    /No saved conversations/i,
                );
            },
        );

        it(
            "restores saved conversations when the page is mounted again",

            async () => {
                const store =
                    createStore(
                        SAVED,
                    );

                const firstMount =
                    await mount({
                        store,
                    });

                assert.equal(
                    firstMount.document
                        .querySelector(
                            "#count",
                        )
                        .textContent,
                    "2",
                );

                const secondMount =
                    await mount({
                        store,
                    });

                const titles = [
                    ...secondMount.document
                        .querySelectorAll(
                            ".chat-history__item-title",
                        ),
                ].map(
                    (node) =>
                        node.textContent,
                );

                assert.deepEqual(
                    titles,
                    [
                        "Review the latest match",
                        "Plan tomorrow's serve session",
                    ],
                );
            },
        );

        it(
            "does not reorder the list when an older conversation is selected",

            async () => {
                const { document } =
                    await mount({
                        initial:
                            SAVED,
                    });

                const before = [
                    ...document.querySelectorAll(
                        ".chat-history__item-title",
                    ),
                ].map(
                    (node) =>
                        node.textContent,
                );

                const older =
                    document.querySelector(
                        '[data-conversation-id="conversation-older"]',
                    );

                older.click();

                await flush();

                const after = [
                    ...document.querySelectorAll(
                        ".chat-history__item-title",
                    ),
                ].map(
                    (node) =>
                        node.textContent,
                );

                assert.deepEqual(
                    after,
                    before,
                );

                const active =
                    document.querySelector(
                        '[data-conversation-id="conversation-older"]',
                    );

                assert.ok(
                    active.classList.contains(
                        "chat-history__item--active",
                    ),
                );
            },
        );

        it(
            "shows enough metadata to distinguish conversations with similar titles",

            async () => {
                const { document } =
                    await mount({
                        initial:
                            SAVED,
                    });

                const rows = [
                    ...document.querySelectorAll(
                        ".chat-history__item",
                    ),
                ];

                assert.match(
                    rows[0]
                        .querySelector(
                            ".chat-history__item-meta",
                        )
                        .textContent,

                    /2 messages/,
                );

                assert.match(
                    rows[1]
                        .querySelector(
                            ".chat-history__item-meta",
                        )
                        .textContent,

                    /2 messages/,
                );
            },
        );

        it(
            "new chat does not create an empty saved row",

            async () => {
                const { document } =
                    await mount({
                        initial:
                            SAVED,
                    });

                document
                    .querySelector(
                        "#new-chat",
                    )
                    .click();

                assert.equal(
                    document
                        .querySelector(
                            "#count",
                        )
                        .textContent,
                    "2",
                );

                assert.equal(
                    document
                        .querySelectorAll(
                            ".chat-history__item",
                        )
                        .length,
                    2,
                );
            },
        );

        it(
            "creates a saved conversation from the first question and marks it current",

            async () => {
                const {
                    document,
                    history,
                } =
                    await mount({
                        initial:
                            SAVED,
                    });

                document
                    .querySelector(
                        "#new-chat",
                    )
                    .click();

                await history
                    .recordUserMessage(
                        "How should I structure recovery tomorrow?",
                    );

                assert.equal(
                    document
                        .querySelector(
                            "#count",
                        )
                        .textContent,
                    "3",
                );

                const active =
                    document.querySelector(
                        ".chat-history__item--active",
                    );

                assert.ok(
                    active,
                );

                assert.match(
                    active.textContent,

                    /How should I structure recovery tomorrow/,
                );

                assert.match(
                    active.textContent,

                    /Current/,
                );
            },
        );

        it(
            "loads the selected conversation without leaving the workspace",

            async () => {
                const {
                    document,
                    selected,
                } =
                    await mount({
                        initial:
                            SAVED,
                    });

                document
                    .querySelector(
                        '[data-conversation-id="conversation-older"]',
                    )
                    .click();

                await flush();

                const lastSelection =
                    selected.at(-1);

                assert.equal(
                    lastSelection.id,
                    "conversation-older",
                );

                assert.equal(
                    lastSelection
                        .messages
                        .length,
                    2,
                );

                assert.equal(
                    lastSelection
                        .messages[1]
                        .content,
                    "Older answer",
                );
            },
        );

        it(
            "can collapse and expand without changing the history order",

            async () => {
                const { document } =
                    await mount({
                        initial:
                            SAVED,
                    });

                const toggle =
                    document.querySelector(
                        "#toggle",
                    );

                const panel =
                    document.querySelector(
                        "#panel",
                    );

                const before = [
                    ...document.querySelectorAll(
                        ".chat-history__item-title",
                    ),
                ].map(
                    (node) =>
                        node.textContent,
                );

                /*
                 * History starts expanded.
                 */
                assert.equal(
                    panel.hidden,
                    false,
                );

                assert.equal(
                    toggle.getAttribute(
                        "aria-expanded",
                    ),
                    "true",
                );

                /*
                 * First click collapses it.
                 */
                toggle.click();

                assert.equal(
                    panel.hidden,
                    true,
                );

                assert.equal(
                    toggle.getAttribute(
                        "aria-expanded",
                    ),
                    "false",
                );

                /*
                 * Second click expands it again.
                 */
                toggle.click();

                assert.equal(
                    panel.hidden,
                    false,
                );

                assert.equal(
                    toggle.getAttribute(
                        "aria-expanded",
                    ),
                    "true",
                );

                const after = [
                    ...document.querySelectorAll(
                        ".chat-history__item-title",
                    ),
                ].map(
                    (node) =>
                        node.textContent,
                );

                /*
                 * Collapsing the panel must not reorder conversations.
                 */
                assert.deepEqual(
                    after,
                    before,
                );
            },
        );

        it(
            "disables switching while a question is processing",

            async () => {
                const {
                    document,
                    history,
                } =
                    await mount({
                        initial:
                            SAVED,
                    });

                history.setBusy(
                    true,
                );

                assert.equal(
                    document
                        .querySelector(
                            "#toggle",
                        )
                        .disabled,
                    true,
                );

                assert.equal(
                    document
                        .querySelector(
                            "#new-chat",
                        )
                        .disabled,
                    true,
                );

                for (
                    const item
                    of document.querySelectorAll(
                        ".chat-history__item",
                    )
                ) {
                    assert.equal(
                        item.disabled,
                        true,
                    );
                }
            },
        );
    },
);