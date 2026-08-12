/**
 * Opens a cited source beside the conversation, without leaving it.
 *
 * The partner's requirement, in his words: "clicking on the link would open the
 * asset, but not take them away from or lose the chat function spot."
 *
 * The previous citation dialog showed an <a href> that navigated the tab. That
 * loses the conversation, which is precisely the thing he asked us not to do.
 * This panel slides in over the right-hand side instead: the chat stays mounted,
 * scrolled where it was, and you can keep typing while a source is open.
 *
 * Each source type opens differently because each has a different notion of
 * "the cited spot":
 *
 *   pdf     an <iframe> at #page=N. Browsers' built-in PDF viewers honour the
 *           fragment, so the reader lands on the page the claim came from
 *           rather than on page 1 of a 40-page paper.
 *   video   an embedded player starting at the cited second.
 *   slide   PowerPoint cannot render in a browser, so we show the extracted
 *           slide text plus a download. Saying that plainly beats an empty
 *           frame that looks broken.
 *   table   the rows and the SQL that produced them.
 */

const VIDEO_ID = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/;

/**
 * Only http, https and same-origin relative URLs are followed.
 *
 * Citation links are built from indexed metadata, which ultimately comes from
 * partner files. Treating that as trusted input would be a mistake.
 */
function safeUrl(value) {
    if (typeof value !== "string" || value.trim() === "") {
        return null;
    }

    try {
        const parsed = new URL(value, window.location.origin);

        return parsed.protocol === "http:" || parsed.protocol === "https:"
            ? parsed
            : null;
    } catch {
        return null;
    }
}

/**
 * Accepts either the current citation shape or the older one.
 *
 * The backend returns `link.href` and `quote`; earlier frontend code looked for
 * `url` and `excerpt`. Reading both means neither side has to change in
 * lockstep, and a mismatch degrades to "no preview" rather than to a citation
 * button that silently does nothing.
 */
function normalise(citation) {
    if (typeof citation === "string") {
        return { title: citation, quote: citation, href: null, kind: "unknown" };
    }

    const link = citation?.link ?? {};

    return {
        number: citation?.number ?? null,
        title: citation?.title ?? citation?.name ?? "Source",
        fileName: citation?.fileName ?? null,
        quote: citation?.quote ?? citation?.excerpt ?? citation?.text ?? null,
        href: link.href ?? citation?.url ?? citation?.href ?? null,
        // unknown rather than assuming pdf. an older-shape citation carries a
        // url but no type, and guessing pdf renders an iframe that may show
        // nothing while hiding the quote we definitely do have.
        kind: link.kind ?? citation?.kind ?? "unknown",
        label: link.label ?? null,
        locator: link.locator ?? {},
        external: link.external === true,
        authors: citation?.authors ?? [],
        date: citation?.date ?? null,
        sensitivity: citation?.sensitivity ?? null,
        sql: citation?.sql ?? null,
        basis: citation?.basis ?? null,
        alsoAppearsIn: citation?.alsoAppearsIn ?? [],
    };
}

