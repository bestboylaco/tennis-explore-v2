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
 *   citations  resolved source objects used to turn citations inside the
 *              answer text into direct source links. No separate Sources
 *              dropdown is rendered.
 */

function element(doc, tag, className, text) {
    const node = doc.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

/**
 * Returns the citation number used by the backend for one citation object.
 */
function citationNumber(citation, index) {
    if (
        citation &&
        typeof citation === "object" &&
        Number.isInteger(citation.number)
    ) {
        return citation.number;
    }

    return index + 1;
}


/**
 * Finds the backend reference line for a citation.
 *
 * Example:
 *   [3] Thomas Perri. (2022). Serve Kinematics Study. [research_paper]
 */
function referenceForCitation(citation, index, references = []) {
    const number = citationNumber(citation, index);

    return references.find(
        (line) =>
            typeof line === "string" &&
            line.startsWith(`[${number}]`),
    ) ?? null;
}


/**
 * Normalises a short author/title fragment for conservative text matching.
 */
function normaliseCitationText(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[’']/g, "'")
        .replace(/[^\p{L}\p{N}'-]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}


/**
 * Returns likely author keys for matching an APA in-text citation back to the
 * existing citation object.
 *
 * The backend already resolved each [n] marker to a source. The UI only needs
 * enough information to recognise the visible "(Author, Year)" text and call
 * that same resolver.
 */
function authorKeysForCitation(citation, reference) {
    const keys = new Set();

    const metadataAuthors =
        citation?.authors ??
        citation?.metadata?.authors ??
        citation?.source?.authors ??
        null;

    const authorValues =
        Array.isArray(metadataAuthors)
            ? metadataAuthors
            : typeof metadataAuthors === "string"
              ? metadataAuthors
                  .split(/\s*(?:;|,|\band\b|&)\s*/i)
                  .filter(Boolean)
              : citation?.author
                ? [citation.author]
                : [];

    function addAuthor(value) {
        const cleaned =
            String(value ?? "")
                .replace(/[.;:,]+$/g, "")
                .trim();

        if (!cleaned) return;

        const normalised = normaliseCitationText(cleaned);

        if (normalised) keys.add(normalised);

        const words = cleaned
            .split(/\s+/)
            .map((word) => word.replace(/[^\p{L}\p{N}'’-]/gu, ""))
            .filter(Boolean);

        const surname = words.at(-1);

        if (surname) keys.add(normaliseCitationText(surname));
    }

    for (const author of authorValues) {
        addAuthor(author);
    }

    if (reference) {
        const withoutNumber =
            reference.replace(/^\[\d+\]\s*/, "");

        const yearMatch =
            withoutNumber.match(
                /\((?:19|20)\d{2}[a-z]?\)|\(n\.d\.\)/i,
            );

        const authorBlock =
            yearMatch
                ? withoutNumber.slice(0, yearMatch.index)
                : "";

        if (authorBlock) {
            const etAlMatch =
                authorBlock.match(
                    /^\s*(.+?)\s+et\s+al\.?\s*$/i,
                );

            const firstAuthor =
                etAlMatch
                    ? etAlMatch[1]
                    : authorBlock
                        .split(/\s*(?:;|,|\band\b|&)\s*/i)
                        .find(Boolean);

            addAuthor(firstAuthor);
        }
    }

    return [...keys]
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
}


/**
 * Returns the year token that should identify the citation in APA prose.
 */
function yearForCitation(citation, reference) {
    const direct =
        citation?.year ??
        citation?.metadata?.year ??
        null;

    if (direct) {
        return String(direct)
            .trim()
            .toLowerCase();
    }

    const date =
        citation?.eventDate ??
        citation?.date ??
        citation?.metadata?.eventDate ??
        citation?.metadata?.date ??
        null;

    if (date) {
        const match =
            String(date).match(
                /\b((?:19|20)\d{2}[a-z]?)\b/i,
            );

        if (match) return match[1].toLowerCase();
    }

    const match =
        String(reference ?? "").match(
            /\(((?:19|20)\d{2}[a-z]?|n\.d\.)\)/i,
        );

    return match
        ? match[1].toLowerCase()
        : null;
}


/**
 * Builds a small lookup description for each already-resolved citation.
 */
function buildCitationTargets(citations = [], references = []) {
    return citations.map((citation, index) => {
        const reference =
            referenceForCitation(
                citation,
                index,
                references,
            );

        const titleValues = [
            citation?.title,
            citation?.link?.label,
            citation?.metadata?.title,
            citation?.source?.title,
        ]
            .filter(Boolean)
            .map(
                (value) =>
                    normaliseCitationText(
                        value,
                    ),
            )
            .filter(Boolean);

        return {
            citation,
            number:
                citationNumber(
                    citation,
                    index,
                ),
            year:
                yearForCitation(
                    citation,
                    reference,
                ),
            authorKeys:
                authorKeysForCitation(
                    citation,
                    reference,
                ),
            titleKeys:
                [
                    ...new Set(
                        titleValues,
                    ),
                ],
        };
    });
}


/**
 * Finds which existing citation an APA fragment refers to.
 *
 * Examples:
 *   Perri, 2022
 *   Perri et al., 2022
 *   Perri & Reid, 2022
 */
function citationForApaFragment(fragment, targets) {
    const normalised =
        normaliseCitationText(fragment);

    for (const target of targets) {
        if (
            !target.year ||
            !normalised.includes(
                target.year,
            )
        ) {
            continue;
        }

        const identity =
            normalised
                .replace(
                    new RegExp(
                        `\\b${target.year.replace(".", "\\.")}\\b`,
                        "i",
                    ),
                    "",
                )
                .replace(
                    /\bet\s+al\.?\b/gi,
                    "",
                )
                .replace(
                    /\s+/g,
                    " ",
                )
                .trim();

        if (
            target.authorKeys.some(
                (key) =>
                    key &&
                    (
                        normalised.includes(key) ||
                        identity.includes(key)
                    ),
            )
        ) {
            return target.citation;
        }

        /*
         * Some source documents do not have usable author metadata.
         * answerApa then falls back to a shortened title, e.g.
         * ("Opponent Note Details Report Good pace...", 2020).
         *
         * Match that visible title fragment to the already-resolved citation
         * rather than requiring an author that does not exist.
         */
        if (
            identity.length >= 8 &&
            target.titleKeys.some(
                (key) =>
                    key &&
                    (
                        key.includes(identity) ||
                        identity.includes(key)
                    ),
            )
        ) {
            return target.citation;
        }
    }

    return null;
}


/**
 * Appends one clickable in-text citation.
 *
 * It deliberately calls the same openCitation callback used by the Sources
 * popover. No source URL or access rule is recreated in the browser.
 */
function appendCitationButton(
    doc,
    parent,
    label,
    citation,
    openCitation,
) {
    const button =
        element(
            doc,
            "button",
            "in-text-citation",
            label,
        );

    button.type = "button";
    button.setAttribute(
        "aria-label",
        `Open cited source: ${label}`,
    );

    button.addEventListener(
        "click",
        () => {
            openCitation(
                citation,
                button,
            );
        },
    );

    parent.append(button);
}


/**
 * Appends ordinary text while converting recognised citations into buttons.
 *
 * Supports both:
 *   - APA text already produced by answerApa, e.g. "(Perri et al., 2022)"
 *   - raw numeric fallback markers, e.g. "[3]"
 *
 * Unmatched text stays inert textContent. The renderer still never parses model
 * output as HTML.
 */
function appendTextWithCitationLinks(
    doc,
    parent,
    text,
    citationContext,
) {
    const value =
        String(text ?? "");

    if (
        !citationContext ||
        !citationContext.openCitation ||
        !Array.isArray(
            citationContext.targets,
        ) ||
        citationContext.targets.length === 0
    ) {
        parent.append(
            doc.createTextNode(
                value,
            ),
        );

        return;
    }

    const tokenPattern =
        /\(([^()]*?(?:(?:19|20)\d{2}[a-z]?|n\.d\.)[^()]*)\)|\[(\d+)\]/gi;

    let cursor = 0;

    for (
        const match
        of value.matchAll(
            tokenPattern,
        )
    ) {
        const start =
            match.index ?? 0;

        if (start > cursor) {
            parent.append(
                doc.createTextNode(
                    value.slice(
                        cursor,
                        start,
                    ),
                ),
            );
        }

        const whole =
            match[0];

        const apaGroup =
            match[1];

        const numeric =
            match[2];

        if (numeric) {
            const number =
                Number(numeric);

            const target =
                citationContext.targets.find(
                    (item) =>
                        item.number === number,
                );

            if (target) {
                appendCitationButton(
                    doc,
                    parent,
                    whole,
                    target.citation,
                    citationContext.openCitation,
                );
            } else {
                parent.append(
                    doc.createTextNode(
                        whole,
                    ),
                );
            }

            cursor =
                start +
                whole.length;

            continue;
        }

        const fragments =
            String(apaGroup)
                .split(
                    /\s*;\s*/,
                );

        const resolved =
            fragments.map(
                (fragment) => ({
                    fragment,
                    citation:
                        citationForApaFragment(
                            fragment,
                            citationContext.targets,
                        ),
                }),
            );

        if (
            resolved.every(
                (item) =>
                    !item.citation,
            )
        ) {
            parent.append(
                doc.createTextNode(
                    whole,
                ),
            );
        } else {
            parent.append(
                doc.createTextNode(
                    "(",
                ),
            );

            resolved.forEach(
                (
                    item,
                    index,
                ) => {
                    if (index > 0) {
                        parent.append(
                            doc.createTextNode(
                                "; ",
                            ),
                        );
                    }

                    if (item.citation) {
                        appendCitationButton(
                            doc,
                            parent,
                            item.fragment,
                            item.citation,
                            citationContext.openCitation,
                        );
                    } else {
                        parent.append(
                            doc.createTextNode(
                                item.fragment,
                            ),
                        );
                    }
                },
            );

            parent.append(
                doc.createTextNode(
                    ")",
                ),
            );
        }

        cursor =
            start +
            whole.length;
    }

    if (
        cursor <
        value.length
    ) {
        parent.append(
            doc.createTextNode(
                value.slice(cursor),
            ),
        );
    }
}


/**
 * Appends `**bold**` runs as real <strong> elements, everything else as
 * plain text nodes. Recognised citations inside either form become inline
 * buttons that call the existing citation resolver.
 *
 * Still never treats the model's output as markup: split() on a capturing
 * regex can only ever produce strings. No model-supplied HTML is inserted.
 */
function appendInlineFormatting(
    doc,
    parent,
    text,
    citationContext = null,
) {
    const parts =
        String(text)
            .split(
                /\*\*(.+?)\*\*/g,
            );

    parts.forEach(
        (
            part,
            index,
        ) => {
            if (
                part === ""
            ) {
                return;
            }

            if (
                index % 2 ===
                1
            ) {
                const strong =
                    doc.createElement(
                        "strong",
                    );

                appendTextWithCitationLinks(
                    doc,
                    strong,
                    part,
                    citationContext,
                );

                parent.append(
                    strong,
                );
            } else {
                appendTextWithCitationLinks(
                    doc,
                    parent,
                    part,
                    citationContext,
                );
            }
        },
    );
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
function appendBlock(doc, wrapper, block, orderedState, citationContext = null) {
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

            appendInlineFormatting(doc, node, heading[2], citationContext);
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

            appendInlineFormatting(doc, li, listMatch[1], citationContext);
            currentList.append(li);

            if (listTag === "ol") orderedState.count += 1;

            continue;
        }

        currentList = null;
        currentListTag = null;

        const p = element(doc, "p");

        appendInlineFormatting(doc, p, line, citationContext);
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
function renderAnswer(doc, text, citationContext = null) {
    const wrapper = element(doc, "div", "message__bubble");
    const orderedState = { count: 0 };

    for (const block of String(text).split(/\n{2,}/)) {
        if (block.trim() === "") continue;

        appendBlock(doc, wrapper, block, orderedState, citationContext);
    }

    if (wrapper.children.length === 0) {
        appendBlock(doc, wrapper, String(text), orderedState, citationContext);
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
 * Surfaces the grounding checks rather than hiding them -- except coverage
 * ("how much of this did you cite at all") which is deliberately NOT shown
 * here any more (direct instruction, 2026-10-09): a coach-facing "most of
 * this answer is uncited" disclaimer undermines trust in an answer that may
 * well be correct, just imperfectly attributed by an 8b model. The
 * underlying computation (verifyAnswer, citedFraction, the "ungrounded" and
 * "weak_attribution" warning kinds) is untouched and still returned from
 * the API -- this only stops ungrounded/weak_attribution specifically from
 * reaching the chat bubble, since the overnight eval corpus and any other
 * caller still reads them straight off the response, never through this
 * renderer.
 *
 * What stays visible: a citation that points at nothing (dangling), a
 * figure with no source at all, or a figure attributed to the wrong one.
 * Those are a different, stronger concern than "didn't cite everything" --
 * an actively unverifiable or misattributed number, which is exactly what
 * must never be surfaced as settled fact without a flag.
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
    citationContext = null,
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

            const paragraphNode =
                element(
                    doc,
                    "p",
                    "intelligence-response__content",
                );

            appendInlineFormatting(
                doc,
                paragraphNode,
                paragraph.trim(),
                citationContext,
            );

            sectionNode.append(
                paragraphNode,
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

    /*
     * TENISE in-text source links:
     *
     * The backend has already resolved citations to trusted source objects.
     * The renderer only maps visible citation text back to those objects and
     * delegates opening to the existing sourcePanel.open callback.
     */
    const citationContext =
        Array.isArray(citations) &&
        citations.length > 0 &&
        typeof openCitation === "function"
            ? {
                targets:
                    buildCitationTargets(
                        citations,
                        references,
                    ),

                openCitation,
            }
            : null;

    const sectionsNode =
        renderResponseSections(
            doc,
            sections,
            citationContext,
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
                citationContext,
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
