// E2-07: the rules the chunking evaluation scores by. all offline -- nothing
// here touches an index, a model, or the network. the content checks that need
// the corpus (is the span really in the document?) run only when
// CHUNK_EVAL_CORPUS_ROOT is set; the schema checks always run.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  CELLS,
  EVAL_INDEX_ROOT,
  SPAN_MAX_CHARS,
  SPAN_MIN_CHARS,
  TIE_BREAK_RULE,
  assertNotRealIndex,
  cellIdFor,
  classifyOutcome,
  containsSpan,
  decide,
  evalIndexDirFor,
  findSplitAcross,
  normaliseForSpan,
  parseCellId,
  spanOccurrences,
  summarise,
  validateQuestionSet,
  verifySpanInExtracted,
} from "../../src/modules/evaluation/chunkingEval.service.js";
import { extractFile } from "../../src/modules/ingestion/extraction.service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");

const questions = JSON.parse(fs.readFileSync(path.join(projectRoot, "queries/chunking_questions.json"), "utf8"));
const corpus = JSON.parse(fs.readFileSync(path.join(projectRoot, "queries/chunking_corpus.json"), "utf8"));

// ---------------------------------------------------------------------------
// 1. normalisation
// ---------------------------------------------------------------------------

describe("normaliseForSpan -- typographic variants collapse, digits do not", () => {
  const canonical = normaliseForSpan('The player\'s "best" serve - 8.00 (2.58) s');

  const variants = {
    "curly quotes": "The player’s “best” serve - 8.00 (2.58) s",
    "en dash": "The player's \"best\" serve – 8.00 (2.58) s",
    "em dash": "The player's \"best\" serve — 8.00 (2.58) s",
    "minus sign": "The player's \"best\" serve − 8.00 (2.58) s",
    "non-breaking space": "The player's \"best\" serve - 8.00 (2.58) s",
    crlf: "The player's \"best\"\r\nserve - 8.00 (2.58) s",
    "runs of whitespace": "  The   player's \"best\"\n\n serve -\t8.00 (2.58) s ",
    "upper case": "THE PLAYER'S \"BEST\" SERVE - 8.00 (2.58) S",
    "zero-width space": "The pla​yer's \"best\" serve - 8.00 (2.58) s",
  };

  for (const [name, text] of Object.entries(variants)) {
    it(`collapses ${name}`, () => {
      assert.equal(normaliseForSpan(text), canonical);
    });
  }

  it("expands ligatures", () => {
    assert.equal(normaliseForSpan("ﬁtness proﬁle"), "fitness profile");
  });

  it("does NOT collapse a differing digit", () => {
    assert.notEqual(normaliseForSpan("was 8.00 (2.58) s"), normaliseForSpan("was 8.00 (2.53) s"));
  });

  it("does NOT strip punctuation -- it is the only defence against false positives", () => {
    assert.notEqual(normaliseForSpan("score 6-2 6-0."), normaliseForSpan("score 6 2 6 0"));
  });
});

// ---------------------------------------------------------------------------
// 2. what is matched
// ---------------------------------------------------------------------------

describe("containsSpan -- matches chunk.text only", () => {
  const span = "the mean duration of points was 8.00 (2.58) s";

  it("finds the span in text", () => {
    assert.ok(containsSpan({ text: `Intro. The mean duration of points was 8.00 (2.58) s. Outro.` }, span));
  });

  it("is a MISS when the span appears only in the context header", () => {
    const chunk = {
      text: "Nothing relevant here at all.",
      context_header: `[paper | ${span}]`,
      embedding_text: `[paper | ${span}]\nNothing relevant here at all.`,
    };

    assert.equal(containsSpan(chunk, span), false);
  });

  it("is a MISS when the span appears only in embedding_text", () => {
    assert.equal(containsSpan({ text: "unrelated", embedding_text: span }, span), false);
  });
});

// ---------------------------------------------------------------------------
// 3. severed spans
// ---------------------------------------------------------------------------

