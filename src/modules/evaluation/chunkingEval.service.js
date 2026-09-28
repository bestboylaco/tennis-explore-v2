// the pure part of the chunking evaluation (E2-07).
//
// everything here is a function of its arguments: no environment, no index on
// disk, no model. that is what lets test/unit/chunkingEval.test.js pin down the
// span-matching rules offline, and it is why bin/eval-chunking.js is thin --
// the harness only decides what to run, this file decides what counts.
//
// the one design decision worth reading before anything else: ground truth is
// an `answerSpan` -- a verbatim stretch of the source document -- and never a
// chunk id. chunk ids are `${docId}#p{page}_{pieceIndex}`, and a change to
// targetChars renumbers every piece, so an id that meant "the right chunk"
// under one setting means "some other text" under the next. a span survives
// that because the harness re-derives, per setting, which chunk holds it.

import path from "node:path";

import { verbaliseRow } from "../ingestion/chunking.service.js";

// ---------------------------------------------------------------------------
// the matrix, and the rules registered before any number was looked at
// ---------------------------------------------------------------------------

/**
 * the four builds. targetChars never reaches chunkRecords (it never calls
 * splitText) and rowsPerChunk never reaches chunkDocument, so the cells
 * factorise: four builds buy three comparisons plus one free control.
 */
export const CELLS = Object.freeze([
  {
    id: "t1600-o200-r1",
    params: { targetChars: 1600, overlapChars: 200, rowsPerChunk: 1 },
    purpose: "status quo baseline for BOTH prose and records",
    rationale:
      "the committed data/index was built with exactly these values, so every other cell is " +
      "measured as a change from what is live.",
  },
  {
    id: "t800-o200-r1",
    params: { targetChars: 800, overlapChars: 200, rowsPerChunk: 1 },
    purpose: "prose challenger (targetChars) AND the deterministic control for records",
    rationale:
      "halving is the largest single-axis step at which the sentence splitter still works " +
      "comfortably; ~800 chars is ~200 tokens, where most RAG literature converges. minChars " +
      "stays at 120. because targetChars never reaches chunkRecords, the record chunks in this " +
      "cell are byte-identical to the baseline's, so the record questions here are a control: a " +
      "different record chunk holding the span would mean the harness, not the chunking, moved.",
  },
  {
    id: "t1600-o0-r1",
    params: { targetChars: 1600, overlapChars: 0, rowsPerChunk: 1 },
    purpose: "overlap challenger",
    rationale:
      "directly tests the claim in retrieval.config.js that overlap has no measurable retrieval " +
      "benefit -- turning a cited finding into a measurement on our own corpus, and it is the " +
      "cheapest cell to build. known confound: minChars is applied AFTER the overlap tail is " +
      "prepended (chunking.service.js splitText, the withOverlap filter), so a short trailing " +
      "fragment that survives at overlap=200 is dropped at overlap=0. the cell therefore biases " +
      "AGAINST overlap=0 by removing content rather than by failing to retrieve it.",
  },
  {
    id: "t1600-o200-r5",
    params: { targetChars: 1600, overlapChars: 200, rowsPerChunk: 5 },
    purpose: "records challenger (rowsPerChunk)",
    rationale:
      "one row per chunk lets a single csv flood the candidate pool with near-identical " +
      "neighbours and crowd prose out. five rather than three because fifteen questions cannot " +
      "resolve a three-row difference; five rather than twenty because each row is capped at " +
      "1400 chars. known cost: a packed chunk carries ONE event_date (the first row's) and that " +
      "date drives query-time filtering; event_date_span records the real range it covers.",
  },
  {
    id: "t800-o0-r1",
    params: { targetChars: 800, overlapChars: 0, rowsPerChunk: 1 },
    // TWO variables change against the baseline. this is not a fourth
    // single-variable comparison and must not be read as one.
    combination: true,
    purpose: "combination check: both prose winners together",
    rationale:
      "the first run's two prose challengers each beat the baseline on span-MRR while varying one " +
      "variable apiece. adopting both as the live default would mean building an index nobody had " +
      "measured, so this cell measures it. it answers only 'do the two gains survive together'; " +
      "attribution to either variable comes from the single-variable cells, not from this one. the " +
      "minChars confound compounds here: 800 chars with no overlap tail drops the most short " +
      "fragments of any cell, so chunk count and not_intact_anywhere should be read alongside the scores.",
  },
]);

