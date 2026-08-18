// decides what the model actually reads, and in what order.
//
// three separate problems, all of which cost accuracy and none of which are
// fixed by better retrieval.
//
// 1. DUPLICATES. this corpus contains the same deck several times over --
//    "2024-summit-presentation-al-murphy.pptx", "-2.pptx", "-3.pptx" -- plus
//    papers filed twice under different names. retrieval correctly ranks all
//    copies highly, and the model then reads the same paragraph four times.
//    that wastes most of a small model's context window and, worse, makes a
//    claim look corroborated by four sources when it has one.
//
// 2. POSITION. language models attend most strongly to the beginning and end
//    of their context and demonstrably lose material in the middle -- the
//    "lost in the middle" effect. handing over evidence in rank order buries
//    the second- and third-best passages exactly where they are least likely
//    to be used.
//
// 3. LENGTH. an 8b model with an 8k window that is handed 12k of context
//    silently truncates, and it truncates wherever it likes -- so the chunks
//    you ranked first can be the ones that fall off.

import { retrievalConfig } from "../../config/retrieval.config.js";

// ---------------------------------------------------------------------------
// deduplication
// ---------------------------------------------------------------------------

/**
 * a cheap shingle signature of a passage.
 *
 * word-level 4-grams, hashed and sampled. two passages that share most of their
 * 4-grams are the same text even if one has an extra header line or slightly
 * different pdf extraction spacing -- which is exactly how duplicates in this
 * corpus differ from each other.
 */
function shingles(text, size = 4) {
  const words = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const set = new Set();

  for (let i = 0; i + size <= words.length; i += 1) {
    set.add(words.slice(i, i + size).join(" "));
  }

  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;

  // iterate the smaller set: the intersection cannot be bigger than it.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];

  for (const item of small) if (large.has(item)) shared += 1;

  return shared / (a.size + b.size - shared);
}

/**
 * removes near-duplicate passages, keeping the highest-ranked copy.
 *
 * the survivor records what it absorbed in `duplicateOf`, so a citation can say
 * "this also appears in three other decks" rather than silently hiding that the
 * corpus holds four copies. that is real information about how well established
 * a claim is.
 */
export function deduplicate(evidence, { threshold = 0.8 } = {}) {
  const kept = [];
  const signatures = [];

  for (const chunk of evidence) {
    const signature = shingles(chunk.text ?? "");

    let duplicateIndex = -1;

    for (let i = 0; i < signatures.length; i += 1) {
      if (jaccard(signature, signatures[i]) >= threshold) {
        duplicateIndex = i;
        break;
      }
    }

    if (duplicateIndex === -1) {
      kept.push({ ...chunk, duplicateOf: [] });
      signatures.push(signature);
    } else {
      kept[duplicateIndex].duplicateOf.push({
        chunkId: chunk.chunk_id,
        docId: chunk.doc_id,
        title: chunk.title,
      });
    }
  }

  return kept;
}

// ---------------------------------------------------------------------------
// ordering
// ---------------------------------------------------------------------------

/**
 * reorders so the strongest evidence sits at both ends.
 *
 * rank 1 goes first, rank 2 goes last, rank 3 second, rank 4 second-to-last,
 * and so on -- the weakest material ends up in the middle, which is the
 * position the model is most likely to skim. this costs nothing and is one of
 * the better-documented free wins in prompt construction.
 *
 * citation numbers are assigned AFTER this, in reading order, so the numbers a
 * coach sees ascend down the page instead of jumping around.
 */
export function orderForAttention(evidence) {
  const front = [];
  const back = [];

  evidence.forEach((chunk, index) => {
    if (index % 2 === 0) front.push(chunk);
    else back.unshift(chunk);
  });

  return [...front, ...back];
}

// ---------------------------------------------------------------------------
// compression
// ---------------------------------------------------------------------------

/**
 * drops sentences within a chunk that have nothing to do with the question.
 *
 * a 1600-character chunk usually earns its place on two or three sentences; the
 * rest is surrounding context that helped retrieval find it and does nothing for
 * generation. on a local 8b model, cutting that is the difference between
 * fitting twelve passages and fitting six.
 *
 * purely lexical, with no model call, because a compression step that costs a
 * model call per chunk is more expensive than the tokens it saves. the first
 * and last sentence are always kept -- dropping a chunk's opening tends to
 * remove the thing its pronouns refer back to.
 */
export function compress(chunk, question, { minSentences = 3, maxChars = 900 } = {}) {
  const text = String(chunk.text ?? "");

  if (text.length <= maxChars) return chunk;

  const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [text];

  if (sentences.length <= minSentences) return chunk;

  const stop = new Set(["what", "when", "which", "does", "did", "the", "and", "for", "with", "that", "from"]);
  const terms = new Set(
    String(question)
      .toLowerCase()
      .split(/[^\p{L}\p{N}-]+/u)
      .filter((word) => word.length > 3 && !stop.has(word)),
  );

  const scored = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase();

    let hits = 0;

    for (const term of terms) if (lower.includes(term)) hits += 1;

    return { sentence, index, hits, keep: index === 0 || index === sentences.length - 1 };
  });

  const chosen = scored
    .filter((item) => item.keep || item.hits > 0)
    .sort((a, b) => a.index - b.index);

  const compressed = chosen.map((item) => item.sentence.trim()).join(" ");

  // if compression barely helped, keep the original -- a marginally shorter
  // chunk is not worth the risk of having cut the sentence that mattered.
  if (compressed.length > text.length * 0.8) return chunk;

  return { ...chunk, text: compressed, compressed: true, originalChars: text.length };
}

// ---------------------------------------------------------------------------
// the pipeline
// ---------------------------------------------------------------------------

/**
 * dedupe, compress, order, renumber, and cut to fit.
 *
 * returns the evidence the model will see, with citation numbers matching the
 * order it will read them in.
 */
export function prepareEvidence(evidence, question, { maxChars = 12000, topN } = {}) {
  const deduped = deduplicate(evidence);
  const duplicatesRemoved = evidence.length - deduped.length;

  const limited = topN ? deduped.slice(0, topN) : deduped;

  const compressed = retrievalConfig.generation.compressionEnabled
    ? limited.map((chunk) => compress(chunk, question))
    : limited;

  const ordered = retrievalConfig.generation.attentionOrdering
    ? orderForAttention(compressed)
    : compressed;

  // cut to the context budget in READING order, so if anything has to go it is
  // the material already positioned as least important.
  const included = [];

  let used = 0;

  for (const chunk of ordered) {
    const cost = (chunk.text ?? "").length + 120; // + the source line

    if (used + cost > maxChars && included.length > 0) break;

    included.push(chunk);
    used += cost;
  }

  return {
    evidence: included.map((chunk, index) => ({ ...chunk, citationNumber: index + 1 })),
    duplicatesRemoved,
    compressedCount: included.filter((chunk) => chunk.compressed).length,
    droppedForLength: ordered.length - included.length,
    chars: used,
  };
}
