// bm25 keyword retrieval -- the sparse arm of the hybrid.
//
// bm25 is a 1990s ranking function and it is still here in 2026 for a reason:
// it matches literal strings. "M-CH-AUS-2025-005", "Kumasaka", "rotation
// magnitude" -- an embedding model turns those into a fuzzy point in space and
// happily returns a different tournament code that is semantically nearby. bm25
// returns the one you typed. that is the whole argument for the sparse arm, and
// it is why dense-only rag quietly fails on rare terms.
//
// implemented directly rather than pulled from npm because it is about eighty
// lines, and a dependency here would be a dependency the whole team has to
// install to run a search.

const K1 = 1.5; // term-frequency saturation. above ~1.2-2.0 the ranking barely moves.
const B = 0.75; // how hard to penalise long documents. 0.75 is the standard default.

// words so common they appear in nearly every chunk, so their idf is near zero
// and they only cost time. deliberately short -- aggressive stopword lists
// remove words that matter in a query like "load in the second block".
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in",
  "into", "is", "it", "no", "not", "of", "on", "or", "such", "that", "the",
  "their", "then", "there", "these", "they", "this", "to", "was", "were",
  "will", "with",
]);

/**
 * splits text into searchable terms.
 *
 * hyphens and slashes are kept inside tokens on purpose: "M-CH-AUS-2025-005" and
 * "6-2" are single meaningful handles, and splitting them turns an exact
 * tournament lookup into a search for the number 2005.
 */
export function tokenise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-/.]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export class BM25Index {
  constructor(documents) {
    // documents: [{ id, text }] in the same order as the vector store, so a
    // position in one is a position in the other.
    this.docIds = [];
    this.docLengths = [];
    this.postings = new Map(); // term -> Map(docIndex -> termFrequency)

    documents.forEach((doc, docIndex) => {
      const terms = tokenise(doc.text);

      this.docIds.push(doc.id);
      this.docLengths.push(terms.length);

      for (const term of terms) {
        let postingList = this.postings.get(term);

        if (!postingList) {
          postingList = new Map();
          this.postings.set(term, postingList);
        }

        postingList.set(docIndex, (postingList.get(docIndex) ?? 0) + 1);
      }
    });

    this.docCount = this.docIds.length;
    this.averageLength =
      this.docCount === 0
        ? 0
        : this.docLengths.reduce((total, length) => total + length, 0) / this.docCount;
  }

  /**
   * inverse document frequency, the "how surprising is this word" part.
   *
   * the +0.5s are the standard robertson smoothing, and the outer +1 keeps the
   * value positive for a term that appears in more than half the corpus --
   * without it those terms get a negative score and actively push documents
   * down, which is not what we want from a word merely being common.
   */
  idf(term) {
    const documentFrequency = this.postings.get(term)?.size ?? 0;

    if (documentFrequency === 0) return 0;

    return Math.log(
      1 + (this.docCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
    );
  }

  /**
   * scores every document that contains at least one query term.
   *
   * `isAllowed` takes a document index and is applied while scoring, for the
   * same reason as in the vector store: a chunk the caller may not see must
   * never occupy a slot in the candidate list.
   */
  search(queryText, { k = 50, isAllowed = null } = {}) {
    const terms = tokenise(queryText);
    const scores = new Map();

    for (const term of terms) {
      const postingList = this.postings.get(term);

      if (!postingList) continue;

      const idf = this.idf(term);

      for (const [docIndex, termFrequency] of postingList) {
        if (isAllowed && !isAllowed(docIndex)) continue;

        const lengthNorm =
          1 - B + (B * this.docLengths[docIndex]) / (this.averageLength || 1);

        const contribution =
          (idf * (termFrequency * (K1 + 1))) / (termFrequency + K1 * lengthNorm);

        scores.set(docIndex, (scores.get(docIndex) ?? 0) + contribution);
      }
    }

    return [...scores.entries()]
      .map(([index, score]) => ({ id: this.docIds[index], index, score }))
      // ties break on id so two runs over the same index return the same list.
      // without this the eval harness measures map iteration order.
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
      .slice(0, k);
  }
}
