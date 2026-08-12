// portable vector store, built for a corpus of a few hundred thousand chunks.
//
// three things make this work at 283k chunks where the naive version did not.
//
// 1. INT8 QUANTISATION.
//    every vector is l2-normalised before storage, so each component already
//    sits in [-1, 1]. multiplying by 127 and rounding to a signed byte keeps
//    about three decimal digits of each component, which is far more than
//    ranking needs -- what matters for retrieval is the ORDER of the dot
//    products, and that survives quantisation almost perfectly (measured below
//    in `quantisationError`). the payoff is large: 1024 dims goes from 4096
//    bytes to 1024, so a 283k index drops from ~1.1 GB to ~275 MB, and the
//    scan gets faster too because four times as much of it fits in cache.
//
// 2. SHARDING.
//    github refuses files over 100 MB. shards are capped below that so the
//    whole index commits to an ordinary git repo with no lfs, no release
//    assets, and no "ask zaina for the file" step.
//
// 3. STREAMING.
//    nothing here ever holds the whole corpus in memory at once. the writer
//    appends and flushes; the reader loads vectors into one flat Int8Array
//    (compact, no per-object overhead) and chunk metadata as plain objects.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const MANIFEST_FILE = "manifest.json";

// 90 MB, comfortably under github's 100 MB hard limit with room for the warning
// threshold. at 1024 int8 dims that is ~92k vectors per shard.
const MAX_SHARD_BYTES = 90 * 1024 * 1024;

// int8 range is -128..127. we use 127 so that +1.0 and -1.0 are symmetric --
// using 128 for the negative side would make the quantisation lopsided and
// introduce a tiny directional bias into every score.
const QUANT_SCALE = 127;

export function l2Normalise(vector) {
  let sumOfSquares = 0;

  for (let i = 0; i < vector.length; i += 1) sumOfSquares += vector[i] * vector[i];

  if (sumOfSquares === 0) return vector;

  const length = Math.sqrt(sumOfSquares);

  for (let i = 0; i < vector.length; i += 1) vector[i] /= length;

  return vector;
}

/**
 * float vector -> int8, assuming the input is already normalised.
 *
 * clamped rather than wrapped. a component marginally outside [-1, 1] from
 * floating point error would otherwise wrap from +127 to -128 and turn the
 * single strongest dimension of a vector into its strongest NEGATIVE one, which
 * is the sort of bug that produces quietly terrible results.
 */
export function quantise(vector, out = new Int8Array(vector.length)) {
  for (let i = 0; i < vector.length; i += 1) {
    const scaled = Math.round(vector[i] * QUANT_SCALE);

    out[i] = scaled > 127 ? 127 : scaled < -127 ? -127 : scaled;
  }

  return out;
}

/**
 * integer dot product between a quantised query and one stored vector.
 *
 * both sides are int8, so every multiply is a small integer and the running
 * total stays well inside the safe integer range: worst case 1024 * 127 * 127 =
 * about 16.5 million.
 *
 * we do not convert back to a float scale. the divisor would be the same
 * constant for every candidate, and ranking only cares about order, so dividing
 * would cost one operation per chunk and change nothing.
 */
export function dotInt8(query, store, offset, length) {
  let sum = 0;
  let i = 0;

  // unrolled by four. this is the innermost loop in the system -- it runs once
  // per chunk per query, so 283k times.
  for (; i < length - 3; i += 4) {
    sum +=
      query[i] * store[offset + i] +
      query[i + 1] * store[offset + i + 1] +
      query[i + 2] * store[offset + i + 2] +
      query[i + 3] * store[offset + i + 3];
  }

  for (; i < length; i += 1) sum += query[i] * store[offset + i];

  return sum;
}

/**
 * how much accuracy quantisation actually costs, on real vectors.
 *
 * exposed rather than asserted in a comment so `npm run check:index` can print
 * it. "int8 is fine" is a claim; a measured cosine error on this corpus is
 * evidence, and it is the first thing a reviewer will ask about.
 */
