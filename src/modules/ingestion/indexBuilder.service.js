// builds the index end to end, at corpus scale.
//
//   files -> extract -> chunk -> classify + acl -> enforce schema -> embed -> write
//
// the first version of this file did each stage over the WHOLE corpus before
// starting the next: extract everything, chunk everything, embed everything,
// then write. that is much easier to read, and on 2,301 pdfs it dies. holding
// 283k chunks plus 283k embeddings as javascript arrays is several gigabytes
// before node's own overhead, and the embeddings arrive as arrays of doubles --
// 8 bytes per dimension, 2.3 GB on their own.
//
// so this version streams. one file is extracted, chunked, embedded and written
// before the next is opened, and nothing bigger than one file's chunks is ever
// live. peak memory is flat regardless of corpus size.
//
// and because a full build is measured in hours, it checkpoints. every file
// that finishes is recorded; re-running after a crash, a reboot or a closed
// laptop lid picks up where it stopped instead of starting again.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { retrievalConfig } from "../../config/retrieval.config.js";
import { VectorStoreWriter } from "../../infrastructure/vector/vectorStore.service.js";
import { NO_PROGRAM, grantsForDocument } from "../../shared/constants/accessControl.js";
import { buildBm25 } from "../retrieval/bm25.service.js";
import {
  chunkDocument,
  chunkImages,
  chunkRecords,
  chunkSlides,
  chunkTables,
  chunkVideo,
} from "./chunking.service.js";
import { embedTexts } from "./embedding.service.js";
import { docIdFor, extractFile, listIngestableFiles } from "./extraction.service.js";
import {
  SCHEMA_VERSION,
  classifyDocument,
  contentHash,
  enforceSchema,
  extractAuthors,
  normaliseDate,
} from "./metadata.service.js";

const STATE_FILE = ".build-state.json";

// a single pdf larger than this is almost always a scanned image dump -- a few
// hundred megabytes that yields either nothing or a wall of ocr noise. the
// largest in the partner corpus is 306 MB. we skip and name them rather than
// spending ten minutes each and possibly exhausting memory on one file.
const MAX_FILE_BYTES = 80 * 1024 * 1024;

// which column holds the date a row is ABOUT, in preference order.
const DATE_COLUMNS = ["match_date", "Date", "date", "tournament_start_date", "event_date"];

function pickDateColumns(headers = []) {
  return DATE_COLUMNS.filter((column) => headers.includes(column));
}

/**
 * takes the first candidate that actually parses.
 *
 * a column existing is not the same as it being populated -- the partner's
 * match csv carries `match_date` on every row with the value "Not available".
 */
function firstUsableDate(candidates = []) {
  for (const candidate of candidates) {
    const iso = normaliseDate(candidate);

    if (iso) return iso;
  }

  return null;
}

/**
 * pulls a publication year out of front matter.
 *
 * bounded on purpose: an unbounded \d{4} matches sample sizes, page numbers and
 * equipment model numbers, and you end up dating a 2022 paper to 1024 because
 * that was a buffer size in the methods section.
 */
