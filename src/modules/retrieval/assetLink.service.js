// builds the links that let a coach open the exact thing an answer came from.
//
// al's requirement, in his words: "clicking on the link would open the asset,
// but not take them away from or lose the chat function spot."
//
// two halves to that. the frontend half is opening it in a side panel rather
// than navigating -- that is theirs. our half is making the link precise enough
// to be worth opening: not "the periodisation paper" but page 7 of it, not "the
// catapult deck" but slide 12, not "the rally clip" but 15 seconds in.
//
// a citation that opens a 40-page pdf at page 1 is barely better than no
// citation, because the reader still has to find the claim themselves, and they
// will not.

import path from "node:path";

// how each kind of source is addressed. the fragment syntaxes here are the ones
// browsers and embedded viewers already understand, so the frontend does not
// need bespoke handling per type.
const LOCATORS = Object.freeze({
  // pdf.js and every browser pdf viewer honour #page=
  pdf: (locator) => (locator.page ? `#page=${locator.page}` : ""),
  // no standard exists for slides; the viewer reads this and jumps.
  slide: (locator) => (locator.slide ? `#slide=${locator.slide}` : ""),
  // two different syntaxes, because there are two different kinds of video.
  video: (locator, isExternal) => {
    if (locator.startSeconds === null) return "";

    // youtube's own parameter. its urls already carry a ?v= so this joins on &.
    if (isExternal) return `&t=${locator.startSeconds}s`;

    // a clip we transcribed ourselves is served by /api/assets, and a browser
    // video player jumps to a time using #t= instead. sending youtube's syntax
    // here would glue "&t=90s" onto the end of the path and the file would not
    // load at all -- so the timestamp would break the link rather than use it.
    return `#t=${locator.startSeconds}`;
  },
  // a row in a table. the viewer highlights it.
  table: (locator) => (locator.rowId ? `#row=${locator.rowId}` : ""),
});

function kindFor(chunk) {
  if (chunk.modality === "media") return "video";
  if (chunk.modality === "record") return "table";

  const extension = path.extname(chunk.source_uri ?? "").toLowerCase();

  if (extension === ".pptx" || extension === ".ppt") return "slide";

  return "pdf";
}

/**
 * turns "1:05" or "0:15" or 75 into seconds.
 *
 * video timestamps arrive in whatever the source used, and a link with
 * `&t=1:05s` silently does nothing rather than failing visibly.
 */
export function toSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Math.max(0, Math.round(value));

  const text = String(value).trim();

  if (/^\d+$/.test(text)) return Number(text);

  const parts = text.split(":").map(Number);

  if (parts.some((part) => !Number.isFinite(part))) return null;

  // mm:ss or hh:mm:ss
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * builds everything the frontend needs to render and open one citation.
 *
 * `href` is a route on our own server rather than a file:// path. file:// links
 * are blocked by every browser when the page is served over http, so a citation
 * built from the ingest-time absolute path looks fine in json and does nothing
 * when clicked.
 */
export function buildAssetLink(chunk, { baseUrl = "" } = {}) {
  const kind = kindFor(chunk);

  const locator = {
    page: chunk.page ?? null,
    slide: chunk.slide ?? null,
    startSeconds: toSeconds(chunk.start_time ?? null),
    rowId: chunk.row_id ?? null,
  };

  // a video that came with a real url opens at the source; everything else is
  // served by us from the asset registry.
  const isExternal = typeof chunk.external_url === "string" && chunk.external_url.startsWith("http");

  const base = isExternal
    ? chunk.external_url
    : `${baseUrl}/api/assets/${encodeURIComponent(chunk.doc_id)}`;

  const fragment = LOCATORS[kind]?.(locator, isExternal) ?? "";

  const href = `${base}${fragment}`;

  return {
    href,
    kind,
    external: isExternal,
    // the frontend opens this beside the conversation rather than navigating,
    // which is the part of al's requirement we cannot enforce from here -- so it
    // is stated in the payload rather than left to be remembered.
    target: "side_panel",
    locator,
    label: buildLabel(chunk, kind, locator),
  };
}

function buildLabel(chunk, kind, locator) {
  const where =
    kind === "pdf" && locator.page
      ? `page ${locator.page}`
      : kind === "slide" && locator.slide
        ? `slide ${locator.slide}`
        : kind === "video" && locator.startSeconds !== null
          ? formatTime(locator.startSeconds)
          : kind === "table" && locator.rowId
            ? `row ${locator.rowId}`
            : null;

  return [chunk.title, where].filter(Boolean).join(", ");
}

/** the filename, for showing under a citation label. */
export function sourceFileLabel(chunk) {
  return chunk.file_name ?? null;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);

  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * the registry that lets /api/assets/:docId find the original file.
 *
 * built from the index rather than from a separate list, so it can never drift
 * out of sync with what was actually indexed -- if a chunk cites it, the
 * registry can serve it.
 */
export function buildAssetRegistry(chunks) {
  const registry = new Map();

  for (const chunk of chunks) {
    if (!chunk.source_uri || registry.has(chunk.doc_id)) continue;

    registry.set(chunk.doc_id, {
      docId: chunk.doc_id,
      title: chunk.title,
      path: chunk.source_uri,
      sensitivity: chunk.sensitivity,
      aclGroups: chunk.acl_groups,
    });
  }

  return registry;
}