describe("findSplitAcross -- anchored at the chunk boundary", () => {
  const span = "Hyperthermia, dehydration and hypoglycaemia have all been identified as common challenges";

  it("detects a span cut in two at a boundary", () => {
    const a = { chunk_id: "d#p0001_0", doc_id: "d", text: "Earlier sentence. Hyperthermia, dehydration and hypoglycaemia" };
    const b = { chunk_id: "d#p0001_1", doc_id: "d", text: "have all been identified as common challenges to performance. Later sentence." };

    const split = findSplitAcross([a, b], span);

    assert.ok(split);
    assert.equal(split.first, "d#p0001_0");
    assert.equal(split.second, "d#p0001_1");
  });

  it("returns null when the halves exist but not at the boundary", () => {
    // both halves present, both buried mid-chunk. with overlap this is the
    // normal state of affairs, and calling it a split would be meaningless.
    const a = { chunk_id: "a", doc_id: "d", text: "Start. Hyperthermia, dehydration and hypoglycaemia. Trailing words here." };
    const b = { chunk_id: "b", doc_id: "d", text: "Leading words. have all been identified as common challenges. End." };

    assert.equal(findSplitAcross([a, b], span), null);
  });

  it("does not pair chunks from different documents", () => {
    const a = { chunk_id: "a", doc_id: "one", text: "Earlier. Hyperthermia, dehydration and hypoglycaemia" };
    const b = { chunk_id: "b", doc_id: "two", text: "have all been identified as common challenges. Later." };

    assert.equal(findSplitAcross([a, b], span), null);
  });
});

// ---------------------------------------------------------------------------
// 4. the four outcomes
// ---------------------------------------------------------------------------

describe("classifyOutcome -- four fixtures, four labels", () => {
  const span = "the caffeine dose was 3 mg per kg before play";
  const hit = { chunk_id: "doc#p0002_1", doc_id: "doc", text: `Context. The caffeine dose was 3 mg per kg before play. More.` };
  const miss = { chunk_id: "other#p0001_0", doc_id: "other", text: "Something else entirely about hydration." };

  it("intact_retrieved when a top-5 chunk holds the whole span", () => {
    const result = classifyOutcome({ retrieved: [miss, miss, hit], docChunks: [hit], span });

    assert.equal(result.outcome, "intact_retrieved");
    assert.equal(result.rank, 3);
    assert.equal(result.chunkId, "doc#p0002_1");
  });

  it("intact_not_retrieved when the document has it but the top 5 do not", () => {
    const result = classifyOutcome({ retrieved: [miss, miss, miss, miss, miss, miss, hit], docChunks: [hit], span });

    assert.equal(result.outcome, "intact_not_retrieved");
    // rank 7 is kept: it counts toward recall@10 and span-mrr, not recall@5.
    assert.equal(result.rank, 7);
  });

  it("intact_not_retrieved with no rank when it is not in the top 10 either", () => {
    const result = classifyOutcome({ retrieved: [miss, miss], docChunks: [hit], span });

    assert.equal(result.outcome, "intact_not_retrieved");
    assert.equal(result.rank, null);
  });

  it("not_intact_anywhere when no single chunk of the document holds it, and records the split", () => {
    const first = { chunk_id: "doc#p0002_0", doc_id: "doc", text: "Intro. The caffeine dose was 3 mg" };
    const second = { chunk_id: "doc#p0002_1", doc_id: "doc", text: "per kg before play. Then more text." };

    const result = classifyOutcome({ retrieved: [first, second, miss], docChunks: [first, second], span });

    assert.equal(result.outcome, "not_intact_anywhere");
    assert.equal(result.rank, null);
    assert.deepEqual(result.splitAcross, { first: "doc#p0002_0", second: "doc#p0002_1", cut: result.splitAcross.cut });
  });

  it("absent when the gate said the span is not in the source, regardless of chunks", () => {
    const result = classifyOutcome({ spanInSource: false, retrieved: [hit], docChunks: [hit], span });

    assert.equal(result.outcome, "absent");
  });
});

// ---------------------------------------------------------------------------
// 5. the question set
// ---------------------------------------------------------------------------

