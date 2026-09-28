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
 *   citations  buttons that open the source beside the conversation, which is
 *              also where the SQL behind a table answer is shown -- putting it
 *              here too just duplicated the same block under every table.
 */

function element(doc, tag, className, text) {
    const node = doc.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

/**
 * Appends `**bold**` runs as real <strong> elements, everything else as
 * plain text nodes.
 *
 * Still never treats the model's output as markup: split() on a capturing
 * regex can only ever produce strings, which go into textContent or a
 * createTextNode, never into innerHTML. A model that writes literal "<" or
 * a stray "**" with no closing pair renders as inert text either way -- this
 * adds exactly one piece of structure (bold) on top of that, not a markdown
 * parser.
 */
function appendInlineFormatting(doc, parent, text) {
    const parts = String(text).split(/\*\*(.+?)\*\*/g);

    parts.forEach((part, index) => {
        if (part === "") return;

        if (index % 2 === 1) {
            const strong = doc.createElement("strong");

            strong.textContent = part;
            parent.append(strong);
        } else {
            parent.append(doc.createTextNode(part));
        }
    });
}

/**
 * Appends one block's worth of lines to `wrapper` as headings, list items,
 * or plain paragraphs -- whichever each line actually is. Consecutive
 * bullet/numbered lines are grouped into one <ul>/<ol> rather than one list
 * element per line.
 *
 * `orderedState.count` persists ACROSS blocks (renderAnswer creates one and
 * passes it to every call), not just within one -- the model frequently uses
 * "1." as a section-header style, one per otherwise-separate block ("1.
 * First Serve Speed" ... blank line ... bullets ... blank line ... "1.
 * Physical Movement Patterns", never incrementing its own numbering). Left
 * to a plain per-block counter, every one of those becomes a fresh <ol>
 * starting over at 1, so five sections in a row all render as "1." (observed
 * live, 2026-09-18). Continuing the count across blocks via each new <ol>'s
 * `start` attribute is what makes them read 1, 2, 3, 4, 5 regardless of what
 * number the model itself wrote on each one.
 *
 * Same rule as appendInlineFormatting: every string here goes into
 * textContent, an attribute, or createTextNode. Nothing is ever parsed as
 * HTML, so a model that writes a stray "#" or "-" with no real structure
 * around it just renders as the literal character it is.
 */
function appendBlock(doc, wrapper, block, orderedState) {
    let currentList = null;
    let currentListTag = null;

    for (const rawLine of block.split("\n")) {
        const line = rawLine.trim();

        if (line === "") continue;

        const heading = line.match(/^(#{1,6})\s+(.*)$/);

        if (heading) {
            currentList = null;
            currentListTag = null;
            // capped at h6 by the regex itself; offset by one so a lone "#"
            // (rare -- the model mostly writes "##"/"###") does not render
            // as large as the message's own surrounding heading level.
            const level = Math.min(heading[1].length + 1, 6);
            const node = doc.createElement(`h${level}`);

            appendInlineFormatting(doc, node, heading[2]);
            wrapper.append(node);
            continue;
        }

        const bullet = line.match(/^[-*]\s+(.*)$/);
        const ordered = line.match(/^\d+[.)]\s+(.*)$/);
        const listMatch = bullet ?? ordered;
        const listTag = bullet ? "ul" : "ol";

        if (listMatch) {
            if (currentListTag !== listTag) {
                currentList = doc.createElement(listTag);

                if (listTag === "ol") currentList.start = orderedState.count + 1;

                wrapper.append(currentList);
                currentListTag = listTag;
            }

            const li = doc.createElement("li");

            appendInlineFormatting(doc, li, listMatch[1]);
            currentList.append(li);

            if (listTag === "ol") orderedState.count += 1;

            continue;
        }

        currentList = null;
        currentListTag = null;

        const p = element(doc, "p");

        appendInlineFormatting(doc, p, line);
        wrapper.append(p);
    }
}

/**
 * Renders the answer text.
 *
 * The model's output is untrusted -- it is shaped by retrieved documents,
 * which come from partner files -- so structure is reconstructed by hand
 * (headings, lists, **bold**) rather than by parsing it as markup. No HTML
 * from the model is ever inserted; see appendInlineFormatting/appendBlock
 * above.
 */
function renderAnswer(doc, text) {
    const wrapper = element(doc, "div", "message__bubble");
    const orderedState = { count: 0 };

    for (const block of String(text).split(/\n{2,}/)) {
        if (block.trim() === "") continue;

        appendBlock(doc, wrapper, block, orderedState);
    }

    if (wrapper.children.length === 0) {
        appendBlock(doc, wrapper, String(text), orderedState);
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

/**
 * Collapses citations down to one entry per underlying document.
 *
 * `citations` has one entry per [n] marker in the answer, so a single paper
 * cited twice at two different pages shows up as two separate entries --
 * the Sources button then reads "Sources 5" for an answer that actually
 * draws on two real documents, and the popover lists the same paper twice
 * under two different numbers, which is not what "sources" means to a
 * reader (reported directly, 2026-09-18: "should just be unique").
 *
 * Grouped by docId, falling back to the title when a citation carries no
 * docId, so this degrades to "one button per citation" rather than
 * throwing when older-shaped data is missing the field. The first citation
 * in each group is kept as-is -- it still opens the source panel at the
 * page it was actually cited at.
 */
function dedupeCitations(citations) {
    const seen = new Map();

    for (const citation of citations) {
        const key = citation?.docId ?? citation?.title ?? citation;

        if (!seen.has(key)) seen.set(key, citation);
    }

    return [...seen.values()];
}

function citationLabel(citation, index, references = []) {
    if (typeof citation === "string") return citation;

    const number = citation?.number ?? index + 1;

    // the backend's APA-style reference line for this exact citation number,
    // e.g. "[3] Thomas Perri. (2022). Serve Kinematics Study. [research_paper]"
    // -- matched by number, not by array position, since `citations` is
    // ordered by where its markers first appeared in the answer while
    // `references` is always sorted by citation number. the leading "[n]"
    // is stripped for display: the internal citation number is what [n]
    // markers and the reference list key off, but it is not a meaningful
    // ordering to show a reader here -- sources are already listed in the
    // order they were actually used, not by that number.
    const reference = references.find((line) => line.startsWith(`[${number}]`));

    if (reference) return reference.replace(/^\[\d+\]\s*/, "");

    return citation?.link?.label ?? citation?.title ?? "Source";
}

function renderCitations(doc, citations, openCitation, references = []) {
    const uniqueCitations = dedupeCitations(citations);

    const section = element(
        doc,
        "section",
        "citation-list",
    );

    /*
     * Only the Sources button is visible initially.
     * The individual citations are shown in a floating popover.
     */
    const toggleButton = element(
        doc,
        "button",
        "citation-list__toggle",
        `Sources ${uniqueCitations.length}`,
    );

    toggleButton.type = "button";
    toggleButton.setAttribute("aria-expanded", "false");

    const popover = element(
        doc,
        "div",
        "citation-popover",
    );

    popover.hidden = true;

    const popoverHeading = element(
        doc,
        "p",
        "citation-popover__heading",
        "Sources",
    );

    const buttons = element(
        doc,
        "div",
        "citation-list__buttons",
    );

    uniqueCitations.forEach((citation, index) => {
        /*
         * Keep using the existing citationLabel() function.
         * This means the citation text and numbering behaviour do not change.
         */
        const button = element(
            doc,
            "button",
            "citation-button",
            citationLabel(citation, index, references),
        );

        button.type = "button";

        button.addEventListener("click", () => {
            // Close the small source list before opening the source panel.
            popover.hidden = true;

            toggleButton.setAttribute(
                "aria-expanded",
                "false",
            );

            openCitation(citation, button);
        });

        buttons.append(button);
    });

    popover.append(
        popoverHeading,
        buttons,
    );

    toggleButton.addEventListener("click", () => {
        const isOpen = !popover.hidden;

        popover.hidden = isOpen;

        toggleButton.setAttribute(
            "aria-expanded",
            String(!isOpen),
        );
    });

    section.append(
        toggleButton,
        popover,
    );

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

    // the comment above this function has always said this ("an answer that
    // quietly cited nothing is not [useful]"), but nothing actually checked
    // for it -- danglingCitations, unsupportedNumbers and
    // numberCitationMismatches all require at least one [n] marker to exist
    // in the first place, so an answer using "document 6" prose instead of
    // real citations sailed through with no warning shown at all (observed
    // live, 2026-09-17).
    //
    // the message shown is whatever the backend actually determined
    // (verifier.service.js), not a fixed string here -- it reads differently
    // depending on whether the answer named a real author/year in prose
    // (a materially smaller problem) or cited nothing recognisable at all.
    const ungrounded = grounding.warnings?.find((warning) => warning.kind === "ungrounded");

    if (ungrounded) {
        messages.push(
            ungrounded.severity === "high"
                ? "The model did not cite any source for this answer -- treat every figure in it as unverified."
                : `Sources are named in this answer but not as clickable citations (${ungrounded.detail}).`,
        );
    }

    const weakAttribution = grounding.warnings?.find((warning) => warning.kind === "weak_attribution");

    if (weakAttribution) {
        messages.push(`Most of this answer is uncited (${weakAttribution.detail}).`);
    }

    if (grounding.danglingCitations?.length > 0) {
        messages.push(
            `Cited [${grounding.danglingCitations.join("], [")}], which was not among the sources.`,
        );
    }

    if (grounding.unsupportedNumbers?.length > 0) {
        messages.push(`These figures appear in no source at all: ${grounding.unsupportedNumbers.join(", ")}.`);
    }

    if (grounding.numberCitationMismatches?.length > 0) {
        const figures = [
            ...new Set(
                grounding.numberCitationMismatches.flatMap(
                    (mismatch) => mismatch.missing,
                ),
            ),
        ];

        messages.push(
            `These figures are not in the source cited for them, though they may be from a different one shown below: ${figures.join(", ")}.`,
        );
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


function renderResponseSections(
    doc,
    sections,
) {
    if (
        !Array.isArray(sections) ||
        sections.length === 0
    ) {
        return null;
    }

    const wrapper =
        element(
            doc,
            "div",
            "message__bubble intelligence-response",
        );

    for (const section of sections) {
        if (
            !section ||
            typeof section.title !== "string" ||
            typeof section.content !== "string"
        ) {
            continue;
        }

        const sectionNode =
            element(
                doc,
                "section",
                "intelligence-response__section",
            );

        sectionNode.append(
            element(
                doc,
                "h3",
                "intelligence-response__title",
                section.title,
            ),
        );

        /*
         * Keep backend text untrusted.
         * Render it only through textContent,
         * never innerHTML.
         */
        for (
            const paragraph of
            section.content.split(/\n+/)
        ) {
            if (
                paragraph.trim() === ""
            ) {
                continue;
            }

            sectionNode.append(
                element(
                    doc,
                    "p",
                    "intelligence-response__content",
                    paragraph.trim(),
                ),
            );
        }

        wrapper.append(
            sectionNode,
        );
    }

    return wrapper.children.length > 0
        ? wrapper
        : null;
}




export function appendAssistantMessage({
    conversation,
    content,
    sections = [],
    citations = [],
    references = [],
    table = null,
    grounding = null,
    openCitation,
}) {
    const doc = conversation.ownerDocument;
    const row = element(doc, "div", "message message--assistant");

    const sectionsNode =
        renderResponseSections(
            doc,
            sections,
        );

    if (sectionsNode) {
        row.append(
            sectionsNode,
        );
    } else {
        row.append(
            renderAnswer(
                doc,
                content,
            ),
        );
    }

    const tableNode = renderTable(doc, table);

    if (tableNode) row.append(tableNode);

    if (Array.isArray(citations) && citations.length > 0 && openCitation) {
        row.append(renderCitations(doc, citations, openCitation, references));
    }

    const warnings = renderWarnings(doc, grounding);

    if (warnings) row.append(warnings);

    conversation.append(row);
    conversation.scrollTop = conversation.scrollHeight;

    return row;
}