export function quantisationError(vector) {
  const normalised = l2Normalise(Float32Array.from(vector));
  const quantised = quantise(normalised);

  let dot = 0;
  let magnitude = 0;

  for (let i = 0; i < normalised.length; i += 1) {
    const restored = quantised[i] / QUANT_SCALE;

    dot += normalised[i] * restored;
    magnitude += restored * restored;
  }

  return 1 - dot / Math.sqrt(magnitude || 1);
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

export class VectorStoreWriter {
  constructor(directory, { dimension, manifest = {} }) {
    this.directory = directory;
    this.dimension = dimension;
    this.baseManifest = manifest;
    this.count = 0;
    this.shards = [];
    this.shardIndex = -1;
    this.shardCount = 0;
    this.shardChunkBytes = 0;
    this.vectorsPerShard = Math.floor(MAX_SHARD_BYTES / dimension);
  }

  async open({ append = false } = {}) {
    await fsp.mkdir(this.directory, { recursive: true });

    if (append) {
      // resuming a build: pick up the existing shards and continue after them.
      const existing = await readManifest(this.directory).catch(() => null);

      if (existing?.shards?.length) {
        this.shards = existing.shards;
        this.count = existing.chunkCount;
        this.shardIndex = this.shards.length - 1;
        this.shardCount = this.shards[this.shardIndex].count;

        // restore the byte counter from the file on disk, or a resumed build
        // starts it at zero and lets the last shard grow past the limit.
        this.shardChunkBytes = await fsp
          .stat(this.chunkPath(this.shardIndex))
          .then((stats) => stats.size)
          .catch(() => 0);

        // reopen the last shard in append mode rather than starting a new one,
        // so a resume does not leave a trail of tiny shards.
        this.chunkStream = fs.createWriteStream(this.chunkPath(this.shardIndex), { flags: "a" });
        this.vectorStream = fs.createWriteStream(this.vectorPath(this.shardIndex), { flags: "a" });

        return;
      }
    }

    await this.rollShard();
  }

  chunkPath(index) {
    return path.join(this.directory, `chunks-${String(index).padStart(3, "0")}.jsonl`);
  }

  vectorPath(index) {
    return path.join(this.directory, `vectors-${String(index).padStart(3, "0")}.i8`);
  }

  async rollShard() {
    await this.closeStreams();

    if (this.shardIndex >= 0) {
      this.shards[this.shardIndex].count = this.shardCount;
    }

    this.shardIndex += 1;
    this.shardCount = 0;
    this.shardChunkBytes = 0;
    this.shards.push({ index: this.shardIndex, count: 0 });

    this.chunkStream = fs.createWriteStream(this.chunkPath(this.shardIndex));
    this.vectorStream = fs.createWriteStream(this.vectorPath(this.shardIndex));
  }

  async add(chunk, vector) {
    if (vector.length !== this.dimension) {
      throw new Error(
        `chunk ${chunk.chunk_id} has a ${vector.length}-dimension vector but the index is ` +
          `${this.dimension}-dimension. this nearly always means the embedding model was ` +
          `changed without rebuilding from scratch.`,
      );
    }

    // roll on WHICHEVER limit is hit first. sharding on the vector file alone
    // is not enough: at 1024 int8 dims a shard holds ~92k vectors (90 MB), but
    // 92k chunks of json text is closer to 180 MB, so chunks-000.jsonl would
    // sail past github's 100 MB limit while vectors-000.i8 sat comfortably
    // under it. the text file is the one that grows fastest, and it is the one
    // that would have broken the commit.
    if (this.shardCount >= this.vectorsPerShard || this.shardChunkBytes >= MAX_SHARD_BYTES) {
      await this.rollShard();
    }

    const quantised = quantise(l2Normalise(Float32Array.from(vector)));

    // embedding_text is context_header + text concatenated, so storing it is
    // storing the same bytes twice. at 283k chunks that is ~250 MB of pure
    // duplication, which is the difference between an index that commits and
    // one that does not. it is reconstructed on read.
    const { embedding_text: _dropped, ...stored } = chunk;

    const line = `${JSON.stringify(stored)}\n`;

    this.shardChunkBytes += Buffer.byteLength(line);

    const chunkOk = this.chunkStream.write(line);
    const vectorOk = this.vectorStream.write(Buffer.from(quantised.buffer, 0, quantised.byteLength));

    // respect backpressure, but ONLY on the stream that actually filled up.
    //
    // waiting on both is a deadlock: a stream whose buffer never filled has
    // nothing to drain, so it never emits "drain", and the build hangs forever
    // on the first chunk where one stream is full and the other is not. node
    // exits with "detected unsettled top-level await", which is a memorable
    // way to find out.
    const waits = [];

    if (!chunkOk) waits.push(once(this.chunkStream, "drain"));
    if (!vectorOk) waits.push(once(this.vectorStream, "drain"));

    if (waits.length > 0) await Promise.all(waits);

    this.count += 1;
    this.shardCount += 1;
  }

  async closeStreams() {
    const streams = [this.chunkStream, this.vectorStream].filter(Boolean);

    await Promise.all(streams.map((stream) => new Promise((resolve) => stream.end(resolve))));

    this.chunkStream = null;
    this.vectorStream = null;
  }

  async close() {
    if (this.shardIndex >= 0) this.shards[this.shardIndex].count = this.shardCount;

    await this.closeStreams();

    const manifest = {
      ...this.baseManifest,
      chunkCount: this.count,
      dimension: this.dimension,
      quantisation: "int8",
      quantScale: QUANT_SCALE,
      shards: this.shards,
      builtAt: new Date().toISOString(),
    };

    await fsp.writeFile(
      path.join(this.directory, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    return manifest;
  }
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

async function readManifest(directory) {
  return JSON.parse(await fsp.readFile(path.join(directory, MANIFEST_FILE), "utf8"));
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
    let manifest;

    try {
      manifest = await readManifest(directory);
    } catch {
      throw new Error(`no index found at ${directory}. build one first with:\n  npm run build:index`);
    }

    if (manifest.quantisation !== "int8") {
      throw new Error(
        `index at ${directory} was written by an older build (quantisation: ` +
          `${manifest.quantisation ?? "float32"}). rebuild it -- the formats are not compatible.`,
      );
    }

    const chunks = [];
    // one flat typed array for every vector across every shard. an array of
    // 283k separate Int8Arrays would add ~96 bytes of object header each, about
    // 27 MB of pure overhead, and destroy locality during the scan.
    const vectors = new Int8Array(manifest.chunkCount * manifest.dimension);

    let written = 0;

    for (const shard of manifest.shards) {
      const chunkFile = path.join(directory, `chunks-${String(shard.index).padStart(3, "0")}.jsonl`);
      const vectorFile = path.join(directory, `vectors-${String(shard.index).padStart(3, "0")}.i8`);

      const stream = readline.createInterface({
        input: fs.createReadStream(chunkFile),
        crlfDelay: Infinity,
      });

      for await (const line of stream) {
        if (line.trim() === "") continue;

        const chunk = JSON.parse(line);

        // rebuild what the embedder saw, without having stored it twice.
        chunk.embedding_text = chunk.context_header
          ? `${chunk.context_header}\n${chunk.text}`
          : chunk.text;

        chunks.push(chunk);
      }

      const raw = await fsp.readFile(vectorFile);

      vectors.set(new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength), written);
      written += raw.byteLength;
    }

    const expected = chunks.length * manifest.dimension;

    if (written !== expected) {
      throw new Error(
        `index is inconsistent: ${chunks.length} chunks x ${manifest.dimension} dims should be ` +
          `${expected} bytes but the shards hold ${written}. rebuild the index.`,
      );
    }

    return new VectorStore({ manifest, chunks, vectors });
  }

  get size() {
    return this.chunks.length;
  }

  /**
   * brute-force scan over the whole index, with the access filter applied
   * INSIDE the loop.
   *
   * still brute force at 283k chunks, and that is a considered choice rather
   * than laziness. an int8 scan of 283k x 1024 is ~290M integer multiply-adds,
   * which lands around 120-160 ms -- slower than an hnsw graph, but hnsw brings
   * an approximate recall cliff, a build step measured in hours, and a
   * dependency, to save maybe 100 ms on a request that already spends seconds
   * in the language model. revisit past a few million chunks.
   *
   * the filter runs before the dot product, not after the sort. that is not an
   * optimisation: filtering afterwards lets a forbidden chunk occupy one of the
   * k slots and then get dropped, silently shortening the result set.
   */
  search(queryVector, { k = 50, isAllowed = null } = {}) {
    const query = quantise(l2Normalise(Float32Array.from(queryVector)));

    if (query.length !== this.dimension) {
      throw new Error(
        `query vector is ${query.length}-dimension but the index is ${this.dimension}-dimension. ` +
          `the query was embedded with a different model than the index was built with.`,
      );
    }

    // a bounded min-heap would be asymptotically better, but at k=50 the
    // insertion sort below touches almost nothing: after the first few hundred
    // chunks the threshold is high enough that the vast majority of candidates
    // fail the first comparison and are skipped entirely.
    const top = [];
    let threshold = -Infinity;

    for (let i = 0; i < this.chunks.length; i += 1) {
      if (isAllowed && !isAllowed(this.chunks[i])) continue;

      const score = dotInt8(query, this.vectors, i * this.dimension, this.dimension);

      if (top.length >= k && score <= threshold) continue;

      const entry = { id: this.chunks[i].chunk_id, index: i, score };

      let position = top.length;

      while (position > 0 && top[position - 1].score < score) position -= 1;

      top.splice(position, 0, entry);

      if (top.length > k) top.pop();

      threshold = top.length >= k ? top[top.length - 1].score : -Infinity;
    }

    // ties break on id so two runs over the same index return the same list and
    // the eval harness measures retrieval quality, not iteration order.
    return top.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  }

  getChunk(index) {
    return this.chunks[index];
  }

  getChunkById(chunkId) {
    return this.chunks.find((chunk) => chunk.chunk_id === chunkId) ?? null;
  }
}

export const INDEX_FILES = Object.freeze({ MANIFEST_FILE, MAX_SHARD_BYTES, QUANT_SCALE });
