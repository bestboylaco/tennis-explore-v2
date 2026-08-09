// builds the index end to end (TENISE-11 / E2-05 + TENISE-15 / E3-09).
//
//   files -> extract -> chunk -> classify + acl -> enforce schema -> embed -> write
//
// everything upstream of `embed` is cheap and deterministic, and everything from
// `embed` onward is slow. so the whole corpus is prepared and validated FIRST,
// and only then do we start the gpu. that ordering is deliberate: a schema
// mistake on document nine should cost you two seconds, not forty minutes of
// embedding followed by a crash.

import path from "node:path";

import { retrievalConfig } from "../../config/retrieval.config.js";
import { VectorStoreWriter } from "../../infrastructure/vector/vectorStore.service.js";
import { grantsForDocument } from "../../shared/constants/accessControl.js";
import { chunkDocument, chunkRecords } from "./chunking.service.js";
import { embedTexts } from "./embedding.service.js";
import { extractFile, listIngestableFiles } from "./extraction.service.js";
import {
  SCHEMA_VERSION,
  classifyDocument,
  enforceSchema,
  extractAuthors,
  normaliseDate,
} from "./metadata.service.js";

// which column in a table holds the date the row is ABOUT. checked in order, so
// a match date beats a tournament start date when both exist.
const DATE_COLUMNS = ["match_date", "Date", "date", "tournament_start_date", "event_date"];

function pickDateColumns(headers = []) {
  return DATE_COLUMNS.filter((column) => headers.includes(column));
}

/**
 * takes the first candidate that actually parses into a date.
 *
 * needed because a column existing is not the same as a column being populated
 * -- the partner's match csv carries `match_date` on every row with the value
 * "Not available".
 */
function firstUsableDate(candidates = []) {
  for (const candidate of candidates) {
    const iso = normaliseDate(candidate);

    if (iso) return iso;
  }

  return null;
}

/**
 * pulls the publication year out of a paper's front matter.
 *
 * a bounded range on purpose: an unbounded \d{4} matches sample sizes, page
 * numbers and equipment model numbers, and you end up dating a 2022 paper to
 * 1024 because that was a buffer size in the methods section.
 */
function guessPublicationYear(text) {
  const years = [...String(text).matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]));

  if (years.length === 0) return null;

  // the most recent plausible year in the front matter is almost always the
  // publication year; earlier ones are citations.
  return Math.max(...years);
}

/**
 * prepares every chunk for one file, fully classified and schema-checked.
 */
async function prepareFile(filePath, { onWarn }) {
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

    return chunkRecords(extracted, { label, eventDateColumns: dateColumns }).map((chunk) => {
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
          ingested_at: ingestedAt,
        },
        classification,
        onWarn,
      );
    });
  }

  // a document. the first page carries the front matter, which is where the
  // authors and the year live.
  const frontMatter = extracted.pages[0] ?? "";
  const authors = extractAuthors(frontMatter);
  const publicationYear = guessPublicationYear(frontMatter.slice(0, 3000));
  const eventDate = publicationYear ? `${publicationYear}-01-01` : null;

  const classification = classifyDocument({
    sourceType: extracted.sourceType,
    fileName: path.basename(filePath),
    text: frontMatter,
  });

  return chunkDocument(extracted, { authors, eventDate }).map((chunk) =>
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
        ingested_at: ingestedAt,
      },
      classification,
      onWarn,
    ),
  );
}

/**
 * attaches the access classification and runs the schema gate.
 */
function finalise(chunk, classification, onWarn) {
  const complete = {
    ...chunk,
    data_domain: classification.domain,
    sensitivity: classification.sensitivity,
    program: classification.program,
    acl_groups: grantsForDocument(classification),
  };

  const { valid, problems } = enforceSchema(complete, { strict: false });

  if (!valid) {
    // strict:false here and a throw below, so the report names EVERY broken
    // chunk in one run rather than stopping at the first one. fixing ingestion
    // one error at a time is miserable.
    onWarn({ chunkId: complete.chunk_id, problems });
  }

  return complete;
}

/**
 * builds an index from one or more source folders.
 */
export async function buildIndex({
  sourceDirs,
  outputDir = retrievalConfig.index.dir,
  onProgress = () => {},
}) {
  const failures = [];
  const onWarn = (failure) => failures.push(failure);

  // ---- gather ------------------------------------------------------------
  const files = [];

  for (const directory of sourceDirs) {
    files.push(...(await listIngestableFiles(directory)));
  }

  if (files.length === 0) {
    throw new Error(
      `no readable files under ${sourceDirs.join(", ")}. ` +
        `supported types are pdf, csv, xlsx, txt and md.`,
    );
  }

  onProgress({ phase: "scan", files: files.length });

  // ---- extract and chunk -------------------------------------------------
  const chunks = [];

  for (const [position, filePath] of files.entries()) {
    onProgress({ phase: "extract", file: path.basename(filePath), done: position + 1, total: files.length });

    try {
      chunks.push(...(await prepareFile(filePath, { onWarn })));
    } catch (error) {
      // one unreadable pdf should not lose the other forty files' work.
      onWarn({ chunkId: path.basename(filePath), problems: [`extraction failed: ${error.message}`] });
    }
  }

  if (failures.length > 0) {
    const preview = failures
      .slice(0, 10)
      .map((failure) => `  ${failure.chunkId}: ${failure.problems.join("; ")}`)
      .join("\n");

    throw new Error(
      `${failures.length} chunk(s) failed schema v${SCHEMA_VERSION}. nothing was ` +
        `indexed. first few:\n${preview}`,
    );
  }

  if (chunks.length === 0) {
    throw new Error("nothing to index -- every file produced zero usable chunks.");
  }

  onProgress({ phase: "chunked", chunks: chunks.length });

  // ---- embed -------------------------------------------------------------
  // embedding_text, not text: the contextual header must be inside the vector.
  const texts = chunks.map((chunk) => chunk.embedding_text ?? chunk.text);

  const vectors = await embedTexts(texts, {
    onProgress: ({ done, total }) => onProgress({ phase: "embed", done, total }),
  });

  // ---- write -------------------------------------------------------------
  const writer = new VectorStoreWriter(outputDir, {
    dimension: retrievalConfig.embedding.dimension,
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      embeddingProvider: retrievalConfig.embedding.provider,
      embeddingModel: retrievalConfig.embedding.model,
      contextual: retrievalConfig.contextual.enabled ? retrievalConfig.contextual.mode : "off",
      chunking: retrievalConfig.chunking,
      sourceDirs,
      fileCount: files.length,
    },
  });

  await writer.open();

  for (const [position, chunk] of chunks.entries()) {
    await writer.add(chunk, vectors[position]);
  }

  const manifest = await writer.close();

  onProgress({ phase: "done", ...manifest });

  return { manifest, chunkCount: chunks.length, fileCount: files.length };
}
