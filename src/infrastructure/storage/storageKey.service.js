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

export function toStorageKey(sourcePath, rootDir) {
  if (!rootDir) {
    throw new Error(
      "toStorageKey requires ASSET_SOURCE_ROOT to be set -- it is the root every " +
        "indexed sourceUri is made relative to when deriving an S3 key.",
    );
  }

  const relative = path.relative(rootDir, sourcePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `cannot derive an S3 key for "${sourcePath}": it is not inside ASSET_SOURCE_ROOT ` +
        `("${rootDir}").`,
    );
  }

  return relative.split(path.sep).join("/");
}
