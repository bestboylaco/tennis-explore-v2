/**
 * Converts a citation URL into a safe browser URL.
 *
 * Relative project URLs and normal HTTP or HTTPS links are supported.
 * Other protocols are rejected.
 */
function getSafeCitationUrl(value) {
    if (typeof value !== "string" || value.trim() === "") {
        return null;
    }

    try {
        const parsedUrl = new URL(
            value,
            window.location.origin,
        );

        if (
            parsedUrl.protocol !== "http:" &&
            parsedUrl.protocol !== "https:"
        ) {
            return null;
        }

        return parsedUrl.href;
    } catch {
        return null;
    }
}

/**
 * Normalises citation fields so the frontend can support several
 * reasonable backend citation structures.
 */
function normaliseCitation(citation) {
    if (typeof citation === "string") {
        return {
            title: citation,
            excerpt: citation,
            url: null,
        };
    }

    return {
        title:
            citation?.title ??
            citation?.name ??
            citation?.id ??
            "Citation",

        excerpt:
            citation?.excerpt ??
            citation?.description ??
            citation?.text ??
            "No citation preview is available.",

        url:
            citation?.url ??
            citation?.href ??
            null,
    };
}

export function createCitationDialog({
    dialog,
    title,
    excerpt,
    link,
    closeButton,
    doneButton,
}) {
    function close() {
        if (dialog.open) {
            dialog.close();
        }
    }

    function openCitation(citation) {
        const normalisedCitation =
            normaliseCitation(citation);

        title.textContent = normalisedCitation.title;
        excerpt.textContent = normalisedCitation.excerpt;

        const safeUrl = getSafeCitationUrl(
            normalisedCitation.url,
        );

        if (safeUrl) {
            link.href = safeUrl;
            link.hidden = false;
        } else {
            link.removeAttribute("href");
            link.hidden = true;
        }

        if (typeof dialog.showModal === "function") {
            dialog.showModal();
        } else {
            dialog.setAttribute("open", "");
        }
    }

    closeButton.addEventListener("click", close);
    doneButton.addEventListener("click", close);

    /*
     * Clicking the dark area outside the dialog also closes it.
     */
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            close();
        }
    });

    return {
        openCitation,
        close,
    };
}