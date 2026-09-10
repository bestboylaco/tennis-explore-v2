import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// retrievalConfig is frozen at module load from the environment, so the values
// this test builds against have to be in place before the index builder is
// first imported.
let workDir;
let buildIndex;

before(async () => {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "index-append-test-"));

  // the offline stand-in embedder. no model, no network -- these tests are
  // about the refusal, which happens long before anything is embedded.
  process.env.EMBEDDING_PROVIDER = "hash";
  process.env.EMBEDDING_MODEL = "bge-m3";
  process.env.EMBEDDING_DIMENSION = "1024";

  ({ buildIndex } = await import("../../src/modules/ingestion/indexBuilder.service.js"));
});

after(async () => {
  await fsp.rm(workDir, { recursive: true, force: true });
});

let counter = 0;

/** a source folder holding one readable document. */
async function sourceDir() {
  counter += 1;

  const dir = path.join(workDir, `src-${counter}`);

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "note.md"),
    "A note long enough to survive the minimum chunk length filter. ".repeat(8),
  );

  return dir;
}

/** an output folder holding a manifest that claims a finished index. */
async function existingIndex(overrides = {}) {
  counter += 1;

  const dir = path.join(workDir, `out-${counter}`);

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      schemaVersion: 3,
      embeddingProvider: "hash",
      embeddingModel: "bge-m3",
      dimension: 1024,
      contextual: "template",
      chunking: { targetChars: 1600, overlapChars: 200, minChars: 120 },
      sourceDirs: ["C:\\somewhere\\else"],
      chunkCount: 99496,
      fileCount: 2599,
      shards: [{ index: 0, count: 99496 }],
      ...overrides,
    }),
  );

  return dir;
}

describe("buildIndex --append -- refusing an incompatible index", () => {
  it("refuses when the index was built by a different embedding model", async () => {
    // the failure this prevents has no symptom. two embedding spaces in one
    // index loads without error, searches without error, and returns quiet
    // nonsense that looks like an ordinary bad retrieval.
    const outputDir = await existingIndex({ embeddingModel: "nomic-embed-text" });

    const sources = await sourceDir();

    await assert.rejects(
      () => buildIndex({ sourceDirs: [sources], outputDir, append: true }),
      /embedding model/,
    );
  });

  it("refuses when the dimension does not match", async () => {
    const outputDir = await existingIndex({ dimension: 768 });

    const sources = await sourceDir();

    await assert.rejects(
      () => buildIndex({ sourceDirs: [sources], outputDir, append: true }),
      /dimension/,
    );
  });

  it("refuses when the chunk size has changed", async () => {
    // not a corruption risk like the model is, but it means the appended chunks
    // were cut to a different recipe than the rest -- and an evaluation over
    // the result is then comparing two things at once.
    const outputDir = await existingIndex({
      chunking: { targetChars: 800, overlapChars: 100, minChars: 120 },
    });

    const sources = await sourceDir();

    await assert.rejects(
      () => buildIndex({ sourceDirs: [sources], outputDir, append: true }),
      /chunking/,
    );
  });

  it("refuses when the contextual header setting has changed", async () => {
    const outputDir = await existingIndex({ contextual: "off" });

    const sources = await sourceDir();

    await assert.rejects(
      () => buildIndex({ sourceDirs: [sources], outputDir, append: true }),
      /contextual/,
    );
  });

  it("names both the old and new values so the mismatch can be fixed", async () => {
    const outputDir = await existingIndex({ embeddingModel: "nomic-embed-text" });

    const sources = await sourceDir();

    await assert.rejects(
      () => buildIndex({ sourceDirs: [sources], outputDir, append: true }),
      (error) => {
        assert.match(error.message, /nomic-embed-text/);
        assert.match(error.message, /bge-m3/);

        return true;
      },
    );
  });

  it("refuses to append when there is no index there at all", async () => {
    counter += 1;

    const outputDir = path.join(workDir, `empty-${counter}`);

    await fsp.mkdir(outputDir, { recursive: true });

    const sources = await sourceDir();

    await assert.rejects(
      () => buildIndex({ sourceDirs: [sources], outputDir, append: true }),
      /no readable index/,
    );
  });
});

// ---------------------------------------------------------------------------
// these build REAL indexes rather than faking a manifest. duplicate detection
// reads the chunks actually on disk, so a hand-written manifest would not
// exercise it at all.
// ---------------------------------------------------------------------------