/**
 * pre-registered. recorded as strings in the output json so the report can
 * show the rule was fixed before any cell was scored.
 */
export const TIE_BREAK_RULE = Object.freeze([
  "1. span recall@5 (a hit is a single top-5 chunk whose `text` wholly contains the normalised span).",
  "2. if the recall@5 gap is under 10 percentage points, compare span-MRR (reciprocal rank of the " +
    "first top-10 chunk containing the span), again with a 10-point threshold.",
  "3. if still under 10 points, compare index cost for that file type: chunk count first, then " +
    "total index bytes; the smaller wins.",
  "4. if still tied, keep the status quo setting -- shards are append-only and changing a live " +
    "default means rebuilding everything.",
  "n=15 means one question is 6.7 points, so the 10-point threshold is 1.5 questions and the " +
    "tie-break will fire often. this harness measures direction, not effect size: a Wilson " +
    "interval at n=15 is roughly +/-25 points.",
]);

export const DECISION_GAP_PP = 10;

export const OUTCOMES = Object.freeze([
  "intact_retrieved",
  "intact_not_retrieved",
  "not_intact_anywhere",
  "absent",
]);

// ---------------------------------------------------------------------------
// cells and index directories
// ---------------------------------------------------------------------------

export const EVAL_INDEX_ROOT = "data/index-eval";
export const REAL_INDEX_DIR = "data/index";

export function cellIdFor({ targetChars, overlapChars, rowsPerChunk }) {
  return `t${targetChars}-o${overlapChars}-r${rowsPerChunk}`;
}

export function parseCellId(id) {
  const match = /^t(\d+)-o(\d+)-r(\d+)$/.exec(String(id));

  if (!match) throw new Error(`"${id}" is not a cell id of the form t<target>-o<overlap>-r<rows>`);

  return {
    targetChars: Number(match[1]),
    overlapChars: Number(match[2]),
    rowsPerChunk: Number(match[3]),
  };
}

export function evalIndexDirFor(cellId, root = EVAL_INDEX_ROOT) {
  return path.join(root, cellId);
}

/**
 * refuses -- does not default, refuses -- any index directory that is, or sits
 * inside, the real committed index. a default is exactly how data/index was
 * overwritten on 2026-08-28 (see bin/build-index-test.js).
 */
