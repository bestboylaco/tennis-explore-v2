/**
 * Converts backend field names into readable labels.
 *
 * Examples:
 * receivedQuestion -> Received Question
 * coaching_suggestions -> Coaching Suggestions
 */
function humaniseKey(key) {
    return String(key)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/^./, (character) =>
            character.toUpperCase(),
        );
}

function createEmptyValue(message) {
    const element = document.createElement("span");

    element.className = "structured-value--empty";
    element.textContent = message;

    return element;
}

function renderPrimitive(value) {
    const element = document.createElement("div");

    element.className = "structured-value";

    if (value === null || value === undefined) {
        element.textContent = "No value returned.";
    } else {
        element.textContent = String(value);
    }

    return element;
}

function renderArray(values) {
    if (values.length === 0) {
        return createEmptyValue("No items returned.");
    }

    const list = document.createElement("ul");

    list.className = "structured-list";

    for (const value of values) {
        const listItem = document.createElement("li");

        listItem.append(renderValue(value));
        list.append(listItem);
    }

    return list;
}

function renderObject(value) {
    const entries = Object.entries(value);

    if (entries.length === 0) {
        return createEmptyValue("No details returned.");
    }

    const container = document.createElement("div");

    container.className = "structured-object";

    for (const [key, childValue] of entries) {
        const field = document.createElement("section");

        field.className = "structured-field";

        const fieldName = document.createElement("div");

        fieldName.className = "structured-field__key";
        fieldName.textContent = humaniseKey(key);

        const fieldValue = document.createElement("div");

        fieldValue.className = "structured-field__value";
        fieldValue.append(renderValue(childValue));

        field.append(fieldName, fieldValue);
        container.append(field);
    }

    return container;
}

/**
 * Recursively renders strings, numbers, booleans, arrays and objects.
 *
 * The renderer does not require a fixed answer template. It displays
 * the structure returned by the backend.
 */
export function renderValue(value) {
    if (Array.isArray(value)) {
        return renderArray(value);
    }

    if (
        value !== null &&
        typeof value === "object"
    ) {
        return renderObject(value);
    }

    return renderPrimitive(value);
}

function scrollToLatestMessage(conversation) {
    conversation.scrollTop = conversation.scrollHeight;
}

export function appendUserMessage({
    conversation,
    question,
}) {
    const row = document.createElement("div");

    row.className =
        "message-row message-row--user";

    const message = document.createElement("article");

    message.className = "message message--user";

    const label = document.createElement("div");

    label.className = "message__label";
    label.textContent = "You";

    const body = document.createElement("div");

    body.className = "message__body";
    body.textContent = question;

    message.append(label, body);
    row.append(message);
    conversation.append(row);

    scrollToLatestMessage(conversation);
}

function getCitationTitle(citation, index) {
    if (typeof citation === "string") {
        return citation;
    }

    return (
        citation?.title ??
        citation?.name ??
        citation?.id ??
        `Citation ${index + 1}`
    );
}

function createCitationList({
    citations,
    openCitation,
}) {
    const section = document.createElement("section");

    section.className = "citation-list";

    const heading = document.createElement("div");

    heading.className = "citation-list__heading";
    heading.textContent = "Citations";

    const buttons = document.createElement("div");

    buttons.className = "citation-list__buttons";

    citations.forEach((citation, index) => {
        const button = document.createElement("button");

        button.className = "citation-button";
        button.type = "button";

        button.textContent =
            `${index + 1}. ${getCitationTitle(citation, index)}`;

        button.addEventListener("click", () => {
            openCitation(citation);
        });

        buttons.append(button);
    });

    section.append(heading, buttons);

    return section;
}

export function appendAssistantMessage({
    conversation,
    content,
    citations = [],
    openCitation,
}) {
    const row = document.createElement("div");

    row.className =
        "message-row message-row--assistant";

    const avatar = document.createElement("div");

    avatar.className = "assistant-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "AI";

    const message = document.createElement("article");

    message.className =
        "message message--assistant";

    const label = document.createElement("div");

    label.className = "message__label";
    label.textContent = "AI Coach";

    const body = document.createElement("div");

    body.className = "message__body";
    body.append(renderValue(content));

    message.append(label, body);

    if (Array.isArray(citations) && citations.length > 0) {
        message.append(
            createCitationList({
                citations,
                openCitation,
            }),
        );
    }

    row.append(avatar, message);
    conversation.append(row);

    scrollToLatestMessage(conversation);
}