function guessPublicationYear(text) {
  const years = [...String(text).matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((match) => Number(match[1]));

  return years.length === 0 ? null : Math.max(...years);
}

// ---------------------------------------------------------------------------
// one file -> chunks
// ---------------------------------------------------------------------------

function finalise(chunk, classification, problems) {
  const complete = {
    ...chunk,
    // used by the generation layer to drop near-duplicate passages before they
    // reach the model. see generation/contextOrdering.service.js.
    content_hash: contentHash(chunk.text),
    data_domain: classification.domain,
    sensitivity: classification.sensitivity,
    program: classification.program,
    acl_groups: grantsForDocument(classification),
  };

  const { valid, problems: found } = enforceSchema(complete, { strict: false });

  if (!valid) problems.push({ chunkId: complete.chunk_id, problems: found });

  return valid ? complete : null;
}

async function prepareFile(filePath, problems) {
  const extracted = await extractFile(filePath);

  if (!extracted) return [];

  const ingestedAt = new Date().toISOString();

  if (extracted.kind === "records") {
    const dateColumns = pickDateColumns(extracted.headers);
    const label = extracted.sourceType === "ranking_data" ? "Ranking record" : "Match record";
    const classification = classifyDocument({
      sourceType: extracted.sourceType,
      fileName: path.basename(filePath),
    });

    return chunkRecords(extracted, { label, eventDateColumns: dateColumns })
      .map((chunk) => {
        const { raw_event_candidates: rawDates, ...rest } = chunk;

        return finalise(
          {
            ...rest,
            source_type: extracted.sourceType,
            provenance: "partner",
            authors: [],
            event_date: firstUsableDate(rawDates),
            publication_year: null,
            entity_ids: [],
            source_uri: filePath,
            file_name: extracted.fileName ?? path.basename(filePath),
            ingested_at: ingestedAt,
          },
          classification,
          problems,
        );
      })
      .filter(Boolean);
  }

  if (extracted.kind === "images") {
    // captions describe partner material, so they inherit the same internal
    // classification the source decks carry rather than defaulting to public.
    const classification = { domain: "performance", sensitivity: "internal", program: NO_PROGRAM };

    return chunkImages(extracted)
      .map((chunk) =>
        finalise(
          {
            ...chunk,
            source_type: "image",
            provenance: "partner",
            authors: [],
            event_date: null,
            publication_year: null,
            entity_ids: [],
            source_uri: chunk.image_path ?? filePath,
            file_name: extracted.fileName ?? path.basename(filePath),
            ingested_at: ingestedAt,
          },
          classification,
          problems,
        ),
      )
      .filter(Boolean);
  }

  if (extracted.kind === "video") {
    const classification = { domain: "performance", sensitivity: "internal", program: NO_PROGRAM };

    return chunkVideo(extracted)
      .map((chunk) =>
        finalise(
          {
            ...chunk,
            source_type: "video",
            provenance: "partner",
            authors: [],
            event_date: null,
            publication_year: null,
            entity_ids: [],
            // the recording, not the manifest that describes it.
            source_uri: chunk.media_path ?? filePath,
            file_name: extracted.fileName ?? path.basename(filePath),
            ingested_at: ingestedAt,
          },
          classification,
          problems,
        ),
      )
      .filter(Boolean);
  }

  if (extracted.kind === "slides") {
    const titleSlide = extracted.slides[0]?.text ?? "";
    const authors = extractAuthors(titleSlide);
    const publicationYear = guessPublicationYear(titleSlide);
    const classification = classifyDocument({
      sourceType: extracted.sourceType,
      fileName: path.basename(filePath),
      text: extracted.slides.slice(0, 6).map((slide) => slide.text).join(" ").slice(0, 4000),
    });

    return chunkSlides(extracted, {
      authors,
      eventDate: publicationYear ? `${publicationYear}-01-01` : null,
    })
      .map((chunk) =>
        finalise(
          {
            ...chunk,
            source_type: extracted.sourceType,
            provenance: "partner",
            authors,
            event_date: publicationYear ? `${publicationYear}-01-01` : null,
            publication_year: publicationYear,
            entity_ids: [],
            source_uri: filePath,
            file_name: extracted.fileName ?? path.basename(filePath),
            ingested_at: ingestedAt,
          },
          classification,
          problems,
        ),
      )
      .filter(Boolean);
  }

  const frontMatter = extracted.pages[0] ?? "";
  const authors = extractAuthors(frontMatter);
  const publicationYear = guessPublicationYear(frontMatter.slice(0, 3000));
  const eventDate = publicationYear ? `${publicationYear}-01-01` : null;
  const classification = classifyDocument({
    sourceType: extracted.sourceType,
    fileName: path.basename(filePath),
    text: frontMatter,
  });

  // prose and tables are chunked by different rules and then finalised
  // identically. tables only ever appear on scanned documents that have been
  // through Textract (TENISE-12); every other document contributes an empty
  // array here and the behaviour is unchanged.
  const documentChunks = [
    ...chunkDocument(extracted, { authors, eventDate }),
    ...chunkTables(extracted, { authors, eventDate }),
  ];

  return documentChunks
    .map((chunk) =>
      finalise(
        {
          ...chunk,
          source_type: extracted.sourceType,
          provenance: "partner",
          authors,
          event_date: eventDate,
          publication_year: publicationYear,
          entity_ids: [],
          source_uri: filePath,
          file_name: extracted.fileName ?? path.basename(filePath),
          ingested_at: ingestedAt,
          // stamped on every chunk of a locally seeded document, prose and
          // tables alike. chunkTables marks its output ocr_engine:"textract",
          // which is a claim these chunks cannot make -- their cells were
          // invented. the shards are append-only, so a synthetic chunk that
          // reaches the index cannot be taken out again without a full rebuild;
          // this flag is what lets buildIndex refuse it before that happens.
          ...(extracted.synthetic === true ? { synthetic: true } : {}),
        },
        classification,
        problems,
      ),
    )
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// checkpointing
// ---------------------------------------------------------------------------

/**
 * identifies the settings an index was built under.
 *
 * resuming a build with a different model or chunk size would interleave
 * vectors from two different embedding spaces in one file. the result loads
 * fine, searches fine, and returns quiet nonsense -- so a changed fingerprint
 * refuses to resume rather than trying to cope.
 */
function configFingerprint() {
  return [
    `schema:${SCHEMA_VERSION}`,
    `provider:${retrievalConfig.embedding.provider}`,
    `model:${retrievalConfig.embedding.model}`,
    `dim:${retrievalConfig.embedding.dimension}`,
    `chunk:${retrievalConfig.chunking.targetChars}/${retrievalConfig.chunking.overlapChars}`,
    `contextual:${retrievalConfig.contextual.enabled ? retrievalConfig.contextual.mode : "off"}`,
  ].join("|");
}

async function readState(directory) {
  try {
    return JSON.parse(await fsp.readFile(path.join(directory, STATE_FILE), "utf8"));
  } catch {
    return null;
  }
}

async function writeState(directory, state) {
  // written to a temp file and renamed, because rename is atomic. writing in
  // place means a crash midway through leaves a half-written json file, and the
  // next run cannot resume at all -- which is the one moment resume matters.
  const temporary = path.join(directory, `${STATE_FILE}.tmp`);

  await fsp.writeFile(temporary, JSON.stringify(state, null, 2));
  await fsp.rename(temporary, path.join(directory, STATE_FILE));
}

// ---------------------------------------------------------------------------
// the build
// ---------------------------------------------------------------------------

/**
 * refuses to append to an index built under different settings.
 *
 * the same danger `configFingerprint` guards against on resume, at the one
 * other place vectors can be added to an existing file. two embedding spaces
 * interleaved in one index is the worst failure mode this system has: it loads
 * without complaint, searches without error, and returns quiet nonsense that
 * looks exactly like a bad retrieval result. there is no symptom to notice.
 *
 * the model and the dimension are non-negotiable. the chunking and contextual
 * settings are checked too -- they do not corrupt the vector space, but they do
 * mean the appended chunks were built to a different recipe than the rest, and
 * silently mixing them makes an evaluation compare two things at once.
 */
async function assertAppendCompatible(outputDir, existing) {
  const mismatches = [];
  const check = (label, was, now) => {
    if (JSON.stringify(was) !== JSON.stringify(now)) {
      mismatches.push(`  ${label}: index has ${JSON.stringify(was)}, this run would use ${JSON.stringify(now)}`);
    }
  };

  check("embedding model", existing.embeddingModel, retrievalConfig.embedding.model);
  check("embedding provider", existing.embeddingProvider, retrievalConfig.embedding.provider);
  check("dimension", existing.dimension, retrievalConfig.embedding.dimension);
  check("schema version", existing.schemaVersion, SCHEMA_VERSION);
  check("chunking", existing.chunking, {
    targetChars: retrievalConfig.chunking.targetChars,
    overlapChars: retrievalConfig.chunking.overlapChars,
    minChars: retrievalConfig.chunking.minChars,
  });
  check(
    "contextual headers",
    existing.contextual,
    retrievalConfig.contextual.enabled ? retrievalConfig.contextual.mode : "off",
  );

  if (mismatches.length > 0) {
    throw new Error(
      `cannot append to the index at ${outputDir} -- it was built with different settings:\n` +
        `${mismatches.join("\n")}\n` +
        `appending would put vectors from two different embedding spaces in one index, which ` +
        `loads fine, searches fine, and returns nonsense.\n` +
        `either restore the settings above, or rebuild the whole index from scratch.`,
    );
  }
}

/**
 * the doc_ids already written into an index.
 *
 * needed because appending is the one operation with no other way to tell that
 * a document is already there. a full build has its checkpoint; a resume has
 * the same. an append deliberately ignores both -- the checkpoint belongs to
 * some earlier build and treating its file list as "done" would skip files this
 * run was asked to add -- which left nothing at all standing between running
 * the same command twice and a second copy of every chunk in the index.
 *
 * that failure was silent. the index still loaded, still searched, and only
 * showed up as a quietly inflated chunk count, skewed bm25 document
 * frequencies, and the same passage retrieved twice.
 *
 * read with a regex rather than JSON.parse per line. this walks every chunk
 * file -- ~185 MB on the current corpus -- and parsing all of it to reach one
 * field would add real time to a command whose whole purpose is being faster
 * than a rebuild. doc_id is sanitised to [A-Za-z0-9._-] by docIdFor, so it can
 * never contain a character JSON would escape and the match is exact. any line
 * the regex misses falls back to a parse rather than being silently dropped.
 */
async function indexedDocIds(outputDir, manifest) {
  const found = new Set();

  for (const shard of manifest.shards ?? []) {
    const chunkFile = path.join(outputDir, `chunks-${String(shard.index).padStart(3, "0")}.jsonl`);

    let stream;

    try {
      stream = readline.createInterface({
        input: fs.createReadStream(chunkFile),
        crlfDelay: Infinity,
      });
    } catch {
      continue;
    }

    for await (const line of stream) {
      if (line === "") continue;

      const match = line.match(/"doc_id":"([A-Za-z0-9._-]*)"/);

      if (match) {
        found.add(match[1]);
        continue;
      }

      try {
        const { doc_id: docId } = JSON.parse(line);

        if (docId) found.add(docId);
      } catch {
        // a truncated final line, which is what a crashed build leaves behind.
        // VectorStore.load reports that properly; here it is just one id we
        // cannot read, and treating it as absent is the safe direction.
      }
    }
  }

  return found;
}

export async function buildIndex({
  sourceDirs,
  outputDir = retrievalConfig.index.dir,
  resume = true,
  // adds to an index that is already finished, rather than building one.
  //
  // this exists because there is otherwise no way to index two new files. the
  // checkpoint is deleted when a build completes, so re-running is a FULL
  // rebuild: 2,599 files re-embedded over several hours to add two documents.
  // the writer could already continue after existing shards -- it does exactly
  // that on resume -- and bm25 is rebuilt from everything on disk in a second
  // pass regardless, so appending needed a flag rather than a new code path.
  append = false,
  // lets chunks from a locally seeded cache entry into the index. off by
  // default and deliberately awkward to reach -- see the refusal in the file
  // loop for why an accident here is not recoverable.
  allowSynthetic = false,
  onProgress = () => {},
}) {
  const files = [];

  for (const directory of sourceDirs) files.push(...(await listIngestableFiles(directory)));

  if (files.length === 0) {
    throw new Error(
      `no readable files under ${sourceDirs.join(", ")}. supported: pdf, pptx, csv, xlsx, txt, md, json.`,
    );
  }

  const fingerprint = configFingerprint();

  // in append mode the checkpoint is deliberately not consulted. a leftover
  // state file belongs to some earlier full build, and treating its file list
  // as "already done" would skip files this run was asked to add.
  const previous = append ? null : await readState(outputDir);

  let existingManifest = null;

  if (append) {
    try {
      existingManifest = JSON.parse(
        await fsp.readFile(path.join(outputDir, "manifest.json"), "utf8"),
      );
    } catch {
      throw new Error(
        `--append was given but there is no readable index at ${outputDir}. ` +
          `build one first, without --append.`,
      );
    }

    await assertAppendCompatible(outputDir, existingManifest);

    onProgress({
      phase: "append",
      chunks: existingManifest.chunkCount,
      files: existingManifest.fileCount,
    });
  }

  let done = new Set();
  let appending = append;

  if (resume && previous) {
    if (previous.fingerprint !== fingerprint) {
      throw new Error(
        `an unfinished build exists at ${outputDir}, but it used different settings:\n` +
          `  was:  ${previous.fingerprint}\n  now:  ${fingerprint}\n` +
          `resuming would mix vectors from two different embedding spaces into one index, ` +
          `which searches without error and returns nonsense.\n` +
          `either restore the old settings, or delete ${outputDir} and rebuild.`,
      );
    }

    done = new Set(previous.filesDone ?? []);
    appending = done.size > 0;

    if (appending) onProgress({ phase: "resume", filesDone: done.size, chunks: previous.chunkCount ?? 0 });
  }

  let pending = files.filter((file) => !done.has(file));

  // an append must not re-add what is already there. the shards are append-only
  // -- there is no way to replace a document's chunks in place -- so the only
  // correct action for one already indexed is to leave it alone and say so.
  if (append) {
    const already = await indexedDocIds(outputDir, existingManifest);
    const duplicates = pending.filter((file) => already.has(docIdFor(file)));

    for (const file of duplicates) {
      onProgress({ phase: "duplicate", file: path.basename(file) });
    }

    pending = pending.filter((file) => !already.has(docIdFor(file)));

    // refusing BEFORE the writer opens matters. going ahead with nothing to add
    // would rebuild bm25 over the whole corpus and rewrite the manifest to
    // achieve exactly nothing -- churning ~130 MB of committed files, since
    // data/index is in git.
    if (pending.length === 0) {
      throw new Error(
        `every file under ${sourceDirs.join(", ")} is already in the index at ${outputDir}:\n` +
          `${duplicates.map((file) => `  ${path.basename(file)}`).join("\n")}\n` +
          `nothing was changed.\n` +
          `if one of these documents has CHANGED, --append cannot help -- the shards are ` +
          `append-only, so its old chunks cannot be removed. rebuild the index from scratch ` +
          `instead.`,
      );
    }
  }

  onProgress({ phase: "scan", files: files.length, pending: pending.length });

  const writer = new VectorStoreWriter(outputDir, {
    dimension: retrievalConfig.embedding.dimension,
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      embeddingProvider: retrievalConfig.embedding.provider,
      embeddingModel: retrievalConfig.embedding.model,
      contextual: retrievalConfig.contextual.enabled ? retrievalConfig.contextual.mode : "off",
      chunking: retrievalConfig.chunking,
      // the union, not a replacement. an append run is pointed at one folder,
      // and overwriting the list with just that folder would erase the record
      // of where the other 2,599 files came from -- which is what the
      // structured query engine falls back to when STRUCTURED_SOURCE_DIRS is
      // unset.
      sourceDirs: [...new Set([...(existingManifest?.sourceDirs ?? []), ...sourceDirs])],
    },
  });

  await writer.open({ append: appending });

  const problems = previous?.problems ?? [];
  const skipped = previous?.skipped ?? [];

  let filesDone = done.size;
  let chunkCount = writer.count;

  for (const filePath of pending) {
    const name = path.basename(filePath);

    try {
      const stats = await fsp.stat(filePath);

      if (stats.size > MAX_FILE_BYTES) {
        skipped.push({ file: name, reason: `${(stats.size / 1048576).toFixed(0)} MB, over the size limit` });
      } else {
        const chunks = await prepareFile(filePath, problems);

        // a locally seeded document. refused by default, and refused HERE
        // rather than warned about, because the shards are append-only: once
        // invented cells are written they cannot be removed without rebuilding
        // the whole corpus, which is hours. the failure mode this prevents is
        // specific and easy to hit -- seed a document to test the pipeline,
        // forget to point INDEX_DIR somewhere scratch, and the demo index
        // permanently contains 11 tables claiming ocr_engine:"textract".
        if (chunks.some((chunk) => chunk.synthetic === true) && !allowSynthetic) {
          skipped.push({
            file: name,
            reason:
              "synthetic (seeded by textract:seed --synthetic). pass allowSynthetic, or " +
              "build into a scratch INDEX_DIR -- the shards are append-only and this " +
              "cannot be undone.",
          });

          continue;
        }

        if (chunks.length > 0) {
          const texts = chunks.map((chunk) => chunk.embedding_text ?? chunk.text);

          const vectors = await embedTexts(texts, {
            onProgress: ({ done: embedded, total }) =>
              onProgress({ phase: "embed", file: name, done: embedded, total }),
          });

          for (const [position, chunk] of chunks.entries()) {
            await writer.add(chunk, vectors[position]);
          }

          chunkCount += chunks.length;
        } else {
          skipped.push({ file: name, reason: "no usable text extracted" });
        }
      }
    } catch (error) {
      // one unreadable file out of 2,300 must not lose the other 2,299 and the
      // hours already spent on them.
      skipped.push({ file: name, reason: error.message.slice(0, 200) });
    }

    filesDone += 1;
    done.add(filePath);

    onProgress({ phase: "file", file: name, done: filesDone, total: files.length, chunks: chunkCount });

    // checkpoint periodically rather than every file: the state file lists every
    // path done so far, and rewriting a 2,300-entry json after each of 2,300
    // files is a quadratic amount of io for no benefit.
    // never in append mode: the state file's purpose is to let an interrupted
    // FULL build resume, and one written by a two-file append would tell the
    // next full build that those two files are the only ones done.
    if (!append && filesDone % 25 === 0) {
      await writeState(outputDir, {
        fingerprint,
        filesDone: [...done],
        chunkCount,
        problems: problems.slice(0, 500),
        skipped,
      });
    }
  }

  const manifest = await writer.close();

  if (chunkCount === 0) {
    throw new Error("nothing was indexed -- every file produced zero usable chunks.");
  }

  // ---- bm25, in a second pass over what was just written -------------------
  //
  // built from the written chunks rather than accumulated during the loop,
  // because the postings arrays have to be sized before they are filled and
  // that needs the final document count.
  onProgress({ phase: "bm25", chunks: chunkCount });

  const { VectorStore } = await import("../../infrastructure/vector/vectorStore.service.js");
  const store = await VectorStore.load(outputDir);

  // indexes embedding_text, not text: the contextual header has to be
  // searchable by the keyword arm too, or half the value of contextual
  // retrieval is thrown away on exactly the queries bm25 is best at.
  const bm25 = await buildBm25(
    async function* documents() {
      for (const chunk of store.chunks) {
        yield { id: chunk.chunk_id, text: chunk.embedding_text ?? chunk.text };
      }
    },
    { onProgress: (event) => onProgress({ phase: "bm25", ...event }) },
  );

  await bm25.save(outputDir);

  const finalManifest = {
    ...manifest,
    // an append run only walked its own folder, so `files.length` is the count
    // of what was added, not what the index holds. reporting the smaller number
    // would make the manifest claim the index shrank.
    fileCount: (existingManifest?.fileCount ?? 0) + files.length,
    skippedCount: skipped.length,
    schemaFailures: problems.length,
    bm25: { vocabSize: bm25.vocabSize, postings: bm25.postingCount },
  };

  await fsp.writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(finalManifest, null, 2)}\n`,
  );

  // a written record of everything that did not make it in. at this scale
  // "313 files were skipped" is not something anyone should have to discover by
  // noticing an answer is missing.
  //
  // in append mode this MERGES rather than replaces. the report is not just a
  // log -- it is the list bin/textract-pick.js reads to find the 144 scanned
  // documents this story exists to rescue. overwriting it with a two-file
  // append run's results would delete that list, and the only way to get it
  // back is a full rebuild.
  let report = { skipped, schemaProblems: problems.slice(0, 500) };

  if (append) {
    const touched = new Set(files.map((file) => path.basename(file)));
    const earlier = await fsp
      .readFile(path.join(outputDir, "build-report.json"), "utf8")
      .then((raw) => JSON.parse(raw))
      .catch(() => ({ skipped: [], schemaProblems: [] }));

    report = {
      // a file this run handled gets its new verdict; every other file keeps
      // the one it had. a document rescued by Textract therefore disappears
      // from the skipped list, which is exactly the outcome to look for.
      skipped: [...(earlier.skipped ?? []).filter((entry) => !touched.has(entry.file)), ...skipped],
      schemaProblems: [...(earlier.schemaProblems ?? []), ...problems].slice(0, 500),
    };
  }

  if (report.skipped.length > 0 || report.schemaProblems.length > 0) {
    await fsp.writeFile(
      path.join(outputDir, "build-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }

  // the checkpoint has served its purpose; leaving it behind makes the next
  // build think it is resuming a finished one.
  await fsp.rm(path.join(outputDir, STATE_FILE), { force: true });

  onProgress({ phase: "done", ...finalManifest });

  return { manifest: finalManifest, chunkCount, fileCount: files.length, skipped, problems };
}
