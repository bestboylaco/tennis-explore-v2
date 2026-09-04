import * as conversationApi from "../api/conversationApi.js";

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

function toTimestamp(value) {
    const timestamp = new Date(value).getTime();

    return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortByLatestMessage(conversations) {
    return [...conversations].sort((left, right) => {
        const messageDifference =
            toTimestamp(right.lastMessageAt) - toTimestamp(left.lastMessageAt);

        if (messageDifference !== 0) return messageDifference;

        return toTimestamp(right.createdAt) - toTimestamp(left.createdAt);
    });
}

function formatHistoryTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Earlier";

    const now = new Date();
    const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();

    return new Intl.DateTimeFormat(undefined, {
        ...(sameDay
            ? {}
            : {
                  day: "numeric",
                  month: "short",
              }),
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function messageMeta(conversation, isActive) {
    const count = Number(conversation.messageCount ?? 0);
    const messageText = `${count} ${count === 1 ? "message" : "messages"}`;
    const timeText = formatHistoryTime(
        conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt,
    );

    return isActive
        ? `Current · ${messageText} · ${timeText}`
        : `${messageText} · ${timeText}`;
}

/**
 * Account-scoped chat history for the AI Coach workspace.
 *
 * The backend owns persistence and derives the account from the authenticated
 * session. Selecting a conversation never changes its timestamp, so merely
 * opening history cannot reshuffle the list. A conversation moves only when a
 * new message is actually added to it.
 */
export async function createChatHistory({
    toggleButton,
    panel,
    list,
    emptyState,
    countNode,
    newChatButton,
    onSelectConversation,
    onError,
    store = conversationApi,
}) {
    const doc = panel.ownerDocument;
    let conversations = [];
    let activeConversationId = null;
    let activeMessages = [];
    let busy = false;
    let selecting = false;

    function reportError(error) {
        onError?.(error);
    }

    try {
        conversations = sortByLatestMessage(await store.listConversations());
    } catch (error) {
        reportError(error);
    }

    if (emptyState.textContent.trim() === "") {
        emptyState.textContent =
            "No saved conversations yet. Your first question will create one for this account.";
    }

    function activeConversation() {
        return conversations.find(
            (conversation) => conversation.id === activeConversationId,
        );
    }

    function upsertSummary(summary) {
        const index = conversations.findIndex(
            (conversation) => conversation.id === summary.id,
        );

        if (index >= 0) {
            conversations[index] = {
                ...conversations[index],
                ...summary,
            };
        } else {
            conversations.push(summary);
        }

        conversations = sortByLatestMessage(conversations);
    }

    function render() {
        countNode.textContent = String(conversations.length);
        emptyState.hidden = conversations.length > 0;
        list.replaceChildren();

        // Do not move the active conversation to the top. The server order is
        // based on actual message activity, which makes the list predictable.
        for (const conversation of conversations) {
            const button = doc.createElement("button");
            const title = doc.createElement("span");
            const meta = doc.createElement("span");
            const isActive = conversation.id === activeConversationId;

            button.type = "button";
            button.className = "chat-history__item";
            button.dataset.conversationId = conversation.id;
            button.disabled = busy || selecting;

            if (isActive) {
                button.classList.add("chat-history__item--active");
                button.setAttribute("aria-current", "true");
            }

            title.className = "chat-history__item-title";
            title.textContent = conversation.title || "Untitled conversation";

            meta.className = "chat-history__item-meta";
            meta.textContent = messageMeta(conversation, isActive);

            button.append(title, meta);

            button.addEventListener("click", async () => {
                if (busy || selecting || isActive) return;

                selecting = true;
                render();

                try {
                    const selected = await store.getConversation(conversation.id);

                    activeConversationId = selected.id;
                    activeMessages = (selected.messages ?? []).map(cloneTurn);

                    // Reading a conversation does not alter updatedAt or
                    // lastMessageAt, so its position remains unchanged.
                    render();

                    onSelectConversation?.({
                        id: selected.id,
                        title: selected.title,
                        messages: activeMessages.map(cloneTurn),
                    });
                } catch (error) {
                    reportError(error);
                } finally {
                    selecting = false;
                    render();
                }
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
        if (busy || selecting) return;

        // An empty chat is only a workspace state. It is not written to the
        // database until the first user message, avoiding empty history rows.
        activeConversationId = null;
        activeMessages = [];
        render();

        onSelectConversation?.({
            id: null,
            title: "New conversation",
            messages: [],
        });
    });

    async function recordUserMessage(content) {
        const message = {
            role: "user",
            content,
        };

        activeMessages.push(cloneTurn(message));

        try {
            if (!activeConversationId) {
                const created = await store.createConversation(message);

                activeConversationId = created.id;
                activeMessages = (created.messages ?? activeMessages).map(cloneTurn);
                upsertSummary(created);
            } else {
                const summary = await store.appendConversationMessage(
                    activeConversationId,
                    message,
                );

                upsertSummary(summary);
            }

            render();
            return true;
        } catch (error) {
            reportError(error);
            return false;
        }
    }

    async function recordAssistantMessage({
        content,
        citations = [],
        table = null,
        sql = null,
        grounding = null,
    }) {
        const message = {
            role: "assistant",
            content,
            citations,
            table,
            sql,
            grounding,
        };

        activeMessages.push(cloneTurn(message));

        if (!activeConversationId) {
            return false;
        }

        try {
            const summary = await store.appendConversationMessage(
                activeConversationId,
                message,
            );

            upsertSummary(summary);
            render();
            return true;
        } catch (error) {
            reportError(error);
            return false;
        }
    }

    function setBusy(nextBusy) {
        busy = Boolean(nextBusy);
        toggleButton.disabled = busy;
        newChatButton.disabled = busy;

        for (const item of list.querySelectorAll("button")) {
            item.disabled = busy || selecting;
        }
    }

    render();
    setExpanded(true);

    return {
        recordUserMessage,
        recordAssistantMessage,
        setBusy,

        getActiveConversation() {
            const conversation = activeConversation();

            return {
                id: activeConversationId,
                title: conversation?.title ?? "New conversation",
                messages: activeMessages.map(cloneTurn),
            };
        },
    };
}
