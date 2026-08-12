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

import fsp from "node:fs/promises";
import path from "node:path";

import { retrievalConfig } from "../../config/retrieval.config.js";
import { VectorStoreWriter } from "../../infrastructure/vector/vectorStore.service.js";
import { NO_PROGRAM, grantsForDocument } from "../../shared/constants/accessControl.js";
import { buildBm25 } from "../retrieval/bm25.service.js";
import { chunkDocument, chunkRecords, chunkSlides, chunkVideo } from "./chunking.service.js";
import { embedTexts } from "./embedding.service.js";
import { extractFile, listIngestableFiles } from "./extraction.service.js";
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

  return chunkDocument(extracted, { authors, eventDate })
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

export async function buildIndex({
  sourceDirs,
  outputDir = retrievalConfig.index.dir,
  resume = true,
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
  const previous = await readState(outputDir);

  let done = new Set();
  let appending = false;

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

  const pending = files.filter((file) => !done.has(file));

  onProgress({ phase: "scan", files: files.length, pending: pending.length });

  const writer = new VectorStoreWriter(outputDir, {
    dimension: retrievalConfig.embedding.dimension,
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      embeddingProvider: retrievalConfig.embedding.provider,
      embeddingModel: retrievalConfig.embedding.model,
      contextual: retrievalConfig.contextual.enabled ? retrievalConfig.contextual.mode : "off",
      chunking: retrievalConfig.chunking,
      sourceDirs,
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
    if (filesDone % 25 === 0) {
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
    fileCount: files.length,
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
  if (skipped.length > 0 || problems.length > 0) {
    await fsp.writeFile(
      path.join(outputDir, "build-report.json"),
      `${JSON.stringify({ skipped, schemaProblems: problems.slice(0, 500) }, null, 2)}\n`,
    );
  }

  // the checkpoint has served its purpose; leaving it behind makes the next
  // build think it is resuming a finished one.
  await fsp.rm(path.join(outputDir, STATE_FILE), { force: true });

  onProgress({ phase: "done", ...finalManifest });

  return { manifest: finalManifest, chunkCount, fileCount: files.length, skipped, problems };
}
