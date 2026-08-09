// portable vector store. three files, no server.
//
// why not qdrant / opensearch / a database
// ----------------------------------------
// the point of this story is that a teammate can clone the repo, type one
// command, and query the same corpus i queried. anything that needs a running
// server means everyone rebuilds their own index from their own machine, and
// then we are not comparing the same thing. so the index is:
//
//   data/index/manifest.json   what this index is, which model built it
//   data/index/chunks.jsonl    one json object per chunk, in index order
//   data/index/vectors.bin     raw float32, chunkCount * dimension, same order
//
// vectors.bin is a flat binary blob rather than json because json floats are
// about 9x bigger on disk and slow to parse. 7000 chunks x 1024 dims x 4 bytes
// is ~29 MB, which is fine to commit; past roughly 200 MB attach it to a github
// release instead and keep the pointer in the manifest.
//
// every vector is l2-normalised at write time, so cosine similarity is just a
// dot product and we never pay for a sqrt during search.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const MANIFEST_FILE = "manifest.json";
const CHUNKS_FILE = "chunks.jsonl";
const VECTORS_FILE = "vectors.bin";

/**
 * normalises a vector in place so its length is 1.
 *
 * a zero vector is left alone rather than divided by zero -- it will simply
 * score 0 against everything, which is the correct behaviour for a chunk whose
 * embedding failed.
 */
export function l2Normalise(vector) {
  let sumOfSquares = 0;

  for (let i = 0; i < vector.length; i += 1) {
    sumOfSquares += vector[i] * vector[i];
  }

  if (sumOfSquares === 0) return vector;

  const length = Math.sqrt(sumOfSquares);

  for (let i = 0; i < vector.length; i += 1) {
    vector[i] /= length;
  }

  return vector;
}

/**
 * dot product of two already-normalised vectors, which is their cosine
 * similarity. unrolled four at a time because this is the innermost loop in the
 * whole system -- it runs chunkCount times per query.
 */
export function dotProduct(a, b, offsetB = 0, length = a.length) {
  let sum = 0;
  let i = 0;

  for (; i < length - 3; i += 4) {
    sum +=
      a[i] * b[offsetB + i] +
      a[i + 1] * b[offsetB + i + 1] +
      a[i + 2] * b[offsetB + i + 2] +
      a[i + 3] * b[offsetB + i + 3];
  }

  for (; i < length; i += 1) {
    sum += a[i] * b[offsetB + i];
  }

  return sum;
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

export class VectorStoreWriter {
  constructor(directory, { dimension, manifest = {} }) {
    this.directory = directory;
    this.dimension = dimension;
    this.manifest = manifest;
    this.count = 0;
  }

  async open() {
    await fsp.mkdir(this.directory, { recursive: true });

    this.chunkStream = fs.createWriteStream(path.join(this.directory, CHUNKS_FILE));
    this.vectorStream = fs.createWriteStream(path.join(this.directory, VECTORS_FILE));
  }

  /**
   * appends one chunk and its vector. the two files stay in lockstep by
   * construction -- row n of chunks.jsonl always describes vector n -- which is
   * why nothing here writes an id into the binary file.
   */
  async add(chunk, vector) {
    if (vector.length !== this.dimension) {
      throw new Error(
        `chunk ${chunk.chunk_id} has a ${vector.length}-dimension vector but the ` +
          `index is ${this.dimension}-dimension. this almost always means the ` +
          `embedding model was changed without rebuilding from scratch.`,
      );
    }

    const float32 = l2Normalise(Float32Array.from(vector));

    this.chunkStream.write(`${JSON.stringify(chunk)}\n`);
    this.vectorStream.write(Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength));

    this.count += 1;
  }

  async close() {
    await Promise.all([
      new Promise((resolve) => this.chunkStream.end(resolve)),
      new Promise((resolve) => this.vectorStream.end(resolve)),
    ]);

    const manifest = {
      ...this.manifest,
      chunkCount: this.count,
      dimension: this.dimension,
      builtAt: new Date().toISOString(),
    };

    await fsp.writeFile(
      path.join(this.directory, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    return manifest;
  }
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

export class VectorStore {
  constructor({ manifest, chunks, vectors }) {
    this.manifest = manifest;
    this.chunks = chunks;
    this.vectors = vectors;
    this.dimension = manifest.dimension;
  }

  static async load(directory) {
    const manifestPath = path.join(directory, MANIFEST_FILE);

    let manifest;

    try {
      manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    } catch {
      throw new Error(
        `no index found at ${directory}. build one first with:\n  npm run build:index`,
      );
    }

    const chunks = [];
    const stream = readline.createInterface({
      input: fs.createReadStream(path.join(directory, CHUNKS_FILE)),
      crlfDelay: Infinity,
    });

    for await (const line of stream) {
      if (line.trim() !== "") chunks.push(JSON.parse(line));
    }

    const raw = await fsp.readFile(path.join(directory, VECTORS_FILE));
    // a node Buffer is not guaranteed to start at byte 0 of its backing
    // ArrayBuffer, so slice by byteOffset instead of handing the whole thing to
    // Float32Array -- getting this wrong shifts every vector by a few floats and
    // produces search results that look plausible and are entirely wrong.
    const vectors = new Float32Array(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    );

    const expected = chunks.length * manifest.dimension;

    if (vectors.length !== expected) {
      throw new Error(
        `index is inconsistent: ${chunks.length} chunks x ${manifest.dimension} dims ` +
          `should be ${expected} floats but vectors.bin holds ${vectors.length}. ` +
          `rebuild the index.`,
      );
    }

    return new VectorStore({ manifest, chunks, vectors });
  }

  get size() {
    return this.chunks.length;
  }

  /**
   * brute-force cosine search over the whole index, with the access filter
   * applied INSIDE the loop.
   *
   * two things worth saying about this.
   *
   * first, brute force is the right call at our scale. 7000 chunks x 1024 dims
   * is about 7 million multiply-adds, which is a few milliseconds. an hnsw graph
   * would be faster and approximate; at this size it would only add a dependency
   * and a recall cliff. past a few hundred thousand chunks, revisit.
   *
   * second, `isAllowed` is checked BEFORE the dot product, not after the sort.
   * that is not an optimisation. filtering after the fact lets a forbidden chunk
   * occupy one of the k slots and then get dropped, which silently shortens the
   * result set and can leave a coach with 6 results when they should have 10 --
   * the leak is invisible but the answer is worse.
   */
  search(queryVector, { k = 50, isAllowed = null } = {}) {
    const query = l2Normalise(Float32Array.from(queryVector));

    if (query.length !== this.dimension) {
      throw new Error(
        `query vector is ${query.length}-dimension but the index is ` +
          `${this.dimension}-dimension. the query was embedded with a different model.`,
      );
    }

    const hits = [];

    for (let i = 0; i < this.chunks.length; i += 1) {
      const chunk = this.chunks[i];

      if (isAllowed && !isAllowed(chunk)) continue;

      hits.push({
        id: chunk.chunk_id,
        index: i,
        score: dotProduct(query, this.vectors, i * this.dimension, this.dimension),
      });
    }

    // full sort is fine here. a heap would be asymptotically better but at 7k
    // candidates the sort is not where the time goes.
    hits.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

    return hits.slice(0, k);
  }

  getChunk(index) {
    return this.chunks[index];
  }

  getChunkById(chunkId) {
    return this.chunks.find((chunk) => chunk.chunk_id === chunkId) ?? null;
  }
}

export const INDEX_FILES = Object.freeze({ MANIFEST_FILE, CHUNKS_FILE, VECTORS_FILE });