describe("queries/chunking_questions.json -- schema", () => {
  it("passes every schema rule", () => {
    assert.deepEqual(validateQuestionSet(questions, corpus), []);
  });

  it("has fifteen questions, roughly half prose and half records", () => {
    assert.equal(questions.length, 15);
    assert.equal(questions.filter((q) => q.fileType === "prose").length, 8);
    assert.equal(questions.filter((q) => q.fileType === "records").length, 7);
  });

  it("names only documents in the corpus manifest, with a non-question distractor majority", () => {
    const asked = new Set(questions.map((q) => q.docId));
    const listed = new Set(corpus.files.map((f) => f.docId));

    for (const docId of asked) assert.ok(listed.has(docId), `${docId} not in corpus`);
    assert.ok(corpus.files.length - asked.size >= 10, "at least ten distractor documents");
  });

  it("lists no two corpus files with the same sha256", () => {
    const hashes = corpus.files.map((f) => f.sha256);

    assert.equal(new Set(hashes).size, hashes.length);
  });

  const fixtureCorpus = {
    files: [
      { docId: "paper", fileType: "prose", title: "A Paper Title About Serves" },
      { docId: "rows", fileType: "records", rowCount: 10 },
    ],
  };
  const good = {
    id: "CQ-01",
    query: "q",
    fileType: "prose",
    docId: "paper",
    answerSpan: "a perfectly ordinary answer span of reasonable length here",
    role: "admin",
  };

  it("rejects a span shorter than the minimum", () => {
    const problems = validateQuestionSet([{ ...good, answerSpan: "too short" }], fixtureCorpus);

    assert.ok(problems.some((p) => p.includes(`${SPAN_MIN_CHARS}-${SPAN_MAX_CHARS}`)));
  });

  it("rejects a span longer than overlapChars", () => {
    const problems = validateQuestionSet([{ ...good, answerSpan: "x".repeat(SPAN_MAX_CHARS + 1) }], fixtureCorpus);

    assert.ok(problems.length > 0);
  });

  it("rejects a span equal to the document title", () => {
    const problems = validateQuestionSet([{ ...good, answerSpan: "A Paper Title About Serves -- padded to the minimum length" }], fixtureCorpus);

    assert.equal(problems.length, 0, "a padded title is a different string");

    const exact = validateQuestionSet([{ ...good, answerSpan: "a paper title about serves".padEnd(40, ".") }], fixtureCorpus);

    assert.equal(exact.length, 0);

    const titled = validateQuestionSet([{ ...good, answerSpan: "A Paper Title About Serves Padded To Forty Chars" }], {
      files: [{ docId: "paper", fileType: "prose", title: "A Paper Title About Serves Padded To Forty Chars" }],
    });

    assert.ok(titled.some((p) => p.includes("title")));
  });

  it("rejects duplicate ids and duplicate spans", () => {
    const problems = validateQuestionSet([good, { ...good }], fixtureCorpus);

    assert.ok(problems.some((p) => p.includes("duplicate id")));
    assert.ok(problems.some((p) => p.includes("duplicates")));
  });

  it("requires sourceRowIndex on records questions and forbids it on prose", () => {
    const records = { ...good, id: "CQ-02", fileType: "records", docId: "rows", answerSpan: "score 6-4 6-4. best of 5 FALSE. deciding set FALSE." };

    assert.ok(validateQuestionSet([records], fixtureCorpus).some((p) => p.includes("sourceRowIndex")));
    assert.deepEqual(validateQuestionSet([{ ...records, sourceRowIndex: 3 }], fixtureCorpus), []);
    assert.ok(validateQuestionSet([{ ...records, sourceRowIndex: 10 }], fixtureCorpus).some((p) => p.includes("past")));
    assert.ok(validateQuestionSet([{ ...good, sourceRowIndex: 1 }], fixtureCorpus).some((p) => p.includes("only applies")));
  });
});

describe("verifySpanInExtracted -- the content gate on fixtures", () => {
  const prose = {
    kind: "document",
    pages: ["Page one text with nothing.", "Page two: the answer span lives here on this page.", "Page three."],
  };

  it("reports the single page a prose span is on", () => {
    assert.deepEqual(verifySpanInExtracted({ answerSpan: "the answer span lives here on this page" }, prose), { ok: true, page: 2 });
  });

  it("flags a span that is not in the document", () => {
    assert.equal(verifySpanInExtracted({ answerSpan: "not present anywhere in this document" }, prose).reason, "absent");
  });

  it("flags a span that appears on two pages", () => {
    const twice = { kind: "document", pages: ["the repeated phrase here", "and the repeated phrase here again"] };

    assert.equal(verifySpanInExtracted({ answerSpan: "the repeated phrase here" }, twice).reason, "ambiguous");
  });

  const records = {
    kind: "records",
    sourceType: "match_report",
    records: [
      { Date: "2025-01-01", score: "6-2 6-0", opponent_name: "A" },
      { Date: "2025-01-02", score: "7-5 7-5", opponent_name: "B" },
    ],
  };

  it("derives record spans through verbaliseRow, so the raw csv text is not what is matched", () => {
    assert.deepEqual(spanOccurrences(records, "score 7-5 7-5. opponent name B."), [1]);
    assert.deepEqual(spanOccurrences(records, '"7-5 7-5","B"'), []);
  });

  it("flags a records span on the wrong row", () => {
    const verdict = verifySpanInExtracted({ answerSpan: "score 7-5 7-5. opponent name B.", sourceRowIndex: 0 }, records);

    assert.equal(verdict.reason, "wrong_row");
    assert.deepEqual(verifySpanInExtracted({ answerSpan: "score 7-5 7-5. opponent name B.", sourceRowIndex: 1 }, records), { ok: true, row: 1 });
  });
});