function element(tag, className, text) {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

export function createSourcePanel({ panel, titleNode, metaNode, bodyNode, closeButton, downloadLink }) {
    let lastFocused = null;

    function close() {
        panel.hidden = true;
        panel.classList.remove("source-panel--open");
        document.body.classList.remove("has-source-panel");
        bodyNode.replaceChildren();

        // send focus back where it came from, so keyboard users are not dumped
        // at the top of the document after closing.
        if (lastFocused && document.contains(lastFocused)) {
            lastFocused.focus();
        }
    }

    function renderUnavailable(message) {
        const note = element("p", "source-panel__note", message);
        bodyNode.replaceChildren(note);
    }

    function renderPdf(source, url) {
        const frame = element("iframe", "source-panel__frame");

        frame.src = url.href;
        frame.title = `${source.title} — cited page`;
        // the asset route is same-origin; the sandbox stops an unexpected
        // document doing anything beyond rendering itself.
        frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
        frame.addEventListener("error", () =>
            renderUnavailable("This document could not be displayed. Use Download to open it."),
        );

        bodyNode.replaceChildren(frame);
    }

    function renderVideo(source, url) {
        const match = url.href.match(VIDEO_ID);

        if (!match) {
            renderUnavailable("This clip cannot be embedded. Use Download to open it.");
            return;
        }

        const start = source.locator?.startSeconds ?? 0;
        const frame = element("iframe", "source-panel__frame source-panel__frame--video");

        // start= is what makes the citation land on the cited moment rather
        // than at the beginning of the clip.
        frame.src = `https://www.youtube.com/embed/${match[1]}?start=${start}`;
        frame.title = `${source.title} — cited segment`;
        frame.allow = "accelerometer; encrypted-media; picture-in-picture";
        frame.setAttribute("allowfullscreen", "");

        bodyNode.replaceChildren(frame);
    }

    function renderQuote(source) {
        const parts = [];

        if (source.quote) {
            const block = element("blockquote", "source-panel__quote", source.quote);
            parts.push(block);
        }

        if (source.kind === "slide") {
            parts.push(
                element(
                    "p",
                    "source-panel__note",
                    "PowerPoint files cannot be displayed in a browser. The text of the cited slide is shown above; use Download to open the deck.",
                ),
            );
        }

        if (parts.length === 0) {
            parts.push(element("p", "source-panel__note", "No preview is available for this source."));
        }

        bodyNode.replaceChildren(...parts);
    }

    function renderTable(source) {
        const parts = [];

        if (source.sql) {
            const heading = element("p", "source-panel__note", "The query that produced this answer:");
            const code = element("pre", "source-panel__sql", source.sql);

            parts.push(heading, code);
        }

        if (source.basis) {
            parts.push(
                element(
                    "p",
                    "source-panel__note",
                    `Computed over ${source.basis.rowsMatched} of ${source.basis.rowsScanned} rows.`,
                ),
            );
        }

        bodyNode.replaceChildren(...(parts.length > 0 ? parts : [element("p", "source-panel__note", "No query detail available.")]));
    }

    function open(citation, trigger) {
        const source = normalise(citation);

        lastFocused = trigger ?? document.activeElement;

        titleNode.textContent = source.label ?? source.title;

        // everything a reader needs to judge and locate the claim.
        const meta = [
            source.fileName,
            source.authors.length > 0 ? source.authors.slice(0, 3).join(", ") : null,
            source.date,
            source.sensitivity ? `classified ${source.sensitivity}` : null,
            source.alsoAppearsIn.length > 0
                ? `also appears in ${source.alsoAppearsIn.length} other document(s)`
                : null,
        ].filter(Boolean);

        metaNode.textContent = meta.join(" · ");
        metaNode.hidden = meta.length === 0;

        const url = safeUrl(source.href);

        if (source.kind === "table") {
            renderTable(source);
        } else if (!url) {
            renderQuote(source);
        } else if (source.kind === "video") {
            renderVideo(source, url);
        } else if (source.kind === "pdf" || source.kind === "slide-image") {
            renderPdf(source, url);
        } else {
            // slides, and anything we do not recognise: show the quote we have
            // and leave the download link as the way in.
            renderQuote(source);
        }

        // "open in a new tab" is a deliberate escape hatch, not the main path.
        // some things genuinely cannot render inline -- PowerPoint, and any
        // browser without a built-in PDF viewer -- and a dead end is worse than
        // a second tab.
        if (downloadLink) {
            if (url) {
                downloadLink.href = url.href;
                downloadLink.hidden = false;
                downloadLink.textContent = source.external
                    ? "Open at the source"
                    : "Open in a new tab";
            } else {
                downloadLink.removeAttribute("href");
                downloadLink.hidden = true;
            }
        }

        panel.hidden = false;
        panel.classList.add("source-panel--open");
        // the chat shrinks rather than being covered, so it stays readable and
        // usable with a source open -- which is the whole requirement.
        document.body.classList.add("has-source-panel");

        closeButton.focus();
    }

    closeButton.addEventListener("click", close);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !panel.hidden) close();
    });

    return { open, close };
}
