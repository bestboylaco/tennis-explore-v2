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

function cleanRenameValue(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Account-scoped chat history for the AI Coach workspace.
 *
 * The backend owns persistence and derives the account from the authenticated
 * session. Selecting a conversation never changes its timestamp, so merely
 * opening history cannot reshuffle the list. Rename and delete are also
 * account-scoped on the backend; the browser never supplies an owner id.
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
    const view = doc.defaultView ?? window;
    let conversations = [];
    let activeConversationId = null;
    let activeMessages = [];
    let busy = false;
    let selecting = false;
    let openMenu = null;

    function reportError(error) {
        onError?.(error);
    }

    function closeOpenMenu() {
        if (!openMenu) return;

        openMenu.menu.hidden = true;
        openMenu.toggle.setAttribute("aria-expanded", "false");
        openMenu = null;
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

    async function selectConversation(conversation) {
        const isActive = conversation.id === activeConversationId;

        if (busy || selecting || isActive) return;

        selecting = true;
        closeOpenMenu();
        render();

        try {
            const selected = await store.getConversation(conversation.id);

            activeConversationId = selected.id;
            activeMessages = (selected.messages ?? []).map(cloneTurn);

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
    }

    async function renameOne(conversation) {
        if (busy || selecting) return;

        closeOpenMenu();

        const proposed = view.prompt(
            "Rename conversation",
            conversation.title || "Untitled conversation",
        );

        if (proposed === null) return;

        const title = cleanRenameValue(proposed);

        if (!title) {
            reportError(new Error("Conversation name cannot be empty."));
            return;
        }

        selecting = true;
        render();

        try {
            const updated = await store.renameConversation(
                conversation.id,
                title,
            );

            upsertSummary(updated);
            render();
        } catch (error) {
            reportError(error);
        } finally {
            selecting = false;
            render();
        }
    }

    async function deleteOne(conversation) {
        if (busy || selecting) return;

        closeOpenMenu();

        const confirmed = view.confirm(
            `Delete “${conversation.title || "Untitled conversation"}”?\n\n` +
                "This conversation and its messages will be permanently deleted.",
        );

        if (!confirmed) return;

        selecting = true;
        render();

        try {
            await store.deleteConversation(conversation.id);

            conversations = conversations.filter(
                (item) => item.id !== conversation.id,
            );

            if (activeConversationId === conversation.id) {
                activeConversationId = null;
                activeMessages = [];

                onSelectConversation?.({
                    id: null,
                    title: "New conversation",
                    messages: [],
                });
            }
        } catch (error) {
            reportError(error);
        } finally {
            selecting = false;
            render();
        }
    }

    function render() {
        closeOpenMenu();
        countNode.textContent = String(conversations.length);
        emptyState.hidden = conversations.length > 0;
        list.replaceChildren();

        for (const conversation of conversations) {
            const row = doc.createElement("div");
            const button = doc.createElement("button");
            const title = doc.createElement("span");
            const meta = doc.createElement("span");
            const actions = doc.createElement("div");
            const menuToggle = doc.createElement("button");
            const menu = doc.createElement("div");
            const renameButton = doc.createElement("button");
            const deleteButton = doc.createElement("button");
            const isActive = conversation.id === activeConversationId;

            row.className = "chat-history__row";
            row.dataset.conversationId = conversation.id;

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
            button.addEventListener("click", () => selectConversation(conversation));

            actions.className = "chat-history__actions";

            menuToggle.type = "button";
            menuToggle.className = "chat-history__menu-toggle";
            menuToggle.textContent = "⋯";
            menuToggle.title = "Conversation actions";
            menuToggle.setAttribute(
                "aria-label",
                `Actions for ${conversation.title || "Untitled conversation"}`,
            );
            menuToggle.setAttribute("aria-haspopup", "menu");
            menuToggle.setAttribute("aria-expanded", "false");
            menuToggle.disabled = busy || selecting;

            menu.className = "chat-history__menu";
            menu.hidden = true;
            menu.setAttribute("role", "menu");

            renameButton.type = "button";
            renameButton.className = "chat-history__menu-action";
            renameButton.textContent = "Rename";
            renameButton.setAttribute("role", "menuitem");
            renameButton.disabled = busy || selecting;

            deleteButton.type = "button";
            deleteButton.className =
                "chat-history__menu-action chat-history__menu-action--danger";
            deleteButton.textContent = "Delete";
            deleteButton.setAttribute("role", "menuitem");
            deleteButton.disabled = busy || selecting;

            menuToggle.addEventListener("click", (event) => {
                event.stopPropagation();

                const willOpen = menu.hidden;
                closeOpenMenu();

                if (!willOpen) return;

                menu.hidden = false;
                menuToggle.setAttribute("aria-expanded", "true");
                openMenu = { menu, toggle: menuToggle };
            });

            renameButton.addEventListener("click", (event) => {
                event.stopPropagation();
                renameOne(conversation);
            });

            deleteButton.addEventListener("click", (event) => {
                event.stopPropagation();
                deleteOne(conversation);
            });

            menu.append(renameButton, deleteButton);
            actions.append(menuToggle, menu);
            row.append(button, actions);
            list.append(row);
        }
    }

    function setExpanded(expanded) {
        panel.hidden = !expanded;
        toggleButton.setAttribute("aria-expanded", String(expanded));

        if (!expanded) closeOpenMenu();
    }

    toggleButton.addEventListener("click", () => {
        setExpanded(panel.hidden);
    });

    doc.addEventListener("click", (event) => {
        if (!openMenu) return;

        const actionContainer = openMenu.toggle.closest(".chat-history__actions");

        if (!actionContainer?.contains(event.target)) {
            closeOpenMenu();
        }
    });

    doc.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeOpenMenu();
        }
    });

    newChatButton.addEventListener("click", () => {
        if (busy || selecting) return;

        closeOpenMenu();
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

        if (busy) closeOpenMenu();
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
