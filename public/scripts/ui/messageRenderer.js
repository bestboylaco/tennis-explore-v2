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
 *   answer     prose, with [n] citation markers -- rendered as clickable
 *              in-text citations (see appendCitationRun), not a separate
 *              list: a reader checks a claim at the claim.
 *   table      a computed result, when the question was answered from records
 *   citations  the data each in-text citation resolves against, and (for a
 *              table answer) where the SQL behind it is shown beside the
 *              conversation when a reader clicks through.
 */

function element(doc, tag, className, text) {
    const node = doc.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

const INLINE_TOKEN = /\*\*(.+?)\*\*|((?:\[\d+\])+)/g;

/**
 * Appends `**bold**` runs as real <strong> elements and citation marker runs
 * as clickable in-text citations (see appendCitationRun), everything else as
 * plain text nodes.
 *
 * Still never treats the model's output as markup: every piece either goes
 * into textContent/createTextNode, or -- for a citation -- is built from
 * data this file already trusts (the citations array), never from the
 * model's own text. A model that writes literal "<" or a stray "**" with no
 * closing pair renders as inert text either way.
 */
// a bold span whose ENTIRE content is citation markers -- "**[4]**", not
// "**bold text** [4]" -- which the model does sometimes, emphasising the
// marker itself rather than placing it after emphasised text. Matched
// before building a <strong>, so this renders as a citation like any other
// [4], not as literal bold text containing the characters "[4]" (reported
// directly, 2026-10-01: the raw bracket was still showing because this
// exact shape fell through as bold text instead).
const BOLD_CITATION_ONLY = /^(?:\[\d+\])+$/;

function appendInlineFormatting(doc, parent, text, citationsByNumber = null, openCitation = null, citationState = null) {
    const value = String(text);
    let lastIndex = 0;

    for (const match of value.matchAll(INLINE_TOKEN)) {
        if (match.index > lastIndex) {
            parent.append(doc.createTextNode(value.slice(lastIndex, match.index)));
        }

        if (match[1] !== undefined && citationsByNumber && BOLD_CITATION_ONLY.test(match[1])) {
            appendCitationRun(doc, parent, match[1], citationsByNumber, openCitation, citationState);
        } else if (match[1] !== undefined) {
            const strong = doc.createElement("strong");

            strong.textContent = match[1];
            parent.append(strong);
        } else if (citationsByNumber) {
            appendCitationRun(doc, parent, match[2], citationsByNumber, openCitation, citationState);
        } else {
            parent.append(doc.createTextNode(match[2]));
        }

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < value.length) {
        parent.append(doc.createTextNode(value.slice(lastIndex)));
    }
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
function appendBlock(doc, wrapper, block, orderedState, citationsByNumber, openCitation, citationState) {
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

            appendInlineFormatting(doc, node, heading[2], citationsByNumber, openCitation, citationState);
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

            appendInlineFormatting(doc, li, listMatch[1], citationsByNumber, openCitation, citationState);
            currentList.append(li);

            if (listTag === "ol") orderedState.count += 1;

            continue;
        }

        currentList = null;
        currentListTag = null;

        const p = element(doc, "p");

        appendInlineFormatting(doc, p, line, citationsByNumber, openCitation, citationState);
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
function renderAnswer(doc, text, citations = [], openCitation = null) {
    const wrapper = element(doc, "div", "message__bubble");
    const orderedState = { count: 0 };
    const citationsByNumber = new Map(citations.map((citation) => [citation.number, citation]));
    // tracks the most recently rendered citation's document, across the
    // whole answer in reading order, so appendCitationRun can tell a
    // genuine repeat (same document, right after itself) from a fresh
    // citation -- see appendCitationRun for what that changes about how it
    // renders.
    const citationState = { lastDocId: null };

    for (const block of String(text).split(/\n{2,}/)) {
        if (block.trim() === "") continue;

        appendBlock(doc, wrapper, block, orderedState, citationsByNumber, openCitation, citationState);
    }

    if (wrapper.children.length === 0) {
        appendBlock(doc, wrapper, String(text), orderedState, citationsByNumber, openCitation, citationState);
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
 * In-text citations, not a "Sources" dropdown.
 *
 * Every [n] marker (or consecutive run, "[2][5]") in the answer renders as a
 * clickable span of real text -- "(Author, Year)" -- that opens the same
 * side panel a Sources button used to. A reader checks a claim at the claim,
 * not in a separate list they have to go find (reported directly,
 * 2026-09-28: replace the dropdown with in-text hyperlinks on the citations
 * themselves). A marker with no matching citation (dangling -- see
 * bindCitations) is left as the bare "[n]" text rather than a dead link.
 *
 * This mirrors apaInText/apaShortAuthor/apaYear/apaShortTitle in
 * citation.service.js exactly, on purpose -- the backend's `references` list
 * (CLI, history exports) and this inline rendering need to describe the same
 * citation the same way. Duplicated rather than imported because this file
 * ships to the browser as a plain script with no bundler, and citation
 * titles already arrive pre-cleaned (see cleanTitle server-side) so this
 * copy does not need that part.
 */
function apaYear(date) {
    const match = String(date ?? "").match(/\b(1[89]|20)\d{2}\b/);

    return match ? match[0] : "n.d.";
}

function apaShortAuthor(authors) {
    if (!Array.isArray(authors) || authors.length === 0) return null;
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;

    return `${authors[0]} et al.`;
}

function apaShortTitle(citation, maxWords = 6) {
    const title = citation.title || citation.fileName || citation.docId || "untitled source";
    const words = String(title).trim().split(/\s+/);
    const short = words.slice(0, maxWords).join(" ");

    return words.length > maxWords ? `${short}...` : short;
}

function apaInText(citation) {
    const author = apaShortAuthor(citation.authors);
    const year = apaYear(citation.date);

    if (author) return `${author}, ${year}`;

    return `"${apaShortTitle(citation)}," ${year}`;
}

/**
 * Appends one run of consecutive "[n]" markers as a single clickable
 * citation, grouping multiple sources the way APA does ("(Author, 2021;
 * Other, 2019)") the same way toApaText does server-side. Clicking opens the
 * first known source in the group -- there is one panel, so a grouped
 * citation has to pick one, and the first is the one the marker run leads
 * with.
 *
 * A run where none of the numbers match a real citation renders as plain
 * text, not a dead button -- an invented citation number should stay
 * visible as what it is, not disappear or look clickable when it is not.
 *
 * A single-source run whose document is the SAME document the immediately
 * preceding citation pointed at (`citationState.lastDocId`) renders compact
 * -- just "p.6" -- instead of repeating the full "(Author, Year)" again.
 * This is the common case in a structured, multi-point answer built mostly
 * from one paper cited at several different pages: each point is still a
 * genuinely different, independently-checkable claim (different page,
 * different table), so the citation stays -- it just doesn't need to
 * re-announce the same author and year every single time right next to
 * where it already said so (reported directly, 2026-10-01: a five-point
 * breakdown citing one paper's three different pages read as needlessly
 * repetitive). A multi-source run, or a repeat that isn't immediately
 * adjacent, always renders in full.
 */
function appendCitationRun(doc, parent, run, citationsByNumber, openCitation, citationState) {
    const numbers = [...run.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
    const known = numbers.map((number) => citationsByNumber.get(number)).filter(Boolean);

    if (known.length === 0 || !openCitation) {
        parent.append(doc.createTextNode(run));
        return;
    }

    const isRepeatOfLast =
        known.length === 1 &&
        citationState &&
        known[0].docId != null &&
        known[0].docId === citationState.lastDocId &&
        known[0].page != null;

    const label = isRepeatOfLast ? `p.${known[0].page}` : `(${known.map(apaInText).join("; ")})`;

    const button = element(
        doc,
        "button",
        isRepeatOfLast ? "citation-inline citation-inline--compact" : "citation-inline",
        label,
    );

    button.type = "button";
    button.addEventListener("click", () => openCitation(known[0], button));

    parent.append(button);

    if (citationState) {
        citationState.lastDocId = known.length === 1 ? (known[0].docId ?? null) : null;
    }
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
                citations,
                openCitation,
            ),
        );
    }

    const tableNode = renderTable(doc, table);

    if (tableNode) row.append(tableNode);

    const warnings = renderWarnings(doc, grounding);

    if (warnings) row.append(warnings);

    conversation.append(row);
    conversation.scrollTop = conversation.scrollHeight;

    return row;
}