describe("queries/chunking_questions.json -- content, against the real corpus", { skip: !process.env.CHUNK_EVAL_CORPUS_ROOT && "CHUNK_EVAL_CORPUS_ROOT not set" }, () => {
  const root = process.env.CHUNK_EVAL_CORPUS_ROOT;
  const byDocId = new Map(corpus.files.map((file) => [file.docId, file]));

  for (const question of questions) {
    it(`${question.id}: span occurs exactly once in its document`, async () => {
      const file = byDocId.get(question.docId);
      const extracted = await extractFile(path.join(root, file.relPath));

      assert.equal(verifySpanInExtracted(question, extracted).ok, true, JSON.stringify(verifySpanInExtracted(question, extracted)));
    });
  }
});

// ---------------------------------------------------------------------------
// 6. cells and the real-index guard
// ---------------------------------------------------------------------------

describe("cell ids", () => {
  it("derive from the parameters and round-trip", () => {
    assert.equal(cellIdFor({ targetChars: 1600, overlapChars: 200, rowsPerChunk: 1 }), "t1600-o200-r1");
    assert.deepEqual(parseCellId("t800-o0-r5"), { targetChars: 800, overlapChars: 0, rowsPerChunk: 5 });
  });

  it("every registered cell's id matches its params", () => {
    for (const cell of CELLS) assert.equal(cell.id, cellIdFor(cell.params));
  });

  it("registers a baseline, and challengers that vary exactly one parameter from it unless flagged as a combination", () => {
    const baseline = CELLS.find((cell) => cell.id === "t1600-o200-r1");

    assert.ok(baseline);

    for (const cell of CELLS) {
      if (cell === baseline) continue;

      const changed = Object.keys(cell.params).filter((key) => cell.params[key] !== baseline.params[key]);

      if (cell.combination) {
        // a combination cell must change MORE than one variable, or it is a
        // single-variable cell mislabelled.
        assert.ok(changed.length > 1, `${cell.id} is flagged as a combination but changes only ${changed.join(", ")}`);
      } else {
        assert.equal(changed.length, 1, `${cell.id} changes ${changed.join(", ")}`);
      }
    }
  });

  it("decide labels a multi-parameter comparison as a combination and reports both values", () => {
    const mk = (id, params) => ({
      id,
      params,
      chunkCount: 1,
      indexBytes: 1,
      byFileType: { prose: { n: 8, recall5: { k: 8, n: 8, value: 1 }, spanMrr: 0.5 } },
    });

    const d = decide({
      fileType: "prose",
      parameter: "targetChars+overlapChars",
      baseline: mk("base", { targetChars: 1600, overlapChars: 200, rowsPerChunk: 1 }),
      challenger: mk("chal", { targetChars: 800, overlapChars: 0, rowsPerChunk: 1 }),
    });

    assert.equal(d.combination, true);
    assert.equal(d.baseline.value, "1600/200");
    assert.equal(d.challenger.value, "800/0");
  });

  it("puts cell indexes under data/index-eval", () => {
    assert.equal(evalIndexDirFor("t1600-o200-r1"), path.join(EVAL_INDEX_ROOT, "t1600-o200-r1"));
  });

  it("the tie-break rule is registered as text", () => {
    assert.ok(TIE_BREAK_RULE.length >= 4);
    assert.ok(TIE_BREAK_RULE[0].includes("recall@5"));
  });
});

describe("assertNotRealIndex -- refuses, never defaults", () => {
  const options = { projectRoot };

  for (const bad of ["data/index", "data/index/", "data/index/shard", "./data/../data/index", path.join(projectRoot, "data", "index")]) {
    it(`refuses ${bad}`, () => {
      assert.throws(() => assertNotRealIndex(bad, options), /refusing/);
    });
  }

  it("refuses an unset INDEX_DIR rather than falling back", () => {
    assert.throws(() => assertNotRealIndex(undefined, options), /not set/);
    assert.throws(() => assertNotRealIndex("", options), /not set/);
  });

  for (const ok of ["data/index-eval/t1600-o200-r1", "data/index-test", "data/index-eval"]) {
    it(`accepts ${ok}`, () => {
      assert.equal(assertNotRealIndex(ok, options), path.resolve(projectRoot, ok));
    });
  }
});

