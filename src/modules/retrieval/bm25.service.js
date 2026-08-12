// bm25 keyword retrieval -- the sparse arm of the hybrid, rebuilt for scale.
//
// bm25 is a 1990s ranking function and it is still here in 2026 because it
// matches literal strings. "M-CH-AUS-2025-005", "Gescheit", "facet joint" --
// an embedding turns those into a fuzzy point in space and cheerfully returns a
// neighbouring tournament code or a different author. bm25 returns the one you
// typed. that is the whole argument for the sparse arm, and it is why
// dense-only rag fails on rare terms.
//
// why this file looks like C
// --------------------------
// the obvious implementation is Map<term, Map<docId, frequency>>. it is what
// this used to be, and it is fine for a few thousand chunks. at 283k chunks the
// corpus produces roughly 50 million postings, and a nested Map spends about
// 80-100 bytes of object and hash-table overhead on each one -- somewhere near
// 5 GB, for data whose actual content is 250 MB. node dies long before it
// finishes building.
//
// so the postings live in flat typed arrays instead, in the classic inverted
// index layout:
//
//   vocab     sorted array of terms; term id is its position
//   offsets   Int32Array, where each term's postings begin
//   docIds    Int32Array, all postings concatenated in term order
//   freqs     Uint8Array, matching term frequencies
//   docLength Int32Array, token count per document
//
// that is ~5 bytes per posting instead of ~90, and it is written to disk so
// starting the server does not re-tokenise half a gigabyte of text.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const K1 = 1.5; // term-frequency saturation. the ranking barely moves above ~1.2-2.0.
const B = 0.75; // length normalisation strength. 0.75 is the standard default.

// deliberately short. aggressive stopword lists remove words that carry meaning
// in a real query -- "load in the second block" needs "in" and "the" gone but
// "second" and "block" kept, and longer lists start eating the second kind.
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in",
  "into", "is", "it", "no", "not", "of", "on", "or", "such", "that", "the",
  "their", "then", "there", "these", "they", "this", "to", "was", "were",
  "will", "with",
]);

/**
 * splits text into searchable terms.
 *
 * hyphens, slashes and dots stay inside tokens on purpose: "M-CH-AUS-2025-005",
 * "6-2" and "p<0.05" are single meaningful handles, and splitting them turns an
 * exact lookup into a search for the number 2005.
 *
 * terms longer than 40 characters are dropped. they are almost always mangled
 * pdf extraction -- a whole line that lost its spaces -- and each one is a
 * unique vocabulary entry that will never be searched for. across 2,301 pdfs
 * they add up to a lot of index for no recall.
 */
export function tokenise(text) {
  const out = [];

  for (const token of String(text).toLowerCase().split(/[^\p{L}\p{N}\-/.]+/u)) {
    if (token.length > 1 && token.length <= 40 && !STOP_WORDS.has(token)) out.push(token);
  }

  return out;
}

// ---------------------------------------------------------------------------
// building
// ---------------------------------------------------------------------------

/**
 * builds the index in two passes over the documents.
 *
 * pass one counts, pass two fills. it looks wasteful next to a single pass that
 * grows arrays as it goes, and it is dramatically cheaper: knowing every final
 * size up front means each typed array is allocated exactly once, instead of
 * being repeatedly reallocated and copied as it doubles.
 *
 * `documents` is an async iterable of { id, text } so the caller can stream
 * from disk rather than materialising the corpus.
 */
export async function buildBm25(documentsFactory, { onProgress = null } = {}) {
  // ---- pass 1: vocabulary and document frequencies ------------------------
  const termIds = new Map(); // term -> id, only during build
  const docFreq = [];
  const termFreqTotal = [];
  const docIds = [];
  const docLengths = [];

  let seenDocs = 0;

  for await (const document of documentsFactory()) {
    const terms = tokenise(document.text);
    const counts = new Map();

    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);

    for (const [term, frequency] of counts) {
      let id = termIds.get(term);

      if (id === undefined) {
        id = docFreq.length;
        termIds.set(term, id);
        docFreq.push(0);
        termFreqTotal.push(0);
      }

      docFreq[id] += 1;
      termFreqTotal[id] += 1;
    }

    docIds.push(document.id);
    docLengths.push(terms.length);
    seenDocs += 1;

    if (onProgress && seenDocs % 5000 === 0) onProgress({ phase: "count", done: seenDocs });
  }

  const vocabSize = docFreq.length;
  const totalPostings = termFreqTotal.reduce((total, value) => total + value, 0);

  // ---- lay out the postings -----------------------------------------------
  const offsets = new Int32Array(vocabSize + 1);

  for (let id = 0; id < vocabSize; id += 1) offsets[id + 1] = offsets[id] + termFreqTotal[id];

  const postingDocs = new Int32Array(totalPostings);
  const postingFreqs = new Uint8Array(totalPostings);
  const cursor = Int32Array.from(offsets.subarray(0, vocabSize));

  // ---- pass 2: fill --------------------------------------------------------
  let docIndex = 0;

  for await (const document of documentsFactory()) {
    const counts = new Map();

    for (const term of tokenise(document.text)) counts.set(term, (counts.get(term) ?? 0) + 1);

    for (const [term, frequency] of counts) {
      const id = termIds.get(term);
      const at = cursor[id];

      postingDocs[at] = docIndex;
      // saturating at 255 loses nothing real: bm25's k1 saturation means a term
      // appearing 255 times already scores indistinguishably from 2000 times.
      postingFreqs[at] = frequency > 255 ? 255 : frequency;
      cursor[id] = at + 1;
    }

    docIndex += 1;

    if (onProgress && docIndex % 5000 === 0) onProgress({ phase: "fill", done: docIndex });
  }

  // vocabulary is written in id order; search binary-searches a sorted copy.
  const vocab = new Array(vocabSize);

  for (const [term, id] of termIds) vocab[id] = term;

  return new BM25Index({
    vocab,
    offsets,
    postingDocs,
    postingFreqs,
    docIds,
    docLengths: Int32Array.from(docLengths),
  });
}