export function assertNotRealIndex(indexDir, { projectRoot = process.cwd(), realIndexDir = REAL_INDEX_DIR } = {}) {
  if (typeof indexDir !== "string" || indexDir.trim() === "") {
    throw new Error("INDEX_DIR is not set. the chunking evaluation never falls back to a default index directory.");
  }

  const resolved = path.resolve(projectRoot, indexDir);
  const real = path.resolve(projectRoot, realIndexDir);
  const relative = path.relative(real, resolved);

  // windows paths compare case-insensitively; path.relative already handles
  // that on win32, and on posix a differently-cased path is a different path.
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (inside) {
    throw new Error(
      `refusing to use ${resolved}: it is the real index (${real}) or inside it. ` +
        `the chunking evaluation only writes under ${EVAL_INDEX_ROOT}/<cellId>.`,
    );
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// span normalisation and matching
// ---------------------------------------------------------------------------

/**
 * both sides of every comparison go through this.
 *
 * NFKC handles ligatures (fi -> fi), non-breaking spaces and full-width forms;
 * the explicit replacements cover the dash and quote variants NFKC leaves
 * alone. punctuation and digits are deliberately KEPT: punctuation is the only
 * defence against false positives, and the digits are usually the answer.
 */
export function normaliseForSpan(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[​-‍﻿⁠­]/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function spanInText(text, span) {
  const needle = normaliseForSpan(span);

  if (needle === "") return false;

  return normaliseForSpan(text).includes(needle);
}

/**
 * matches against `chunk.text` ONLY. the context header is something we
 * synthesised; it is not evidence from the document, and a span that only
 * appears there was retrieved for free.
 */
export function containsSpan(chunk, span) {
  return spanInText(chunk?.text, span);
}

/**
 * finds a span cut in two across a chunk boundary, anchored: `a` must END with
 * the first part and `b` must START with the rest. matching the halves
 * anywhere would only prove each half exists somewhere, which with overlap is
 * almost always true.
 *
 * with overlap on and the span shorter than the overlap, a span straddling a
 * boundary is carried whole into the next chunk, so this only ever fires for
 * real severing -- which is exactly the failure overlapChars=0 is expected to
 * produce.
 */
export function findSplitAcross(chunks, span, { minHalfChars = 8 } = {}) {
  const needle = normaliseForSpan(span);

  if (needle.length < minHalfChars * 2) return null;

  const texts = chunks.map((chunk) => normaliseForSpan(chunk?.text));

  for (let i = 0; i < chunks.length; i += 1) {
    for (let j = 0; j < chunks.length; j += 1) {
      if (i === j) continue;
      if (chunks[i]?.doc_id && chunks[j]?.doc_id && chunks[i].doc_id !== chunks[j].doc_id) continue;

      for (let cut = minHalfChars; cut <= needle.length - minHalfChars; cut += 1) {
        const head = needle.slice(0, cut).trimEnd();
        const tail = needle.slice(cut).trimStart();

        if (head.length < minHalfChars || tail.length < minHalfChars) continue;

        if (texts[i].endsWith(head) && texts[j].startsWith(tail)) {
          return { first: chunks[i].chunk_id ?? i, second: chunks[j].chunk_id ?? j, cut };
        }
      }
    }
  }

  return null;
}

/**
 * one (question, cell) -> one of four outcomes.
 *
 *   intact_retrieved      a top-k chunk wholly contains the span. the hit.
 *   intact_not_retrieved  some chunk of the document contains it; none in the
 *                         top k did. an honest retrieval failure.
 *   not_intact_anywhere   no single chunk of the document contains the whole
 *                         span. chunking severed it.
 *   absent                the span is not in the source document at all. the
 *                         ground truth is wrong, and this question must leave
 *                         every cell's denominator -- otherwise one typo
 *                         scores zero everywhere and quietly drags every
 *                         number down.
 *
 * `spanInSource` comes from the extraction gate, not from the chunks: whether
 * the span exists in the document is a property of the document, and it is
 * decided before any index is built.
 */
export function classifyOutcome({ spanInSource = true, retrieved = [], docChunks = [], span, k = 5 }) {
  if (spanInSource === false) {
    return { outcome: "absent", rank: null, chunkId: null, splitAcross: null };
  }

  const rankIndex = retrieved.findIndex((chunk) => containsSpan(chunk, span));
  const rank = rankIndex === -1 ? null : rankIndex + 1;
  const chunkId = rank === null ? null : (retrieved[rankIndex].chunk_id ?? null);

  if (rank !== null && rank <= k) {
    return { outcome: "intact_retrieved", rank, chunkId, splitAcross: null };
  }

  const splitAcross = findSplitAcross(retrieved.slice(0, k), span);
  const intactSomewhere = rank !== null || docChunks.some((chunk) => containsSpan(chunk, span));

  if (intactSomewhere) {
    return { outcome: "intact_not_retrieved", rank, chunkId, splitAcross };
  }

  return { outcome: "not_intact_anywhere", rank: null, chunkId: null, splitAcross };
}

// ---------------------------------------------------------------------------
// the question set
// ---------------------------------------------------------------------------

export const SPAN_MIN_CHARS = 40;
// kept <= overlapChars (200) so that under any overlapping setting a span
// straddling a boundary is rescued whole by the overlap tail. a severed span
// can then be attributed to overlapChars=0 rather than to an oddly long span.
export const SPAN_MAX_CHARS = 180;

export const FILE_TYPES = Object.freeze(["prose", "records"]);

/**
 * the label prepareFile gives record rows. mirrored here rather than imported
 * because indexBuilder.service.js pulls in env.js, which insists on PORT and
 * MONGODB_URI, and this module has to load in a bare test process.
 */
export function recordLabelFor(extracted) {
  return extracted?.sourceType === "ranking_data" ? "Ranking record" : "Match record";
}

/**
 * how a record row reads inside a chunk. verbaliseRow rewrites the row --
 * `event_name` -> "event name", nulls dropped, dates normalised -- so the raw
 * csv line never appears in any chunk. a record span is therefore DERIVED from
 * this, and the question stores `sourceRowIndex` so it can be re-derived if
 * verbaliseRow ever changes. maxChars is pinned to the default every cell uses.
 */
export function verbaliseSourceRow(extracted, rowIndex) {
  const row = extracted?.records?.[rowIndex];

  if (!row) return null;

  return verbaliseRow(row, { label: recordLabelFor(extracted), maxChars: 1400 });
}

/**
 * schema checks that need nothing but the two json files. the content checks
 * (is the span really in the document, exactly once) live in
 * verifySpanInExtracted, because they need the corpus on disk.
 */
export function validateQuestionSet(questions, corpus) {
  const problems = [];
  const byDocId = new Map((corpus?.files ?? []).map((file) => [file.docId, file]));

  if (!Array.isArray(questions) || questions.length === 0) {
    return ["the question set must be a non-empty array"];
  }

  const ids = new Set();
  const spans = new Map();

  questions.forEach((question, index) => {
    const where = `question ${question?.id ?? `#${index}`}`;

    if (!/^CQ-\d{2}$/.test(String(question?.id ?? ""))) problems.push(`${where}: id must look like CQ-01`);
    if (ids.has(question?.id)) problems.push(`${where}: duplicate id`);
    ids.add(question?.id);

    if (typeof question?.query !== "string" || question.query.trim() === "") {
      problems.push(`${where}: query must be a non-empty string`);
    }

    if (!FILE_TYPES.includes(question?.fileType)) {
      problems.push(`${where}: fileType must be one of ${FILE_TYPES.join(", ")}`);
    }

    if (typeof question?.role !== "string" || question.role.trim() === "") {
      problems.push(`${where}: role must be a non-empty string`);
    }

    const file = byDocId.get(question?.docId);

    if (!file) {
      problems.push(`${where}: docId "${question?.docId}" is not in the corpus manifest`);
    } else if (file.fileType !== question?.fileType) {
      problems.push(`${where}: fileType ${question.fileType} but the corpus lists ${file.docId} as ${file.fileType}`);
    }

    const span = question?.answerSpan;

    if (typeof span !== "string") {
      problems.push(`${where}: answerSpan must be a string`);
    } else {
      if (span.length < SPAN_MIN_CHARS || span.length > SPAN_MAX_CHARS) {
        problems.push(`${where}: answerSpan is ${span.length} chars; must be ${SPAN_MIN_CHARS}-${SPAN_MAX_CHARS}`);
      }

      if (span !== span.trim() || /\s{2,}/.test(span)) {
        problems.push(`${where}: answerSpan must be trimmed and single-spaced (it is compared whitespace-collapsed anyway)`);
      }

      const key = normaliseForSpan(span);

      if (spans.has(key)) problems.push(`${where}: answerSpan duplicates ${spans.get(key)}`);
      spans.set(key, question?.id);

      if (file?.title && normaliseForSpan(file.title) === key) {
        problems.push(`${where}: answerSpan equals the document title -- that matches the context header, not the text`);
      }

      if (file && normaliseForSpan(file.docId) === key) problems.push(`${where}: answerSpan equals the docId`);
    }

    if (question?.fileType === "records") {
      const rowIndex = question?.sourceRowIndex;

      if (!Number.isInteger(rowIndex) || rowIndex < 0) {
        problems.push(`${where}: records questions need an integer sourceRowIndex >= 0`);
      } else if (file?.rowCount !== undefined && rowIndex >= file.rowCount) {
        problems.push(`${where}: sourceRowIndex ${rowIndex} is past the ${file.rowCount} rows the corpus lists`);
      }
    } else if (question?.sourceRowIndex !== undefined) {
      problems.push(`${where}: sourceRowIndex only applies to records questions`);
    }
  });

  return problems;
}

/**
 * every place a span occurs in one extracted document: page numbers (1-based)
 * for prose, row indexes for records.
 */
export function spanOccurrences(extracted, span) {
  if (extracted?.kind === "records") {
    return (extracted.records ?? [])
      .map((_, index) => index)
      .filter((index) => spanInText(verbaliseSourceRow(extracted, index), span));
  }

  return (extracted?.pages ?? [])
    .map((page, index) => (spanInText(page, span) ? index + 1 : null))
    .filter((page) => page !== null);
}

/**
 * the content gate, run against extractFile output before any index exists.
 * it is independent of every chunking setting and needs no network.
 *
 *   ok: false, reason: "absent"     the span is not in the document at all
 *   ok: false, reason: "ambiguous"  it is there more than once (two pages, or
 *                                   two rows) -- a hit could not be attributed
 *   ok: false, reason: "wrong_row"  records only: present, but not on the row
 *                                   the question claims
 *
 * chunkDocument chunks page by page, so a span straddling two pages can never
 * be whole in one chunk under ANY setting; "exactly one page" rules that out.
 */
export function verifySpanInExtracted(question, extracted) {
  const occurrences = spanOccurrences(extracted, question.answerSpan);

  if (occurrences.length === 0) return { ok: false, reason: "absent", occurrences };
  if (occurrences.length > 1) return { ok: false, reason: "ambiguous", occurrences };

  if (extracted?.kind === "records") {
    if (occurrences[0] !== question.sourceRowIndex) {
      return { ok: false, reason: "wrong_row", occurrences };
    }

    return { ok: true, row: occurrences[0] };
  }

  return { ok: true, page: occurrences[0] };
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

function ratio(hits, n) {
  return { k: hits, n, value: n === 0 ? null : Number((hits / n).toFixed(4)) };
}

/**
 * per-file-type figures for one cell. `absent` questions are left out of every
 * denominator; they are reported separately and loudly by the harness.
 */
export function summarise(perQuestion, { k = 5 } = {}) {
  const byFileType = {};

  for (const fileType of FILE_TYPES) {
    const rows = perQuestion.filter((row) => row.fileType === fileType && row.outcome !== "absent");
    const n = rows.length;

    const outcomes = Object.fromEntries(OUTCOMES.map((name) => [name, 0]));

    for (const row of rows) outcomes[row.outcome] += 1;

    const recallAt = (depth) => ratio(rows.filter((row) => row.rank !== null && row.rank <= depth).length, n);

    byFileType[fileType] = {
      n,
      recall5: recallAt(k),
      recall10: recallAt(10),
      spanMrr:
        n === 0
          ? null
          : Number((rows.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / n).toFixed(4)),
      docHit5: ratio(rows.filter((row) => row.docRank !== null && row.docRank <= k).length, n),
      splitAcrossRetrieved: rows.filter((row) => row.splitAcross).length,
      outcomes,
    };
  }

  return byFileType;
}

/**
 * applies TIE_BREAK_RULE to one comparison. `baseline` and `challenger` are
 * cell result objects: { id, params, byFileType, chunkCountByModality,
 * indexBytes }. `parameter` is one key of params, or several joined with "+"
 * for a combination check -- in which case the decision says which cell won,
 * not which variable did it.
 */
export function decide({ fileType, parameter, baseline, challenger }) {
  const modality = fileType === "records" ? "record" : "document";
  const b = baseline.byFileType[fileType];
  const c = challenger.byFileType[fileType];
  const keys = String(parameter).split("+");
  const valueOf = (cell) => (keys.length === 1 ? cell.params[keys[0]] : keys.map((key) => cell.params[key]).join("/"));

  const base = {
    fileType,
    parameter,
    combination: keys.length > 1,
    baseline: { cell: baseline.id, value: valueOf(baseline) },
    challenger: { cell: challenger.id, value: valueOf(challenger) },
    recall5: { baseline: b.recall5, challenger: c.recall5 },
    spanMrr: { baseline: b.spanMrr, challenger: c.spanMrr },
  };

  if (!b.n || !c.n) {
    return { ...base, winner: baseline.id, gapPp: null, tieBrokenAt: "no_data", reason: `no scored ${fileType} questions` };
  }

  const gapPp = Number(((c.recall5.value - b.recall5.value) * 100).toFixed(1));

  if (Math.abs(gapPp) >= DECISION_GAP_PP) {
    const winner = gapPp > 0 ? challenger : baseline;

    return {
      ...base,
      gapPp,
      winner: winner.id,
      tieBrokenAt: "recall5",
      reason: `span recall@5 differs by ${gapPp} points (${c.recall5.k}/${c.recall5.n} vs ${b.recall5.k}/${b.recall5.n}), at or above the ${DECISION_GAP_PP}-point threshold.`,
    };
  }

  const mrrGapPp = Number(((c.spanMrr - b.spanMrr) * 100).toFixed(1));

  if (Math.abs(mrrGapPp) >= DECISION_GAP_PP) {
    const winner = mrrGapPp > 0 ? challenger : baseline;

    return {
      ...base,
      gapPp,
      mrrGapPp,
      winner: winner.id,
      tieBrokenAt: "spanMrr",
      reason: `recall@5 gap of ${gapPp} points is under ${DECISION_GAP_PP}; span-MRR differs by ${mrrGapPp} points (${c.spanMrr} vs ${b.spanMrr}).`,
    };
  }

  const bCount = baseline.chunkCountByModality?.[modality] ?? baseline.chunkCount;
  const cCount = challenger.chunkCountByModality?.[modality] ?? challenger.chunkCount;

  if (bCount !== cCount) {
    const winner = cCount < bCount ? challenger : baseline;

    return {
      ...base,
      gapPp,
      mrrGapPp,
      winner: winner.id,
      tieBrokenAt: "chunkCount",
      reason: `recall@5 (${gapPp}) and span-MRR (${mrrGapPp}) gaps are both under ${DECISION_GAP_PP} points; ${modality} chunk count decides (${cCount} vs ${bCount}, smaller wins).`,
    };
  }

  if (baseline.indexBytes !== challenger.indexBytes) {
    const winner = challenger.indexBytes < baseline.indexBytes ? challenger : baseline;

    return {
      ...base,
      gapPp,
      mrrGapPp,
      winner: winner.id,
      tieBrokenAt: "indexBytes",
      reason: `recall@5, span-MRR and ${modality} chunk count are all tied; index bytes decide (${challenger.indexBytes} vs ${baseline.indexBytes}, smaller wins).`,
    };
  }

  return {
    ...base,
    gapPp,
    mrrGapPp,
    winner: baseline.id,
    tieBrokenAt: "status_quo",
    reason: "tied on every registered criterion; the status quo stays because shards are append-only.",
  };
}
