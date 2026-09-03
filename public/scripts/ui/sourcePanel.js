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
function safeUrl(value, origin) {
    if (typeof value !== "string" || value.trim() === "") {
        return null;
    }

    try {
        const parsed = new URL(value, origin);

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

function element(doc, tag, className, text) {
    const node = doc.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;

    return node;
}

export function createSourcePanel({ panel, titleNode, metaNode, bodyNode, closeButton, downloadLink }) {
    /*
     * Everything is derived from the panel's own document rather than from the
     * `document` and `window` globals.
     *
     * That is not tidiness. Reaching for globals made this module impossible to
     * test without assigning `global.document`, which is fragile across
     * environments and was silently failing on Windows -- the whole test file
     * errored on load and took its nine tests with it, so the suite reported
     * 104 passing instead of 112 and looked healthy.
     *
     * Deriving from ownerDocument also means this works unchanged inside an
     * iframe or a shadow root, which globals would not.
     */
    const doc = panel.ownerDocument;
    const view = doc.defaultView;
    const origin = view?.location?.origin ?? "http://localhost";
    const el = (tag, className, text) => element(doc, tag, className, text);

    let lastFocused = null;

    // bumped every time a citation opens, so a HEAD response that comes back
    // after the reader has already moved to a different citation (or closed
    // the panel) knows not to append its badge to content that is no longer
    // showing that source.
    let openToken = 0;

    /**
     * Asks the asset endpoint, with no body transferred, whether this citation
     * is being served from S3 or local disk (see the HEAD route added
     * alongside this for exactly this purpose) and appends a small badge with
     * the answer. Best-effort: a request that fails or a panel that has moved
     * on by the time it resolves just means no badge appears, not an error
     * shown to the reader.
     */
    /**
     * `inlineLink`, when given, is appended right after the storage line
     * instead of leaving "Open in a new tab" down in the fixed footer -- for
     * a table citation the footer sits below a viewport's worth of SQL and
     * row-count text and reads as gone, whereas here it lands exactly where
     * the reader's eye already is. It is appended whether or not the HEAD
     * call itself succeeds, so a network hiccup loses the storage line, not
     * the only way to open the file.
     */
    function announceStorage(url, token, { inlineLink = null } = {}) {
        const appendInlineLink = () => {
            if (!inlineLink || token !== openToken) return;

            const link = el("a", "source-panel__download source-panel__download--inline", inlineLink);

            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            bodyNode.appendChild(link);
        };

        (view?.fetch ?? fetch)(url, { method: "HEAD", credentials: "same-origin" })
            .then((response) => {
                if (token !== openToken) return;

                const storage = response.headers.get("X-Asset-Storage");

                if (storage) {
                    const label = storage === "s3" ? "AWS S3" : "local disk";
                    const key = response.headers.get("X-Asset-S3-Key");

                    bodyNode.appendChild(
                        el(
                            "p",
                            "source-panel__storage",
                            key ? `Storage: ${label} (${key})` : `Storage: ${label}`,
                        ),
                    );
                }

                appendInlineLink();
            })
            .catch(() => {
                // network error or the endpoint rejecting HEAD -- the storage
                // line just does not appear; the download link still should.
                appendInlineLink();
            });
    }

    function close() {
        panel.hidden = true;
        panel.classList.remove("source-panel--open");
        doc.body.classList.remove("has-source-panel");
        bodyNode.replaceChildren();
        openToken += 1;

        // send focus back where it came from, so keyboard users are not dumped
        // at the top of the document after closing.
        if (lastFocused && doc.contains(lastFocused)) {
            lastFocused.focus();
        }
    }

    function renderUnavailable(message) {
        const note = el("p", "source-panel__note", message);
        bodyNode.replaceChildren(note);
    }

    function renderPdf(source, url) {
        /*
         * No `sandbox` attribute, and that is deliberate rather than an
         * oversight.
         *
         * Chrome renders PDFs with an internal plugin, and a sandboxed iframe
         * blocks plugins outright -- the panel showed an empty grey box with a
         * broken-document icon and no error, which reads as "the file is
         * missing" rather than "the browser refused to draw it".
         *
         * Dropping the sandbox is acceptable here specifically because these
         * are same-origin responses from our own /api/assets route, which
         * serves only files present in the index and re-checks access on every
         * request. If this ever serves third-party or user-uploaded content,
         * the sandbox has to come back and the viewer has to change with it --
         * PDF.js rendered to a canvas would be the way, since that is script,
         * not a plugin.
         */
        const frame = el("iframe", "source-panel__frame");

        frame.src = url.href;
        frame.title = `${source.title} — cited page`;
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.addEventListener("error", () =>
            renderUnavailable(
                "This document could not be displayed here. Use the link below to open it in a new tab.",
            ),
        );

        bodyNode.replaceChildren(frame);
    }

    function renderVideo(source, url) {
        const match = url.href.match(VIDEO_ID);
        const start = source.locator?.startSeconds ?? 0;

        // a recording we transcribed ourselves is a file on this machine, not a
        // youtube page, so there is no video id in the link to find. it gets
        // played directly instead of being turned away.
        if (!match) {
            renderLocalVideo(source, url, start);
            return;
        }

        const frame = el("iframe", "source-panel__frame source-panel__frame--video");

        // start= is what makes the citation land on the cited moment rather
        // than at the beginning of the clip.
        frame.src = `https://www.youtube.com/embed/${match[1]}?start=${start}`;
        frame.title = `${source.title} — cited segment`;
        frame.allow = "accelerometer; encrypted-media; picture-in-picture";
        frame.setAttribute("allowfullscreen", "");

        bodyNode.replaceChildren(frame);
    }

    function renderLocalVideo(source, url, start) {
        const video = el("video", "source-panel__frame source-panel__frame--video");

        video.src = url.href;
        video.controls = true;
        // metadata only. loading the whole recording to show one cited moment
        // would stall the panel on a forty minute talk.
        video.preload = "metadata";
        video.setAttribute("playsinline", "");

        if (start > 0) {
            // the #t= in the url does this on its own in most browsers, but not
            // all of them, so the jump is also made by hand. it has to wait for
            // the length to be known -- seeking before then is silently ignored
            // and the clip just starts from the beginning.
            video.addEventListener(
                "loadedmetadata",
                () => {
                    if (Number.isFinite(video.duration) && start < video.duration) {
                        video.currentTime = start;
                    }
                },
                { once: true },
            );
        }

        video.addEventListener(
            "error",
            () => {
                renderUnavailable(
                    "This clip could not be played here. Use Download to open it.",
                );
            },
            { once: true },
        );

        bodyNode.replaceChildren(video);
    }

    function renderQuote(source) {
        const parts = [];

        if (source.quote) {
            const block = el("blockquote", "source-panel__quote", source.quote);
            parts.push(block);
        }

        if (source.kind === "slide") {
            parts.push(
                el(
                    "p",
                    "source-panel__note",
                    "PowerPoint files cannot be displayed in a browser. The text of the cited slide is shown above; use Download to open the deck.",
                ),
            );
        }

        if (parts.length === 0) {
            parts.push(el("p", "source-panel__note", "No preview is available for this source."));
        }

        bodyNode.replaceChildren(...parts);
    }

    function renderTable(source) {
        const parts = [];

        if (source.sql) {
            const heading = el("p", "source-panel__note", "The query that produced this answer:");
            const code = el("pre", "source-panel__sql", source.sql);

            parts.push(heading, code);
        }

        if (source.basis) {
            parts.push(
                el(
                    "p",
                    "source-panel__note",
                    `Computed over ${source.basis.rowsMatched} of ${source.basis.rowsScanned} rows.`,
                ),
            );
        }

        bodyNode.replaceChildren(...(parts.length > 0 ? parts : [el("p", "source-panel__note", "No query detail available.")]));
    }

    function open(citation, trigger) {
        const source = normalise(citation);

        openToken += 1;
        const token = openToken;

        lastFocused = trigger ?? doc.activeElement;

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

        const url = safeUrl(source.href, origin);

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

        // a table citation has no iframe or clip to anchor the eye near the
        // footer -- it is a screen of SQL and row counts, with the footer link
        // a scroll away and easy to miss (reported directly: "it's too far
        // down, I can't see it"). Inlining it right under the storage line
        // puts it where the reader is already looking; every other kind keeps
        // the fixed footer, which sits right beside their iframe/clip/quote.
        const inlineDownload = source.kind === "table";

        // our own /api/assets route serves every non-external citation, so a
        // HEAD to the same url the panel already resolved tells the reader
        // where the byte actually came from without them opening devtools.
        if (url && !source.external) {
            announceStorage(url.href, token, inlineDownload ? { inlineLink: "Open in a new tab" } : {});
        }

        // "open in a new tab" is a deliberate escape hatch, not the main path.
        // some things genuinely cannot render inline -- PowerPoint, and any
        // browser without a built-in PDF viewer -- and a dead end is worse than
        // a second tab.
        if (downloadLink) {
            if (url && !inlineDownload) {
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
        doc.body.classList.add("has-source-panel");

        closeButton.focus();
    }

    closeButton.addEventListener("click", close);

    doc.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !panel.hidden) close();
    });

    return { open, close };
}
