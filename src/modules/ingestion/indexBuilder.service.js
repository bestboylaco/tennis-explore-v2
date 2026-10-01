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

import { env } from "../../config/env.js";
import { retrievalConfig } from "../../config/retrieval.config.js";
import { VectorStoreWriter } from "../../infrastructure/vector/vectorStore.service.js";
import { objectExists, putObject } from "../../infrastructure/storage/storage.service.js";
import { guessContentType, toStorageKey } from "../../infrastructure/storage/storageKey.service.js";
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
import { prepareVisualEvidence } from "./visualEvidencePreparation.service.js";
import { prepareVideoVisualEvidence } from "./videoVisualEvidence.service.js";
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

// ---------------------------------------------------------------------------
// the chunking settings an index was built under
//
// these exist because the append guard used to compare `manifest.chunking`
// against a hardcoded three-key object literal, while the manifest was written
// from `retrievalConfig.chunking` -- the WHOLE object. the two were only ever
// equal by coincidence, and adding any key to the config broke every new index's
// ability to append to itself: the manifest would hold eight keys, the guard
// would build three, and they would never match again.
//
// so both sides go through one canonicaliser instead. it fixes the key order and
// fills anything missing with the value that key had when it was still a literal
// in chunking.service.js. that is what keeps the committed 103,708-chunk index
// appendable: its manifest holds only {targetChars, overlapChars, minChars}, and
// normalising it fills in exactly the behaviour it was actually built with.
//
// IMPORTANT: a key added to retrievalConfig.chunking and not added here is not a
// compile error, it is a guard that silently stops checking that key. that is
// what test/unit/indexAppend.test.js asserts against by comparing this list to
// Object.keys(retrievalConfig.chunking).
// ---------------------------------------------------------------------------
const CHUNKING_DEFAULTS = Object.freeze({
  targetChars: 1600,
  overlapChars: 200,
  minChars: 120,
  rowsPerChunk: 1,
  recordMaxChars: 1400,
  fallbackMinChars: 40,
  slideMinChars: 40,
  tableHeadroomChars: 32,
});

export const CHUNKING_KEYS = Object.freeze(Object.keys(CHUNKING_DEFAULTS).sort());

// the keys E2-07 added. the fingerprint appends only these, and only when they
// are off their default, so an existing .build-state.json still resumes.
const NEW_CHUNKING_KEYS = Object.freeze([
  "fallbackMinChars",
  "recordMaxChars",
  "rowsPerChunk",
  "slideMinChars",
  "tableHeadroomChars",
]);

/**
 * every chunking key, in a fixed order, with missing ones filled from the
 * literals they replaced. safe to JSON.stringify and compare.
 */
export function canonicalChunking(chunking) {
  const canonical = {};

  for (const key of CHUNKING_KEYS) {
    canonical[key] = chunking?.[key] ?? CHUNKING_DEFAULTS[key];
  }

  return canonical;
}

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
 * the range of dates a packed record chunk actually covers.
 *
 * a chunk carries exactly one `event_date`, and that date drives the query-time
 * date filter. with rowsPerChunk > 1 that single date belongs to the first row
 * only, so the chunk is filed under it on behalf of rows it does not describe.
 * recording [min, max] alongside makes that visible instead of leaving it as a
 * silent inaccuracy -- when min equals max the packing cost nothing here, and
 * when it does not, the gap is exactly the error being carried.
 *
 * null when no row in the chunk has a parsable date, which is the same thing
 * `event_date` reports in that case.
 */