// ---------------------------------------------------------------------------
// the index
// ---------------------------------------------------------------------------

export class BM25Index {
  constructor({ vocab, offsets, postingDocs, postingFreqs, docIds, docLengths }) {
    this.vocab = vocab;
    this.offsets = offsets;
    this.postingDocs = postingDocs;
    this.postingFreqs = postingFreqs;
    this.docIds = docIds;
    this.docLengths = docLengths;
    this.docCount = docIds.length;

    let total = 0;

    for (let i = 0; i < docLengths.length; i += 1) total += docLengths[i];

    this.averageLength = this.docCount === 0 ? 0 : total / this.docCount;

    // term -> id lookup. built once on load rather than per query. a sorted
    // array plus binary search would use less memory, but the Map is roughly
    // 60 MB at this vocabulary size and saves a comparison chain on every term
    // of every query.
    this.termIds = new Map();

    for (let id = 0; id < vocab.length; id += 1) this.termIds.set(vocab[id], id);
  }

  get vocabSize() {
    return this.vocab.length;
  }

  get postingCount() {
    return this.postingDocs.length;
  }

  /**
   * inverse document frequency -- the "how surprising is this word" part.
   *
   * the +0.5s are standard robertson smoothing. the outer +1 keeps the value
   * positive for a term appearing in more than half the corpus; without it those
   * terms score negative and actively push documents down, which is not what we
   * want from a word merely being common.
   */
  idf(termId) {
    const documentFrequency = this.offsets[termId + 1] - this.offsets[termId];

    if (documentFrequency === 0) return 0;

    return Math.log(1 + (this.docCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
  }

  /**
   * scores every document containing at least one query term.
   *
   * `isAllowed` takes a document index and is applied while scoring, for the
   * same reason as in the vector store: a chunk the caller may not see must
   * never occupy a slot in the candidate list.
   */
  search(queryText, { k = 50, isAllowed = null } = {}) {
    const terms = tokenise(queryText);

    // one dense array of scores rather than a Map. at 283k documents this is
    // 2.2 MB and gives constant-time accumulation; a Map with a few hundred
    // thousand live entries costs far more and is slower to iterate.
    const scores = new Float32Array(this.docCount);
    const touched = [];

    for (const term of terms) {
      const termId = this.termIds.get(term);

      if (termId === undefined) continue;

      const idf = this.idf(termId);
      const start = this.offsets[termId];
      const end = this.offsets[termId + 1];

      for (let at = start; at < end; at += 1) {
        const docIndex = this.postingDocs[at];

        if (isAllowed && !isAllowed(docIndex)) continue;

        const termFrequency = this.postingFreqs[at];
        const lengthNorm = 1 - B + (B * this.docLengths[docIndex]) / (this.averageLength || 1);

        if (scores[docIndex] === 0) touched.push(docIndex);

        scores[docIndex] += (idf * (termFrequency * (K1 + 1))) / (termFrequency + K1 * lengthNorm);
      }
    }

    return touched
      .map((index) => ({ id: this.docIds[index], index, score: scores[index] }))
      // ties break on id so two runs over the same index return the same list.
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
      .slice(0, k);
  }

  // -------------------------------------------------------------------------
  // persistence
  // -------------------------------------------------------------------------

  async save(directory) {
    await fsp.mkdir(directory, { recursive: true });

    const write = (name, typedArray) =>
      fsp.writeFile(
        path.join(directory, name),
        Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength),
      );

    await Promise.all([
      // \n cannot appear in a token, so it is a safe separator and this stays a
      // readable file you can grep when a search result looks wrong.
      fsp.writeFile(path.join(directory, "bm25-vocab.txt"), this.vocab.join("\n")),
      write("bm25-offsets.i32", this.offsets),
      write("bm25-docs.i32", this.postingDocs),
      write("bm25-freqs.u8", this.postingFreqs),
      write("bm25-doclen.i32", this.docLengths),
      fsp.writeFile(
        path.join(directory, "bm25-meta.json"),
        `${JSON.stringify({ docCount: this.docCount, vocabSize: this.vocab.length, postings: this.postingDocs.length }, null, 2)}\n`,
      ),
    ]);
  }

  static async load(directory, docIds) {
    const read = async (name, Type) => {
      const buffer = await fsp.readFile(path.join(directory, name));

      return new Type(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    };

    const vocabText = await fsp.readFile(path.join(directory, "bm25-vocab.txt"), "utf8");

    return new BM25Index({
      vocab: vocabText === "" ? [] : vocabText.split("\n"),
      offsets: await read("bm25-offsets.i32", Int32Array),
      postingDocs: await read("bm25-docs.i32", Int32Array),
      postingFreqs: await read("bm25-freqs.u8", Uint8Array),
      docLengths: await read("bm25-doclen.i32", Int32Array),
      docIds,
    });
  }

  static exists(directory) {
    return fs.existsSync(path.join(directory, "bm25-meta.json"));
  }
}
