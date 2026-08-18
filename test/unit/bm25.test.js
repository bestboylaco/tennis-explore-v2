import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { BM25Index, buildBm25, tokenise } from "../../src/modules/retrieval/bm25.service.js";

const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "bm25-"));

after(() => fsp.rm(temporary, { recursive: true, force: true }));

const documents = [
  { id: "a", text: "Playford Challenger M-CH-AUS-2025-005 hard court score 6-2 6-0" },
  { id: "b", text: "serve volume distribution and accelerometer load during training" },
  { id: "c", text: "Gescheit consecutive days of prolonged tennis match play" },
];

const build = () => buildBm25(async function* () {
  for (const document of documents) yield document;
});

describe("bm25 tokenising", () => {
  it("keeps exact handles intact", () => {
    // splitting these turns an exact tournament lookup into a search for the
    // number 2005, which is the whole reason the sparse arm exists.
    assert.ok(tokenise("code M-CH-AUS-2025-005").includes("m-ch-aus-2025-005"));
    assert.deepEqual(tokenise("score 6-2 6-0"), ["score", "6-2", "6-0"]);
  });

  it("drops the mangled runs that PDF extraction produces", () => {
    assert.equal(tokenise("a".repeat(60)).length, 0);
  });
});

describe("bm25 search", () => {
  it("finds an exact code", async () => {
    const index = await build();

    assert.deepEqual(index.search("M-CH-AUS-2025-005").map((h) => h.id), ["a"]);
  });

  it("finds a rare surname", async () => {
    const index = await build();

    assert.deepEqual(index.search("Gescheit prolonged match play")[0].id, "c");
  });
});

describe("bm25 persistence", () => {
  it("survives a round trip through disk", async () => {
    const directory = path.join(temporary, "roundtrip");
    const index = await build();

    await index.save(directory);

    const loaded = await BM25Index.load(directory, documents.map((d) => d.id));

    assert.equal(loaded.vocabSize, index.vocabSize);
    assert.deepEqual(loaded.search("accelerometer load").map((h) => h.id), ["b"]);
  });

  it("survives Git converting the vocabulary to CRLF", async () => {
    // this is not hypothetical. committing the index and cloning it on Windows
    // rewrites bm25-vocab.txt with CRLF endings, every term gains a trailing
    // "\r", and no query term ever matches one again. The keyword arm returns
    // zero results, throws nothing and logs nothing -- so it works on the
    // machine that built the index and is silently broken for everyone else.
    const directory = path.join(temporary, "crlf");
    const index = await build();

    await index.save(directory);

    const vocabPath = path.join(directory, "bm25-vocab.txt");
    const vocab = await fsp.readFile(vocabPath, "utf8");

    await fsp.writeFile(vocabPath, vocab.replace(/\n/g, "\r\n"));

    const loaded = await BM25Index.load(directory, documents.map((d) => d.id));

    assert.deepEqual(loaded.search("accelerometer load").map((h) => h.id), ["b"]);
  });
});
