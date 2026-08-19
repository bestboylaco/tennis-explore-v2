import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  VectorStore,
  VectorStoreWriter,
  dotInt8,
  l2Normalise,
  quantisationError,
  quantise,
} from "../../src/infrastructure/vector/vectorStore.service.js";

const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "vs-test-"));

after(() => fsp.rm(temporary, { recursive: true, force: true }));

function randomVector(dimension = 64) {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
}

function chunkFor(id) {
  return {
    chunk_id: id,
    doc_id: "d",
    text: "some text",
    context_header: "[header]",
    acl_groups: ["research:public:*"],
  };
}

describe("int8 quantisation", () => {
  it("preserves direction to well within ranking tolerance", () => {
    // the claim this file rests on. if quantisation moved vectors more than a
    // fraction of a percent, the ranking would change and the whole approach
    // would be wrong.
    for (let trial = 0; trial < 50; trial += 1) {
      assert.ok(quantisationError(randomVector(1024)) < 0.01);
    }
  });

  it("clamps instead of wrapping", () => {
    // a component marginally outside [-1, 1] must not wrap from +127 to -128 and
    // turn a vector's strongest dimension into its strongest negative one.
    const quantised = quantise(Float32Array.from([1.5, -1.5, 0]));

    assert.equal(quantised[0], 127);
    assert.equal(quantised[1], -127);
  });

  it("preserves the order of dot products", () => {
    const query = randomVector(128);
    const near = query.map((value) => value + (Math.random() - 0.5) * 0.05);
    const far = randomVector(128);

    const q = quantise(l2Normalise(Float32Array.from(query)));
    const scoreNear = dotInt8(q, quantise(l2Normalise(Float32Array.from(near))), 0, 128);
    const scoreFar = dotInt8(q, quantise(l2Normalise(Float32Array.from(far))), 0, 128);

    assert.ok(scoreNear > scoreFar);
  });
});

describe("sharded store", () => {
  it("round-trips through disk", async () => {
    const directory = path.join(temporary, "roundtrip");
    const writer = new VectorStoreWriter(directory, { dimension: 64, manifest: { test: true } });

    await writer.open();

    const vectors = [];

    for (let i = 0; i < 200; i += 1) {
      const vector = randomVector(64);

      vectors.push(vector);
      await writer.add(chunkFor(`c${i}`), vector);
    }

    await writer.close();

    const store = await VectorStore.load(directory);

    assert.equal(store.size, 200);
    assert.equal(store.manifest.quantisation, "int8");

    // the vector a query is identical to must come back first.
    const hits = store.search(vectors[42], { k: 3 });

    assert.equal(hits[0].id, "c42");
  });

  it("reconstructs embedding_text rather than storing it twice", async () => {
    // storing it would duplicate ~250 MB across the real corpus, which is the
    // difference between an index that commits to git and one that does not.
    const directory = path.join(temporary, "dedupe");
    const writer = new VectorStoreWriter(directory, { dimension: 8 });

    await writer.open();
    await writer.add(chunkFor("x"), randomVector(8));
    await writer.close();

    const raw = await fsp.readFile(path.join(directory, "chunks-000.jsonl"), "utf8");

    assert.ok(!raw.includes("embedding_text"), "embedding_text must not be written to disk");

    const store = await VectorStore.load(directory);

    assert.equal(store.chunks[0].embedding_text, "[header]\nsome text");
  });

  it("refuses a query embedded with a different model", async () => {
    const directory = path.join(temporary, "dims");
    const writer = new VectorStoreWriter(directory, { dimension: 8 });

    await writer.open();
    await writer.add(chunkFor("x"), randomVector(8));
    await writer.close();

    const store = await VectorStore.load(directory);

    assert.throws(() => store.search(randomVector(16)), /different model/);
  });

  it("applies the access filter before scoring, not after", async () => {
    const directory = path.join(temporary, "acl");
    const writer = new VectorStoreWriter(directory, { dimension: 16 });

    await writer.open();

    for (let i = 0; i < 20; i += 1) {
      await writer.add({ ...chunkFor(`c${i}`), secret: i < 10 }, randomVector(16));
    }

    await writer.close();

    const store = await VectorStore.load(directory);
    const hits = store.search(randomVector(16), { k: 10, isAllowed: (chunk) => !chunk.secret });

    // filtering after the fact would let a forbidden chunk take a slot and then
    // be dropped, silently shortening the result set.
    assert.equal(hits.length, 10);
    assert.ok(hits.every((hit) => !hit.id.match(/^c[0-9]$/)));
  });
});