function eventDateSpan(candidatesByRow = []) {
  const dates = candidatesByRow.map((candidates) => firstUsableDate(candidates)).filter(Boolean);

  if (dates.length === 0) return null;

  // iso yyyy-mm-dd sorts lexicographically, which is the whole reason
  // normaliseDate produces it.
  return [dates.reduce((a, b) => (a < b ? a : b)), dates.reduce((a, b) => (a > b ? a : b))];
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

export async function prepareFile(
  filePath,
  problems = [],
) {
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
        const {
          raw_event_candidates: rawDates,
          raw_event_candidates_by_row: rawDatesByRow,
          ...rest
        } = chunk;

        return finalise(
          {
            ...rest,
            source_type: extracted.sourceType,
            provenance: "partner",
            authors: [],
            event_date: firstUsableDate(rawDates),
            event_date_span: eventDateSpan(rawDatesByRow),
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

 if (
    extracted.kind ===
    "images"
  ) {
    const classification = {
      domain:
        "performance",

      sensitivity:
        "internal",

      program:
        NO_PROGRAM,
    };


    const trustedImages =
      [];


    for (
      const image of
        extracted.images
    ) {
      const prepared =
        await prepareVisualEvidence({
          image,

          manifestPath:
            filePath,
        });


      if (
        prepared
      ) {
        trustedImages.push(
          prepared,
        );
      }
    }


    if (
      trustedImages.length ===
      0
    ) {
      return [];
    }


    return chunkImages({
      ...extracted,

      images:
        trustedImages,
    })
      .map(
        (chunk) =>
          finalise(
            {
              ...chunk,

              source_type:
                "image",

              provenance:
                "partner",

              authors:
                [],

              event_date:
                null,

              publication_year:
                null,

              entity_ids:
                [],

              source_uri:
                chunk.image_path ??
                filePath,

              file_name:
                extracted.fileName ??
                path.basename(
                  filePath,
                ),

              ingested_at:
                ingestedAt,
            },

            classification,

            problems,
          ),
      )
      .filter(
        Boolean,
      );
  }

  if (
  extracted.kind ===
  "video"
) {
  const classification = {
    domain:
      "performance",

    sensitivity:
      "internal",

    program:
      NO_PROGRAM,
  };


  /*
   * Existing video evidence stream:
   *
   * Human-described or transcript-like
   * segments already present in the
   * manifest.
   */
  const segmentChunks =
    chunkVideo(
      extracted,
    )
      .map(
        (chunk) =>
          finalise(
            {
              ...chunk,

              source_type:
                "video",

              provenance:
                "partner",

              authors:
                [],

              event_date:
                null,

              publication_year:
                null,

              entity_ids:
                [],

              /*
               * Prefer the original
               * recording over the JSON
               * manifest for citations.
               */
              source_uri:
                chunk.media_path ??
                filePath,

              file_name:
                extracted.fileName ??
                path.basename(
                  filePath,
                ),

              ingested_at:
                ingestedAt,
            },

            classification,

            problems,
          ),
      )
      .filter(
        Boolean,
      );


  /*
   * New visual evidence stream:
   *
   * Each physical recording referenced
   * by the manifest is sampled, filtered
   * by Gate 1, then evaluated by the
   * existing TENISE-53 Gate 2 pipeline.
   */
  const trustedVideoFrames =
    [];


  for (
    const [
      videoIndex,
      video,
    ] of
      extracted.videos.entries()
  ) {
    if (
      typeof video.source_path !==
        "string" ||
      video.source_path.trim()
        .length ===
        0
    ) {
      continue;
    }


    /*
     * source_path may be absolute or
     * relative to the manifest file.
     */
    const videoPath =
      path.isAbsolute(
        video.source_path,
      )
        ? video.source_path
        : path.resolve(
            path.dirname(
              filePath,
            ),
            video.source_path,
          );


    const videoId =
      video.video_id ??
      video.id ??
      `video_${videoIndex}`;


    /*
     * Keep generated frames separate for
     * each manifest and each video.
     *
     * This prevents candidate_0001.jpg
     * from different videos overwriting
     * each other.
     */
    const frameOutputDirectory =
      path.join(
        path.dirname(
          filePath,
        ),

        ".tennisexplore-frames",

        String(
          extracted.docId,
        ),

        String(
          videoId,
        ),
      );


    const visualEvidence =
      await prepareVideoVisualEvidence({
        videoPath,

        outputDirectory:
          frameOutputDirectory,

        videoId,
      });


    trustedVideoFrames.push(
      ...visualEvidence.trustedFrames,
    );
  }


  /*
   * chunkImages() uses image.index inside
   * the chunk ID.
   *
   * Frame numbering restarts for each
   * video, so assign one continuous index
   * across the whole manifest.
   */
  const indexedVideoFrames =
    trustedVideoFrames.map(
      (
        frame,
        index,
      ) => ({
        ...frame,

        index,
      }),
    );


  const visualChunks =
    indexedVideoFrames.length >
    0
      ? chunkImages({
          ...extracted,

          images:
            indexedVideoFrames,
        })
          .map(
            (chunk) =>
              finalise(
                {
                  ...chunk,

                  /*
                   * The evidence came from
                   * an extracted frame, but
                   * the source is still the
                   * original video.
                   */
                  source_type:
                    "video",

                  provenance:
                    "partner",

                  authors:
                    [],

                  event_date:
                    null,

                  publication_year:
                    null,

                  entity_ids:
                    [],

                  /*
                   * media_path points to
                   * the original MP4.
                   *
                   * image_path still points
                   * to the exact trusted
                   * evidence frame.
                   */
                  source_uri:
                    chunk.media_path ??
                    chunk.image_path ??
                    filePath,

                  file_name:
                    extracted.fileName ??
                    path.basename(
                      filePath,
                    ),

                  ingested_at:
                    ingestedAt,
                },

                classification,

                problems,
              ),
          )
          .filter(
            Boolean,
          )
      : [];


  /*
   * Keep both evidence streams.
   *
   * Existing video segments are preserved.
   * Visual evidence is added alongside them.
   */
  return [
    ...segmentChunks,
    ...visualChunks,
  ];
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
// s3 upload (STORAGE_PROVIDER=s3 only)
// ---------------------------------------------------------------------------

/**
 * Uploads the source file(s) behind one file's chunks to S3, so a citation
 * has something to open once asset.routes.js is reading from the bucket
 * instead of local disk.
 *
 * Keyed off chunk.source_uri rather than the file path the loop is on: for
 * images and video, source_uri is the actual media file a caption or clip
 * belongs to (chunk.image_path / chunk.media_path), which can differ from
 * the file that was walked to produce the chunk (a manifest, in the media
 * pipeline's case). Uploading whatever source_uri actually points at is what
 * the citation needs, not what was iterated.
 *
 * `uploaded` is a same-process Set of keys already pushed this run, so a
 * source_uri shared by many chunks (the normal case -- one PDF, hundreds of
 * chunks) is read and PUT once. `objectExists` is checked on top of that so
 * a *resumed* build (a fresh process, empty `uploaded`) also skips files the
 * previous run already got into the bucket, without needing its own entry in
 * the checkpoint file.
 */
export async function uploadSourceFiles(chunks, uploaded, failures) {
  if (env.storage.provider !== "s3") return;

  const sourceUris = new Set(chunks.map((chunk) => chunk.source_uri).filter(Boolean));

  for (const sourceUri of sourceUris) {
    if (uploaded.has(sourceUri)) continue;

    try {
      const key = toStorageKey(sourceUri, env.storage.assetSourceRoot);

      if (!(await objectExists(key))) {
        const body = await fsp.readFile(sourceUri);

        await putObject(key, body, { contentType: guessContentType(sourceUri) });
      }

      uploaded.add(sourceUri);
    } catch (error) {
      // one file failing to upload must not lose the chunks already written
      // for it -- they still search and answer from local disk, they just
      // will not open a citation until this is retried.
      failures.push({ file: path.basename(sourceUri), reason: error.message.slice(0, 200) });
    }
  }
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
  // the five keys added for E2-07 are appended ONLY when they differ from their
  // default. at the defaults the string is byte-for-byte what it has always
  // been, so a teammate's half-finished .build-state.json still resumes.
  const varied = NEW_CHUNKING_KEYS.filter(
    (key) => retrievalConfig.chunking[key] !== CHUNKING_DEFAULTS[key],
  ).map((key) => `${key}:${retrievalConfig.chunking[key]}`);

  return [
    `schema:${SCHEMA_VERSION}`,
    `provider:${retrievalConfig.embedding.provider}`,
    `model:${retrievalConfig.embedding.model}`,
    `dim:${retrievalConfig.embedding.dimension}`,
    `chunk:${retrievalConfig.chunking.targetChars}/${retrievalConfig.chunking.overlapChars}`,
    `contextual:${retrievalConfig.contextual.enabled ? retrievalConfig.contextual.mode : "off"}`,
    ...varied,
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
  // both sides normalised, so an older manifest holding only the original three
  // keys still compares equal at the defaults -- that is the regression guard
  // for the committed index -- while a genuinely different recipe, such as
  // rowsPerChunk=5, still fails.
  check(
    "chunking",
    canonicalChunking(existing.chunking),
    canonicalChunking(retrievalConfig.chunking),
  );
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
      // through the same canonicaliser the append guard uses, so the two can
      // never drift apart again.
      chunking: canonicalChunking(retrievalConfig.chunking),
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
  const uploadFailures = previous?.uploadFailures ?? [];
  const uploaded = new Set();

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

          await uploadSourceFiles(chunks, uploaded, uploadFailures);
          onProgress({ phase: "upload", file: name, uploaded: uploaded.size, failed: uploadFailures.length });
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
        uploadFailures: uploadFailures.slice(0, 500),
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
    uploadFailureCount: uploadFailures.length,
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
  let report = {
    skipped,
    schemaProblems: problems.slice(0, 500),
    uploadFailures: uploadFailures.slice(0, 500),
  };

  if (append) {
    const touched = new Set(files.map((file) => path.basename(file)));
    const earlier = await fsp
      .readFile(path.join(outputDir, "build-report.json"), "utf8")
      .then((raw) => JSON.parse(raw))
      .catch(() => ({ skipped: [], schemaProblems: [], uploadFailures: [] }));

    report = {
      // a file this run handled gets its new verdict; every other file keeps
      // the one it had. a document rescued by Textract therefore disappears
      // from the skipped list, which is exactly the outcome to look for.
      skipped: [...(earlier.skipped ?? []).filter((entry) => !touched.has(entry.file)), ...skipped],
      schemaProblems: [...(earlier.schemaProblems ?? []), ...problems].slice(0, 500),
      // same rule as skipped, and for the same reason: these entries are
      // {file, reason} too, so a file whose upload succeeded on this run drops
      // off the list instead of being reported as still failing. the run's own
      // uploadFailures already carry over within a build via the checkpoint,
      // but the checkpoint is deleted at the end of one -- so without this an
      // append run would silently forget every earlier failure.
      uploadFailures: [
        ...(earlier.uploadFailures ?? []).filter((entry) => !touched.has(entry.file)),
        ...uploadFailures,
      ].slice(0, 500),
    };
  }

  if (
    report.skipped.length > 0 ||
    report.schemaProblems.length > 0 ||
    report.uploadFailures.length > 0
  ) {
    await fsp.writeFile(
      path.join(outputDir, "build-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }

  // the checkpoint has served its purpose; leaving it behind makes the next
  // build think it is resuming a finished one.
  await fsp.rm(path.join(outputDir, STATE_FILE), { force: true });

  onProgress({ phase: "done", ...finalManifest });

  return { manifest: finalManifest, chunkCount, fileCount: files.length, skipped, problems, uploadFailures };
}