/** a source folder holding one named document. */
async function namedSource(name, body) {
  counter += 1;

  const dir = path.join(workDir, `named-${counter}`);

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${name}.md`), `${body} `.repeat(12));

  return dir;
}

async function freshIndex() {
  counter += 1;

  const outputDir = path.join(workDir, `real-${counter}`);
  const base = await namedSource("base-corpus", "Baseline document about serve mechanics.");

  await buildIndex({ sourceDirs: [base], outputDir });

  return outputDir;
}

describe("buildIndex --append -- documents already in the index", () => {
  it("refuses when every file offered is already indexed", async () => {
    // the bug this fixes: appending the same folder twice used to succeed and
    // write a second copy of every chunk. the index still loaded, so there was
    // no error to notice -- just a quietly inflated index, skewed bm25 document
    // frequencies, and the same passage retrieved twice.
    const outputDir = await freshIndex();
    const newDocs = await namedSource("scanned-one", "A scanned document about serve speed.");

    await buildIndex({ sourceDirs: [newDocs], outputDir, append: true });

    await assert.rejects(
      () => buildIndex({ sourceDirs: [newDocs], outputDir, append: true }),
      /already in the index/i,
    );
  });

  it("leaves the index untouched when it refuses", async () => {
    // refusing has to happen BEFORE the writer opens. rebuilding bm25 and
    // rewriting the manifest for zero new chunks would churn ~130 MB of
    // committed files to accomplish nothing.
    const outputDir = await freshIndex();
    const newDocs = await namedSource("scanned-two", "Another scanned document about aces.");

    await buildIndex({ sourceDirs: [newDocs], outputDir, append: true });

    const before = await fsp.readFile(path.join(outputDir, "manifest.json"), "utf8");

    await assert.rejects(() => buildIndex({ sourceDirs: [newDocs], outputDir, append: true }));

    const after = await fsp.readFile(path.join(outputDir, "manifest.json"), "utf8");

    assert.equal(after, before);
  });

  it("adds the new documents and skips only the ones already there", async () => {
    const outputDir = await freshIndex();
    const first = await namedSource("scanned-three", "A scanned document about first serves.");

    await buildIndex({ sourceDirs: [first], outputDir, append: true });

    const afterFirst = JSON.parse(await fsp.readFile(path.join(outputDir, "manifest.json"), "utf8"));

    // a folder holding one document already indexed and one that is not.
    await fsp.writeFile(
      path.join(first, "scanned-four.md"),
      "A fourth scanned document about double faults. ".repeat(12),
    );

    const skipped = [];

    const result = await buildIndex({
      sourceDirs: [first],
      outputDir,
      append: true,
      onProgress: (event) => {
        if (event.phase === "duplicate") skipped.push(event.file);
      },
    });

    assert.deepEqual(skipped, ["scanned-three.md"]);
    assert.equal(result.chunkCount, afterFirst.chunkCount + 1);
  });

  it("does not duplicate a chunk_id anywhere in the index", async () => {
    // the property that actually matters, asserted on what is on disk rather
    // than on a count that could coincidentally match.
    const { VectorStore } = await import("../../src/infrastructure/vector/vectorStore.service.js");

    const outputDir = await freshIndex();
    const newDocs = await namedSource("scanned-five", "A scanned document about return depth.");

    await buildIndex({ sourceDirs: [newDocs], outputDir, append: true });
    await assert.rejects(() => buildIndex({ sourceDirs: [newDocs], outputDir, append: true }));

    const store = await VectorStore.load(outputDir);
    const ids = store.chunks.map((chunk) => chunk.chunk_id);

    assert.equal(new Set(ids).size, ids.length);
  });

  it("names the document it skipped, so the refusal is actionable", async () => {
    const outputDir = await freshIndex();
    const newDocs = await namedSource("scanned-six", "A scanned document about net approaches.");

    await buildIndex({ sourceDirs: [newDocs], outputDir, append: true });

    await assert.rejects(
      () => buildIndex({ sourceDirs: [newDocs], outputDir, append: true }),
      (error) => {
        assert.match(error.message, /scanned-six/);

        return true;
      },
    );
  });
});

describe("buildIndex --append -- an index it can safely extend", () => {
  it("accepts settings that match and gets as far as writing", async () => {
    // the positive case only has to prove the guard lets a matching index
    // through. it fails later, on the manifest's shards not existing on disk,
    // which is fine -- that is past the point this test is about.
    const outputDir = await existingIndex();
    const sources = await sourceDir();

    let refusedByTheGuard = false;

    try {
      await buildIndex({ sourceDirs: [sources], outputDir, append: true });
    } catch (error) {
      refusedByTheGuard = /cannot append|no readable index/.test(error.message);
    }

    assert.equal(refusedByTheGuard, false);
  });
});
