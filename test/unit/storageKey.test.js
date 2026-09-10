import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toStorageKey } from "../../src/infrastructure/storage/storageKey.service.js";

describe("toStorageKey", () => {
  it("makes a path relative to the configured root and uses forward slashes", () => {
    const key = toStorageKey(
      "C:\\Users\\User\\Desktop\\TA_S2\\document-resources\\match-data\\file.xlsx",
      "C:\\Users\\User\\Desktop\\TA_S2\\document-resources",
    );

    assert.equal(key, "match-data/file.xlsx");
  });

  it("throws without a root, rather than silently using an absolute path as the key", () => {
    assert.throws(() => toStorageKey("/a/b/c.pdf", ""), /ASSET_SOURCE_ROOT/);
  });

  it("refuses to derive a key for a path outside the configured root", () => {
    assert.throws(
      () => toStorageKey("/other/place/c.pdf", "/a/b"),
      /not inside ASSET_SOURCE_ROOT/,
    );
  });

  it("round-trips a POSIX path the same way", () => {
    const key = toStorageKey(
      "/data/corpus/research-pdfs/paper.pdf",
      "/data/corpus",
    );

    assert.equal(key, "research-pdfs/paper.pdf");
  });
});
