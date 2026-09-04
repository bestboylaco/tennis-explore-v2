/**
 * Lightweight chat-history prototype for the AI Coach workspace.
 *
 * Conversations live only in browser memory for the lifetime of this page.
 * That is deliberate: this story is about the interaction pattern, while
 * account-scoped persistence, retention and privacy rules belong to a later
 * backend story.
 */

function createId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createConversation(now) {
    const timestamp = now();

    return {
        id: createId(),
        title: "New conversation",
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [],
    };
}

function titleFromQuestion(question) {
    const compact = String(question).replace(/\s+/g, " ").trim();

    if (compact.length <= 42) return compact || "New conversation";

    return `${compact.slice(0, 39).trimEnd()}...`;
}

function formatTime(value) {
    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: "numeric",
            minute: "2-digit",
        }).format(new Date(value));
    } catch {
        return "Earlier";
    }
}

function cloneTurn(turn) {
    return {
        role: turn.role,
        content: turn.content,
        citations: turn.citations ?? [],
        table: turn.table ?? null,
        sql: turn.sql ?? null,
        grounding: turn.grounding ?? null,
    };
}

/**
 * Creates the collapsible conversation-history interaction.
 */
export function createChatHistory({
    toggleButton,
    panel,
    list,
    emptyState,
    countNode,
    newChatButton,
    onSelectConversation,
    now = () => new Date().toISOString(),
}) {
    const doc = panel.ownerDocument;
    const conversations = [createConversation(now)];

    if (emptyState.textContent.trim() === "") {
        emptyState.textContent =
            "No previous conversations yet. Your current session will appear here as you chat.";
    }

    let activeConversationId = conversations[0].id;
    let busy = false;

    function activeConversation() {
        return conversations.find(
            (conversation) => conversation.id === activeConversationId,
        );
    }

    function previousConversationCount() {
        return Math.max(0, conversations.length - 1);
    }

    function render() {
        const previousCount = previousConversationCount();

        countNode.textContent = String(previousCount);
        emptyState.hidden = previousCount > 0;
        list.replaceChildren();

        /*
         * Keep the active conversation first. Previous conversations follow
         * in most-recently-used order so history stays easy to scan.
         */
        const ordered = [...conversations].sort((left, right) => {
            if (left.id === activeConversationId) return -1;
            if (right.id === activeConversationId) return 1;

            return new Date(right.updatedAt) - new Date(left.updatedAt);
        });

        for (const conversation of ordered) {
            const button = doc.createElement("button");
            const title = doc.createElement("span");
            const meta = doc.createElement("span");
            const isActive = conversation.id === activeConversationId;

            button.type = "button";
            button.className = "chat-history__item";
            button.dataset.conversationId = conversation.id;
            button.disabled = busy;

            if (isActive) {
                button.classList.add("chat-history__item--active");
                button.setAttribute("aria-current", "true");
            }

            title.className = "chat-history__item-title";
            title.textContent = conversation.title;

            meta.className = "chat-history__item-meta";
            meta.textContent = isActive
                ? "Current"
                : `Last used ${formatTime(conversation.updatedAt)}`;

            button.append(title, meta);

            button.addEventListener("click", () => {
                if (busy || isActive) return;

                const current = activeConversation();

                /*
                 * An untouched New chat is a workspace state, not useful
                 * history. Drop it when the user returns to an earlier chat.
                 */
                if (current.messages.length === 0) {
                    const emptyIndex = conversations.findIndex(
                        (item) => item.id === current.id,
                    );

                    if (emptyIndex >= 0) conversations.splice(emptyIndex, 1);
                }

                activeConversationId = conversation.id;
                conversation.updatedAt = now();
                render();

                onSelectConversation?.({
                    id: conversation.id,
                    title: conversation.title,
                    messages: conversation.messages.map(cloneTurn),
                });
            });

            list.append(button);
        }
    }

    function setExpanded(expanded) {
        panel.hidden = !expanded;
        toggleButton.setAttribute("aria-expanded", String(expanded));
    }

    toggleButton.addEventListener("click", () => {
        setExpanded(panel.hidden);
    });

    newChatButton.addEventListener("click", () => {
        if (busy) return;

        const current = activeConversation();

        /*
         * Do not create a stack of empty conversations when New chat is
         * clicked repeatedly. The current empty conversation is already ready.
         */
        if (current.messages.length === 0) {
            onSelectConversation?.({
                id: current.id,
                title: current.title,
                messages: [],
            });
            return;
        }

        const conversation = createConversation(now);

        conversations.push(conversation);
        activeConversationId = conversation.id;
        render();
        setExpanded(true);

        onSelectConversation?.({
            id: conversation.id,
            title: conversation.title,
            messages: [],
        });
    });

    function recordTurn(turn) {
        const conversation = activeConversation();
        const recorded = cloneTurn(turn);

        conversation.messages.push(recorded);
        conversation.updatedAt = now();

        if (
            recorded.role === "user" &&
            conversation.messages.filter((message) => message.role === "user").length === 1
        ) {
            conversation.title = titleFromQuestion(recorded.content);
        }

        render();
    }

    function setBusy(nextBusy) {
        busy = Boolean(nextBusy);
        toggleButton.disabled = busy;
        newChatButton.disabled = busy;

        for (const item of list.querySelectorAll("button")) {
            item.disabled = busy;
        }
    }

    render();

    return {
        recordUserMessage(content) {
            recordTurn({ role: "user", content });
        },

        recordAssistantMessage({
            content,
            citations = [],
            table = null,
            sql = null,
            grounding = null,
        }) {
            recordTurn({
                role: "assistant",
                content,
                citations,
                table,
                sql,
                grounding,
            });
        },

        setBusy,

        getActiveConversation() {
            const conversation = activeConversation();

            return {
                id: conversation.id,
                title: conversation.title,
                messages: conversation.messages.map(cloneTurn),
            };
        },
    };
}
