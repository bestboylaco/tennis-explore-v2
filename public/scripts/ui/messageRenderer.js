/**
 * Renders messages into the conversation.
 *
 * Deliberately plain: no avatars, no assistant name, no persona. This is a
 * search tool over Tennis Australia's data, and dressing it as a character
 * invites people to read its output as opinion rather than as something traced
 * to a document.
 *
 * An assistant turn can carry four things, and only the answer is always there:
 *
 *   answer     prose, with [n] citation markers
 *   table      a computed result, when the question was answered from records
 *   sql        the query that produced that table, shown so it can be audited
 *   citations  buttons that open the source beside the conversation
 */

function element(doc, tag, className, text) {
    const node = doc.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

/**
 * Renders the answer text.
 *
 * Plain text, not HTML. The model's output is untrusted -- it is shaped by
 * retrieved documents, which come from partner files -- so it is inserted as
 * text and never parsed as markup. Paragraph breaks are the only structure we
 * reconstruct.
 */
function renderAnswer(doc, text) {
    const wrapper = element(doc, "div", "message__bubble");

    for (const paragraph of String(text).split(/\n{2,}/)) {
        if (paragraph.trim() === "") continue;

        wrapper.append(element(doc, "p", null, paragraph.trim()));
    }

    if (wrapper.children.length === 0) {
        wrapper.append(element(doc, "p", null, String(text)));
    }

    return wrapper;
}

/**
 * Renders a computed result as a real table.
 *
 * The backend also supplies a markdown version, but building the DOM directly
 * avoids shipping a markdown parser to render something we already have as
 * structured rows.
 */
function renderTable(doc, table) {
    if (!table || !Array.isArray(table.columns) || table.columns.length === 0) {
        return null;
    }

    const node = element(doc, "table", "answer-table");
    const head = element(doc, "thead");
    const headRow = element(doc, "tr");

    for (const column of table.columns) {
        headRow.append(element(doc, "th", null, column));
    }

    head.append(headRow);

    const body = element(doc, "tbody");

    for (const row of table.rows ?? []) {
        const tr = element(doc, "tr");

        for (const column of table.columns) {
            const value = row[column];

            // long decimals from an average are noise; two places is enough to
            // compare and few enough to read.
            const shown =
                value === null || value === undefined
                    ? "—"
                    : typeof value === "number" && !Number.isInteger(value)
                      ? value.toFixed(2)
                      : String(value);

            tr.append(element(doc, "td", null, shown));
        }

        body.append(tr);
    }

    node.append(head, body);

    return node;
}

function citationLabel(citation, index) {
    if (typeof citation === "string") return citation;

    const number = citation?.number ?? index + 1;
    const title = citation?.link?.label ?? citation?.title ?? "Source";

    return `${number}. ${title}`;
}

function renderCitations(doc, citations, openCitation) {
    const section = element(doc, "section", "citation-list");

    section.append(element(doc, "p", "citation-list__heading", "Sources"));

    const buttons = element(doc, "div", "citation-list__buttons");

    citations.forEach((citation, index) => {
        const button = element(doc, "button", "citation-button", citationLabel(citation, index));

        button.type = "button";
        button.addEventListener("click", () => openCitation(citation, button));

        buttons.append(button);
    });

    section.append(buttons);

    return section;
}

/**
 * Surfaces the grounding checks rather than hiding them.
 *
 * An answer with a flagged figure is still useful if the reader knows which
 * figure to check. An answer that quietly cited nothing is not.
 */
function renderWarnings(doc, grounding) {
    if (!grounding) return null;

    const messages = [];

    if (grounding.danglingCitations?.length > 0) {
        messages.push(
            `Cited [${grounding.danglingCitations.join("], [")}], which was not among the sources.`,
        );
    }

    if (grounding.unsupportedNumbers?.length > 0) {
        messages.push(`These figures appear in no source: ${grounding.unsupportedNumbers.join(", ")}.`);
    }

    if (messages.length === 0) return null;

    const note = element(doc, "p", "composer-status");

    note.textContent = messages.join(" ");

    return note;
}

export function appendUserMessage({ conversation, content }) {
    const doc = conversation.ownerDocument;
    const row = element(doc, "div", "message message--user");

    row.append(element(doc, "div", "message__bubble", content));
    conversation.append(row);
    conversation.scrollTop = conversation.scrollHeight;

    return row;
}

export function appendAssistantMessage({
    conversation,
    content,
    citations = [],
    table = null,
    sql = null,
    grounding = null,
    openCitation,
}) {
    const doc = conversation.ownerDocument;
    const row = element(doc, "div", "message message--assistant");

    row.append(renderAnswer(doc, content));

    const tableNode = renderTable(doc, table);

    if (tableNode) row.append(tableNode);

    if (sql) {
        row.append(element(doc, "pre", "answer-sql", sql));
    }

    if (Array.isArray(citations) && citations.length > 0 && openCitation) {
        row.append(renderCitations(doc, citations, openCitation));
    }

    const warnings = renderWarnings(doc, grounding);

    if (warnings) row.append(warnings);

    conversation.append(row);
    conversation.scrollTop = conversation.scrollHeight;

    return row;
}
