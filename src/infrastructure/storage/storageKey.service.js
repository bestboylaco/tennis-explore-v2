// Maps a local source path recorded by the current index (sourceUri) to the
// S3 object key the same file would use once uploaded, without requiring the
// index to change.
//
// The mapping is deterministic and reversible: strip a configured root
// (env.storage.assetSourceRoot), normalise to forward slashes. An upload
// script uses this exact function to name objects when it populates the
// bucket from the existing local corpus, and asset.routes.js uses it again
// at request time to find the same object back. That symmetry is what lets
// S3 mode work against the index that already exists today -- sourceUri only
// needs to start being written as S3 keys directly once the ingestion
// pipeline itself is migrated, which is a separate, later step.

import path from "node:path";

/**
 * The index that sourceUri values come from is built once, on whatever
 * machine ran bin/build-index.js (in this project's case, Windows), and the
 * server reading citations back can be a different machine entirely --
 * Linux in CI, Linux in a container deployment, someone else's Windows
 * laptop. node:path's default export is platform-dependent (POSIX on Linux,
 * where a Windows path like "C:\Users\...\file.pdf" has no "/" in it and is
 * parsed as a single opaque segment), so picking the implementation from
 * process.platform would make this function correct on the machine that
 * built the index and silently wrong everywhere else. Picking it from the
 * path string itself keeps behaviour tied to the data, not the host.
 */
function pathImplFor(pathString) {
  return /^[A-Za-z]:[\\/]|\\/.test(pathString) ? path.win32 : path.posix;
}

export function toStorageKey(sourcePath, rootDir) {
  if (!rootDir) {
    throw new Error(
      "toStorageKey requires ASSET_SOURCE_ROOT to be set -- it is the root every " +
        "indexed sourceUri is made relative to when deriving an S3 key.",
    );
  }

  const impl = pathImplFor(rootDir);
  const relative = impl.relative(rootDir, sourcePath);

  if (relative.startsWith("..") || impl.isAbsolute(relative)) {
    throw new Error(
      `cannot derive an S3 key for "${sourcePath}": it is not inside ASSET_SOURCE_ROOT ` +
        `("${rootDir}").`,
    );
  }

  return relative.split(impl.sep).join("/");
}

// Covers what the ingestion pipeline actually produces citations for
// (extraction.service.js's supported extensions, plus the image/video
// source_uri values chunkImages()/chunkVideo() can emit). No dependency
// pulled in for this -- it's a fixed, small set of known extensions, not
// general-purpose MIME sniffing.
const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export function guessContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}
