/**
 * Presentational primitives shared by the telemetry views.
 *
 * Everything is built with createElement and textContent. No innerHTML is used
 * anywhere on this page, so a value that arrived from the database cannot be
 * interpreted as markup.
 */

export function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined && text !== null) {
        element.textContent = String(text);
    }

    return element;
}

export function clear(container) {
    container.replaceChildren();
}

/**
 * A titled block with an optional explanatory note.
 *
 * The note is where a section states what its numbers do and do not include,
 * which several of these aggregations need in order to be read correctly.
 */
export function createSection({ title, note, controls }) {
    const section = createElement("section", "telemetry-section");

    const header = createElement(
        "div",
        "telemetry-section__header",
    );

    const titleGroup = createElement("div");

    titleGroup.append(
        createElement("h2", "telemetry-section__title", title),
    );

    if (note) {
        titleGroup.append(
            createElement("p", "telemetry-section__note", note),
        );
    }

    header.append(titleGroup);

    if (controls) {
        header.append(controls);
    }

    const body = createElement("div");

    section.append(header, body);

    return { section, body };
}

/**
 * A caveat about the numbers below. Not an error: this marks a limit of the
 * data, such as a cluster with no $percentile support or an aggregation that
 * does not apply to the current filter.
 */
export function createNotice(text, variant) {
    const className = variant
        ? `telemetry-notice telemetry-notice--${variant}`
        : "telemetry-notice";

    return createElement("p", className, text);
}

/**
 * An empty result together with the action that would produce data.
 *
 * `commandText` is rendered as code where one is given, so the reader is not
 * left deciding whether an empty table means broken or unused.
 */
export function createEmpty(message, commandText) {
    const element = createElement(
        "p",
        "telemetry-empty",
        message,
    );

    if (commandText) {
        element.append(
            " ",
            createElement("code", null, commandText),
        );
    }

    return element;
}

const KNOWN_STATUSES = new Set([
    "success",
    "failed",
    "partial",
    "running",
]);

export function createPill(status) {
    const label = status ?? "unknown";

    const className = KNOWN_STATUSES.has(label)
        ? `pill pill--${label}`
        : "pill";

    return createElement("span", className, label);
}

/**
 * A horizontal bar sized against a reference maximum.
 *
 * Bars are relative to the largest value in their own table, so the comparison
 * they support is "which row dominates this table", never an absolute one
 * against some other section.
 */
export function createBar({
    value,
    max,
    label,
    variant,
}) {
    const bar = createElement("div", "bar");

    const track = createElement("div", "bar__track");

    const fillClassName = variant
        ? `bar__fill bar__fill--${variant}`
        : "bar__fill";

    const fill = createElement("div", fillClassName);

    const isDrawable =
        Number.isFinite(value) &&
        Number.isFinite(max) &&
        max > 0 &&
        value > 0;

    fill.style.width = isDrawable
        ? `${Math.min(100, (value / max) * 100)}%`
        : "0";

    track.append(fill);

    bar.append(
        track,
        createElement("span", "bar__value", label),
    );

    return bar;
}

/**
 * Builds a table from a column definition.
 *
 * Each column supplies either `render(row)` for a node or `value(row)` for
 * text. `numeric` right-aligns the column, `emphasis` marks the identifying
 * one, and `bar` reserves the fixed width a bar needs. `bar` is declared
 * rather than inferred from `render`, because a status pill is also a rendered
 * node and must not be given a bar column's width.
 */
export function createTable({ columns, rows }) {
    const scroller = createElement("div", "table-scroll");
    const table = createElement("table", "data-table");

    const head = createElement("thead");
    const headRow = createElement("tr");

    for (const column of columns) {
        const cell = createElement(
            "th",
            column.numeric ? "data-table__number" : null,
            column.label,
        );

        cell.scope = "col";
        headRow.append(cell);
    }

    head.append(headRow);

    const body = createElement("tbody");

    for (const row of rows) {
        const bodyRow = createElement("tr");

        for (const column of columns) {
            const classNames = [
                column.numeric ? "data-table__number" : null,
                column.emphasis ? "data-table__key" : null,
                column.bar ? "data-table__bar-cell" : null,
            ].filter(Boolean);

            const cell = createElement(
                "td",
                classNames.join(" ") || null,
            );

            if (column.render) {
                cell.append(column.render(row));
            } else {
                cell.textContent = column.value(row);
            }

            bodyRow.append(cell);
        }

        body.append(bodyRow);
    }

    table.append(head, body);
    scroller.append(table);

    return { scroller, table, body };
}

/**
 * A row of labelled totals.
 */
export function createStatGrid(items) {
    const grid = createElement("div", "stat-grid");

    for (const item of items) {
        const card = createElement("div", "stat-card");

        card.append(
            createElement(
                "div",
                "stat-card__label",
                item.label,
            ),
            createElement(
                "div",
                "stat-card__value",
                item.value,
            ),
        );

        grid.append(card);
    }

    return grid;
}

/**
 * Key/value rows, for the single-record blocks that are not tabular.
 */
export function createFieldList(entries) {
    const list = createElement("div", "record-fields");

    for (const [key, value] of entries) {
        list.append(
            createElement("div", "record-fields__key", key),
        );

        const valueElement = createElement(
            "div",
            "record-fields__value",
        );

        if (value instanceof Node) {
            valueElement.append(value);
        } else {
            valueElement.textContent = String(value);
        }

        list.append(valueElement);
    }

    return list;
}

/**
 * Returns the largest finite value produced by `select` across `rows`.
 *
 * Used to scale a bar column against its own table.
 */
export function maxOf(rows, select) {
    return rows.reduce((largest, row) => {
        const value = Number(select(row));

        return Number.isFinite(value) && value > largest
            ? value
            : largest;
    }, 0);
}