// ---------------------------------------------------------------------------
// 7. summaries and decisions
// ---------------------------------------------------------------------------

describe("summarise", () => {
  const rows = [
    { id: "CQ-01", fileType: "prose", outcome: "intact_retrieved", rank: 1, docRank: 1 },
    { id: "CQ-02", fileType: "prose", outcome: "intact_not_retrieved", rank: 8, docRank: 2 },
    { id: "CQ-03", fileType: "prose", outcome: "not_intact_anywhere", rank: null, docRank: 1, splitAcross: { first: "a", second: "b" } },
    { id: "CQ-04", fileType: "prose", outcome: "absent", rank: null, docRank: null },
    { id: "CQ-05", fileType: "records", outcome: "intact_retrieved", rank: 2, docRank: 2 },
  ];

  it("excludes absent questions from the denominator", () => {
    const { prose } = summarise(rows);

    assert.equal(prose.n, 3);
    assert.deepEqual(prose.recall5, { k: 1, n: 3, value: 0.3333 });
    assert.deepEqual(prose.recall10, { k: 2, n: 3, value: 0.6667 });
    assert.equal(prose.spanMrr, Number(((1 + 1 / 8) / 3).toFixed(4)));
    assert.deepEqual(prose.docHit5, { k: 3, n: 3, value: 1 });
    assert.equal(prose.splitAcrossRetrieved, 1);
    assert.equal(prose.outcomes.absent, 0);
  });

  it("reports raw k/n beside every ratio", () => {
    const { records } = summarise(rows);

    assert.deepEqual(records.recall5, { k: 1, n: 1, value: 1 });
  });
});

describe("decide -- the pre-registered tie-break", () => {
  function cell(id, params, recall5, spanMrr, chunkCount, indexBytes) {
    return {
      id,
      params,
      chunkCount,
      chunkCountByModality: { document: chunkCount, record: 98 },
      indexBytes,
      byFileType: { prose: { n: 8, recall5: { k: Math.round(recall5 * 8), n: 8, value: recall5 }, spanMrr } },
    };
  }

  const baseParams = { targetChars: 1600, overlapChars: 200, rowsPerChunk: 1 };
  const chalParams = { targetChars: 800, overlapChars: 200, rowsPerChunk: 1 };

  it("decides on recall@5 when the gap is 10 points or more", () => {
    const d = decide({
      fileType: "prose",
      parameter: "targetChars",
      baseline: cell("base", baseParams, 0.5, 0.4, 600, 1000),
      challenger: cell("chal", chalParams, 0.75, 0.3, 1200, 2000),
    });

    assert.equal(d.winner, "chal");
    assert.equal(d.tieBrokenAt, "recall5");
    assert.equal(d.gapPp, 25);
  });

  it("falls through to span-mrr under 10 points", () => {
    const d = decide({
      fileType: "prose",
      parameter: "targetChars",
      baseline: cell("base", baseParams, 0.5, 0.45, 600, 1000),
      challenger: cell("chal", chalParams, 0.55, 0.3, 1200, 2000),
    });

    assert.equal(d.winner, "base");
    assert.equal(d.tieBrokenAt, "spanMrr");
  });

  it("then to chunk count, smaller wins", () => {
    const d = decide({
      fileType: "prose",
      parameter: "targetChars",
      baseline: cell("base", baseParams, 0.5, 0.4, 600, 1000),
      challenger: cell("chal", chalParams, 0.5, 0.42, 1200, 2000),
    });

    assert.equal(d.winner, "base");
    assert.equal(d.tieBrokenAt, "chunkCount");
  });

  it("then to index bytes, then keeps the status quo", () => {
    const bytes = decide({
      fileType: "prose",
      parameter: "targetChars",
      baseline: cell("base", baseParams, 0.5, 0.4, 600, 1000),
      challenger: cell("chal", chalParams, 0.5, 0.4, 600, 900),
    });

    assert.equal(bytes.winner, "chal");
    assert.equal(bytes.tieBrokenAt, "indexBytes");

    const tied = decide({
      fileType: "prose",
      parameter: "targetChars",
      baseline: cell("base", baseParams, 0.5, 0.4, 600, 1000),
      challenger: cell("chal", chalParams, 0.5, 0.4, 600, 1000),
    });

    assert.equal(tied.winner, "base");
    assert.equal(tied.tieBrokenAt, "status_quo");
  });
});
