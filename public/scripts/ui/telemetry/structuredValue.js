import { createElement } from "./elements.js";

/*
 * Recursive JSON renderer for the collapsed "Complete record" block.
 *
 * This used to be imported from ../messageRenderer.js, which the chat page also
 * used for its answer bodies. That renderer was rewritten when the chat UI was
 * reskinned and renderValue stopped being exported, which broke this page
 * outright: a missing named export fails at module-link time, so telemetry.js
 * never ran at all. The dashboard owns its copy now, because a debugging
 * surface should not go dark the next time the chat screen is redesigned.
 */

/**
 * Converts backend field names into readable labels.
 *
 * Examples:
 * receivedQuestion     -> Received Question
 * coaching_suggestions -> Coaching suggestions
 *
 * Only the first character is capitalised. camelCase splits into separate
 * capitalised words because the capitals are already there, while snake_case
 * does not, so the two spellings of the same name do not land on the same
 * label. Record keys are overwhelmingly camelCase, so this is left as it has
 * always behaved rather than changed under the dashboard.
 */
function humaniseKey(key) {
    return String(key)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/^./, (character) =>
            character.toUpperCase(),
        );
}

function renderPrimitive(value) {
    if (value === null || value === undefined) {
        return createElement(
            "div",
            "structured-value",
            "No value returned.",
        );
    }

    return createElement(
        "div",
        "structured-value",
        String(value),
    );
}

function renderArray(values) {
    if (values.length === 0) {
        return createElement(
            "span",
            "structured-value--empty",
            "No items returned.",
        );
    }

    const list = createElement("ul", "structured-list");

    for (const value of values) {
        const listItem = createElement("li");

        listItem.append(renderValue(value));
        list.append(listItem);
    }

    return list;
}

function renderObject(value) {
    const entries = Object.entries(value);

    if (entries.length === 0) {
        return createElement(
            "span",
            "structured-value--empty",
            "No details returned.",
        );
    }

    const container = createElement("div", "structured-object");

    for (const [key, childValue] of entries) {
        const field = createElement("section", "structured-field");

        const fieldValue = createElement(
            "div",
            "structured-field__value",
        );

        fieldValue.append(renderValue(childValue));

        field.append(
            createElement(
                "div",
                "structured-field__key",
                humaniseKey(key),
            ),
            fieldValue,
        );

        container.append(field);
    }

    return container;
}

/**
 * Recursively renders strings, numbers, booleans, arrays and objects.
 *
 * The renderer does not require a fixed record shape. It displays the structure
 * the telemetry API returned, which is the point of the raw block: a field
 * added to a record backend-side shows up here without a frontend change.
 */
export function renderValue(value) {
    if (Array.isArray(value)) {
        return renderArray(value);
    }

    if (value !== null && typeof value === "object") {
        return renderObject(value);
    }

    return renderPrimitive(value);
}
