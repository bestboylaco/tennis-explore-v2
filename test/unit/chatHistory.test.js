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

function mount() {
    const dom = new JSDOM(MARKUP, { url: "http://localhost:3000" });
    const { document } = dom.window;
    const selected = [];
    let tick = 0;

    const now = () => `2026-08-27T10:${String(tick++).padStart(2, "0")}:00.000Z`;

    const history = createChatHistory({
        toggleButton: document.querySelector("#toggle"),
        panel: document.querySelector("#panel"),
        list: document.querySelector("#list"),
        emptyState: document.querySelector("#empty"),
        countNode: document.querySelector("#count"),
        newChatButton: document.querySelector("#new-chat"),
        onSelectConversation: (conversation) => selected.push(conversation),
        now,
    });

    return { document, history, selected };
}

describe(
    "chat history prototype",
    { skip: JSDOM ? false : "jsdom is not installed -- run npm install" },
    () => {
        it("starts collapsed with a defined empty state", () => {
            const { document } = mount();

            assert.equal(document.querySelector("#panel").hidden, true);
            assert.equal(document.querySelector("#count").textContent, "0");
            assert.equal(document.querySelector("#empty").hidden, false);
            assert.match(document.querySelector("#empty").textContent, /No previous conversations/i);
        });

        it("can collapse and expand without changing the chat workspace", () => {
            const { document } = mount();
            const toggle = document.querySelector("#toggle");
            const panel = document.querySelector("#panel");

            toggle.click();
            assert.equal(panel.hidden, false);
            assert.equal(toggle.getAttribute("aria-expanded"), "true");

            toggle.click();
            assert.equal(panel.hidden, true);
            assert.equal(toggle.getAttribute("aria-expanded"), "false");
        });

        it("turns the first question into a recognisable conversation title", () => {
            const { document, history } = mount();

            history.recordUserMessage("How should I adjust the next training session?");

            const active = document.querySelector(".chat-history__item--active");

            assert.ok(active);
            assert.match(active.textContent, /How should I adjust the next training/);
            assert.match(active.textContent, /Current/);
        });

        it("creates a new active conversation and keeps the previous one selectable", () => {
            const { document, history } = mount();

            history.recordUserMessage("Review the latest match performance");
            history.recordAssistantMessage({ content: "First answer" });
            document.querySelector("#new-chat").click();

            assert.equal(document.querySelector("#count").textContent, "1");
            assert.equal(document.querySelector("#empty").hidden, true);

            const items = [...document.querySelectorAll(".chat-history__item")];

            assert.equal(items.length, 2);
            assert.match(items[0].textContent, /New conversation/);
            assert.ok(items[0].classList.contains("chat-history__item--active"));
            assert.match(items[1].textContent, /Review the latest match performance/);
        });

        it("selects a previous conversation without navigation", () => {
            const { document, history, selected } = mount();

            history.recordUserMessage("Review my first match");
            history.recordAssistantMessage({
                content: "Stored answer",
                citations: [{ title: "Source A" }],
            });
            document.querySelector("#new-chat").click();

            const previous = [...document.querySelectorAll(".chat-history__item")]
                .find((item) => item.textContent.includes("Review my first match"));

            previous.click();

            const lastSelection = selected.at(-1);

            assert.equal(lastSelection.messages.length, 2);
            assert.equal(lastSelection.messages[1].content, "Stored answer");
            assert.equal(lastSelection.messages[1].citations[0].title, "Source A");

            const active = document.querySelector(".chat-history__item--active");
            assert.match(active.textContent, /Review my first match/);
            assert.equal(document.querySelector("#count").textContent, "0");
            assert.equal(document.querySelectorAll(".chat-history__item").length, 1);
        });

        it("disables history switching while a question is processing", () => {
            const { document, history } = mount();

            history.setBusy(true);

            assert.equal(document.querySelector("#toggle").disabled, true);
            assert.equal(document.querySelector("#new-chat").disabled, true);
            assert.equal(document.querySelector(".chat-history__item").disabled, true);
        });
    },
);
