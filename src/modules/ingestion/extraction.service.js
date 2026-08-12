// pulls text out of whatever the partner gave us (TENISE-11 / E2-05).
//
// the sample set is pdfs, csvs and xlsx, so those are what this handles, plus
// plain text and markdown because they cost nothing to support. everything comes
// out in one shape -- { docId, title, sourceType, pages | rows } -- so the
// chunker downstream never has to know what a file was.

import fsp from "node:fs/promises";
import path from "node:path";

// csv is parsed by hand rather than with a library because the only hard part is
// quoting, and that is about thirty lines. one less thing for the team to
// install.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // "" inside a quoted field is a literal quote character.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  // whatever is left after the last newline is a final row, unless the file
  // ended cleanly and it is empty.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((header) => header.trim());

  const records = rows
    .slice(1)
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = (values[index] ?? "").trim();
      });
      return record;
    });

  return { headers, records };
}

async function extractPdf(filePath) {
  // imported lazily so a machine that only ever ingests csvs does not need the
  // pdf parser to be installed and working.
  const { PDFParse } = await import("pdf-parse");

  const buffer = await fsp.readFile(filePath);
  const parser = new PDFParse({ data: buffer });

  let parsed = null;

  try {
    parsed = await parser.getText();
  } catch {
    // swallowed on purpose: a malformed pdf is a normal event in a corpus of
    // 2,300 files scraped together over a decade, and the fallback below reads
    // some of them. if it cannot, the caller records the file as skipped.
    parsed = null;
  } finally {
    // the parser holds a worker open. without this the build finishes and the
    // process sits there instead of exiting.
    await parser.destroy().catch(() => {});
  }

  // we keep the per-page split rather than mashing the document into one
  // string, because citations need page numbers -- "page 4 of the periodisation
  // paper" is a claim a coach can check, "somewhere in it" is not.
  let pages = (parsed?.pages ?? [])
    .map((page) => String(page.text ?? "").replace(/[ \t]+/g, " ").trim())
    .filter((page) => page !== "");

  if (pages.length === 0) {
    pages = await extractPdfWithPoppler(filePath);
  }

  // last resort: a text sidecar produced by tools/ocr/ocr_scanned.py. about 5%
  // of this corpus is scanned images with no text layer, and ocr is the only
  // way to read them. it lives outside the node pipeline because it needs
  // pytorch and a gpu, and everything else here needs neither -- so this checks
  // for its output rather than depending on it.
  if (pages.length === 0) {
    pages = await readOcrSidecar(filePath);
  }

  return { pages, rawInfo: {}, ocr: pages.length > 0 && (await hasOcrSidecar(filePath)) };
}

/**
 * fallback for pdfs the javascript parser cannot open.
 *
 * poppler's pdftotext is far more tolerant of damaged cross-reference tables
 * than pdf.js is, and across the partner corpus it recovers roughly one in ten
 * of the files that otherwise produce nothing -- including several conference
 * handouts that questions are being asked about.
 *
 * it is optional. if poppler is not installed we return nothing and the file is
 * recorded as skipped, rather than the build failing because a system package
 * is missing.
 */
async function extractPdfWithPoppler(filePath) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);

    // -layout keeps columns roughly intact, which matters for tables. \f is
    // pdftotext's page separator, same as the page split above.
    const { stdout } = await run("pdftotext", ["-layout", filePath, "-"], {
      maxBuffer: 200 * 1024 * 1024,
      timeout: 120_000,
    });

    return stdout
      .split("\f")
      .map((page) => page.replace(/[ \t]+/g, " ").trim())
      .filter((page) => page !== "");
  } catch {
    return [];
  }
}

const OCR_CACHE_DIR = process.env.OCR_CACHE_DIR || "data/ocr-cache";

function ocrSidecarPath(filePath) {
  // must match doc_id_for() in the python tool exactly, or the sidecar written
  // by ocr is never found by the build that needs it.
  const stem = path.basename(filePath, path.extname(filePath)).replace(/[^A-Za-z0-9._-]+/g, "_");

  return path.join(OCR_CACHE_DIR, `${stem}.txt`);
}

async function hasOcrSidecar(filePath) {
  try {
    await fsp.access(ocrSidecarPath(filePath));
    return true;
  } catch {
    return false;
  }
}

async function readOcrSidecar(filePath) {
  try {
    const text = await fsp.readFile(ocrSidecarPath(filePath), "utf8");

    // \f is the page separator the ocr tool writes, matching what pdftotext
    // uses, so ocr'd documents keep real page numbers and their citations stay
    // as precise as any other document's.
    return text
      .split("\f")
      .map((page) => page.replace(/[ \t]+/g, " ").trim())
      .filter((page) => page !== "");
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// titles
// ---------------------------------------------------------------------------

// journal furniture, download banners and copyright lines. none of these is
// ever the title, and all of them sit above it on page one.
const NOT_A_TITLE =
  /^(https?:|www\.|doi:|downloaded (from|by)|this article was|\d+$|©|copyright|issn|isbn|vol\.|volume \d|page \d|received:|accepted:|published:|original (research|article)|research article|review article|abstract|editorial|chapter \d+$|c\d+\.indd|first edition|edited by|john wiley|wiley|elsevier|springer|taylor & francis|routledge|lippincott|human kinetics|sage publications|international olympic)/i;

// titles that are technically extracted but say nothing. a citation reading
// "Lecture Presentation, page 3" is no more useful than no title at all, so
// these fall back to the filename, which at least names the speaker.
const TOO_GENERIC =
  /^(lecture (presentation|handout|notes)|presentation|handout|slides?|agenda|introduction|untitled|title|contents|overview|notes)$/i;

/**
 * repairs letter-spaced small caps.
 *
 * journals typeset titles as "T ENNIS FOR P HYSICAL H EALTH", where the large
 * first letter is a separate text run. extracted literally it produces tokens
 * like "t" and "ennis", which are useless to search and unreadable in a
 * citation. joining a lone capital onto the uppercase run that follows it
 * restores the word.
 */
export function repairSpacedCaps(text) {
  return String(text)
    .replace(/\b([A-Z]) ([A-Z]{2,})/g, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * works out a document's real title.
 *
 * filenames in this corpus are things like "1118862198-1.pdf" and
 * "c01.indd.pdf" -- doi fragments and typesetter artefacts. a citation reading
 * "1118862198 1, page 4" tells a coach nothing, so we read the title off the
 * first page instead and keep the filename only as a last resort.
 */
export function deriveTitle(pages, filePath) {
  const fallback = titleFromFileName(filePath);
  const firstPage = pages[0] ?? "";

  if (firstPage === "") return fallback;

  const lines = firstPage
    .split("\n")
    .map((line) => repairSpacedCaps(line))
    .filter((line) => line !== "");

  const candidates = [];

  // only the top of the page. past ~12 lines we are into the abstract, and an
  // abstract's first sentence is a plausible-looking but wrong title.
  for (const line of lines.slice(0, 12)) {
    if (NOT_A_TITLE.test(line)) continue;

    // too short is a header fragment, too long is a paragraph.
    if (line.length < 15 || line.length > 220) continue;

    // must be mostly letters. rejects tables of numbers and reference strings.
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;

    if (letters / line.length < 0.65) continue;

    candidates.push(line);

    // three lines is enough for any real title and stops us swallowing the
    // author list and affiliation block underneath it.
    if (candidates.length >= 3) break;
  }

  if (candidates.length === 0) return fallback;

  let title = candidates[0];

  // journal titles wrap across two or three lines. keep joining while the line
  // so far is clearly unfinished -- no terminal punctuation, still short, and
  // the next line is not an author list.
  for (let next = 1; next < candidates.length; next += 1) {
    const continuation = candidates[next];

    if (/[.!?]$/.test(title)) break;
    if (title.length > 120) break;
    // an author list is initials and surnames separated by commas. once we hit
    // one, the title is finished.
    if (/^[A-Z][a-z]*\.?\s*[A-Z]?\.?\s*[A-Z][a-z]+,/.test(continuation)) break;

    title = `${title} ${continuation}`;
  }

  // ALL CAPS TITLES ARE SHOUTING. convert to sentence case, but leave acronyms
  // and mixed-case titles alone.
  if (title === title.toUpperCase()) {
    title = title
      .toLowerCase()
      .replace(/(^|[.:!?]\s+)([a-z])/g, (match, prefix, letter) => prefix + letter.toUpperCase());
  }

  title = title
    .replace(/\s*[,:;-]\s*$/, "")
    .replace(/\s+([:;,])/g, "$1")
    .trim();

  // a title that turned out to be boilerplate is worse than the filename.
  if (TOO_GENERIC.test(title) || title.length < 15) return fallback;

  return title;
}

async function extractXlsx(filePath) {
  const XLSX = await import("xlsx");

  // sheetjs exposes readFile only on its commonjs default export, not on the
  // esm namespace, so we read the bytes ourselves and hand it a buffer. that
  // works on both and means the parser never touches the filesystem.
  const buffer = await fsp.readFile(filePath);

  // cellDates turns date cells into real Date objects instead of excel serial
  // numbers. without it a match date arrives as 46134 and gets verbalised as
  // "date 46134", which is both unsearchable and wrong. formatted strings are
  // no better -- excel hands them over as "4/22/26", and month-first versus
  // day-first on a two-digit year is not something we should be guessing at.
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets = [];

  for (const sheetName of workbook.SheetNames) {
    // raw:true keeps those Date objects as Date objects rather than restringing
    // them. normaliseDate and verbaliseRow both understand a Date.
    const records = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
      raw: true,
    });

    if (records.length > 0) sheets.push({ sheetName, records });
  }

  return sheets;
}

async function extractPptx(filePath) {
  // a pptx is a zip of xml. we read the slide parts directly rather than adding
  // a presentation library, because all we want is the words -- and a library
  // that understands animations and themes is a lot of dependency for that.
  const AdmZip = (await import("adm-zip")).default;

  const zip = new AdmZip(filePath);

  const slideEntries = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    // "slide10" sorts before "slide2" as a string, which silently reorders the
    // whole deck and puts the wrong number on every citation.
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides = [];

  for (const entryName of slideEntries) {
    const xml = zip.readAsText(entryName);

    // <a:t> holds every run of visible text, in reading order, including inside
    // tables and grouped shapes.
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => decodeXml(match[1]));

    // a paragraph break in the source is a real boundary -- headings sit in
    // their own paragraph -- so joining runs with a space and paragraphs with a
    // newline keeps the structure the chunker uses.
    const text = runs.join(" ").replace(/\s+/g, " ").trim();

    if (text !== "") slides.push({ number: slideNumber(entryName), text });
  }

  return slides;
}

function slideNumber(entryName) {
  return Number(entryName.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function decodeXml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * reads a video manifest: one json file describing clips and their segments.
 *
 * video is the third unstructured type the partner named, and we cannot embed
 * pixels here -- so what gets indexed is the human description of each segment
 * plus its timestamp. that is enough to answer "find the footage of a defensive
 * to offensive transition" and to link straight to the right second of the clip,
 * which is what a coach actually wants from video search.
 */
async function extractVideoManifest(filePath) {
  const raw = JSON.parse(await fsp.readFile(filePath, "utf8"));
  const videos = Array.isArray(raw) ? raw : (raw.videos ?? []);

  const segments = [];

  for (const video of videos) {
    for (const [index, segment] of (video.segments ?? []).entries()) {
      const description = String(segment.description ?? "").trim();

      if (description === "") continue;

      segments.push({
        index,
        videoId: video.video_id ?? video.id ?? null,
        url: video.url ?? null,
        title: video.title ?? video.source ?? "Video clip",
        start: segment.start ?? null,
        end: segment.end ?? null,
        // the tags carry real search value -- "baseline", "power", "defensive"
        // are exactly the words a coach types -- so they go into the indexed
        // text rather than sitting in metadata nothing searches.
        text: [description, (segment.tags ?? video.tags ?? []).join(", ")].filter(Boolean).join(". "),
      });
    }
  }

  return { videos, segments };
}

function titleFromFileName(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    // downloaded papers carry junk suffixes: "...Profiles_in.43", "rankings (1)",
    // "match-data-example[74]". none of that is part of the title, and all of it
    // ends up printed next to a citation if we leave it in.
    .replace(/[.\s]*\(\d+\)\s*$/, "")
    .replace(/\s*\[\d+\]\s*$/, "")
    .replace(/\.\d+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * guesses what a file is from where it sits and what it is called.
 *
 * a guess, not a fact -- it can be overridden per folder in the ingest manifest.
 * it exists so that pointing the pipeline at a folder of pdfs does something
 * sensible without anyone writing configuration first.
 */
export function guessSourceType(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const parent = path.basename(path.dirname(filePath)).toLowerCase();

  if (/policy|acceptable usage|information security/.test(name)) return "policy";
  if (/ranking/.test(name) || parent === "rankings") return "ranking_data";
  if (/match/.test(name) || parent === "match_data") return "match_report";
  if (/\.pptx$/.test(name)) return "presentation";
  if (/\.(pdf)$/.test(name)) return "research_paper";

  return "internal_note";
}

/**
 * extracts one file into the common shape.
 *
 * unsupported extensions return null rather than throwing, so pointing the
 * pipeline at a folder containing a stray .zip or .mp4 skips it and carries on.
 */
export async function extractFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const docId = path.basename(filePath, extension).replace(/[^A-Za-z0-9._-]+/g, "_");
  const base = {
    docId,
    title: titleFromFileName(filePath),
    // kept alongside the derived title. title extraction from arbitrary pdfs is
    // a best effort and will sometimes be wrong; the filename always identifies
    // the document exactly, so a citation can show both and stay verifiable.
    fileName: path.basename(filePath),
    sourceType: guessSourceType(filePath),
    sourceUri: filePath,
  };

  if (extension === ".pdf") {
    const { pages, rawInfo } = await extractPdf(filePath);

    // the title comes from the page, not the filename -- see deriveTitle.
    return { ...base, kind: "document", title: deriveTitle(pages, filePath), pages, rawInfo };
  }

  if (extension === ".csv") {
    const text = await fsp.readFile(filePath, "utf8");
    const { headers, records } = parseCsv(text);
    return { ...base, kind: "records", tableId: docId, headers, records };
  }

  if (extension === ".xlsx" || extension === ".xls") {
    const sheets = await extractXlsx(filePath);
    const records = sheets.flatMap((sheet) => sheet.records);
    const headers = records.length > 0 ? Object.keys(records[0]) : [];
    return { ...base, kind: "records", tableId: docId, headers, records };
  }

  if (extension === ".pptx") {
    const slides = await extractPptx(filePath);

    // a deck's first slide is its title slide, so the same logic applies.
    const titleSlideLines = (slides[0]?.text ?? "").split(/\s{2,}|\n/);

    return {
      ...base,
      kind: "slides",
      sourceType: "presentation",
      title: deriveTitle([titleSlideLines.join("\n")], filePath),
      slides,
    };
  }

  if (extension === ".json") {
    const manifest = await extractVideoManifest(filePath);

    // a json file that holds no video segments is configuration, not content.
    if (manifest.segments.length === 0) return null;

    return { ...base, kind: "video", sourceType: "video", ...manifest };
  }

  if (extension === ".txt" || extension === ".md") {
    const text = await fsp.readFile(filePath, "utf8");
    return { ...base, kind: "document", pages: [text], rawInfo: {} };
  }

  return null;
}

/**
 * walks a folder tree and returns every file we can actually read.
 */
export async function listIngestableFiles(target) {
  const supported = new Set([".pdf", ".csv", ".xlsx", ".xls", ".txt", ".md", ".pptx", ".json"]);
  const found = [];

  // a single file is a perfectly reasonable thing to point the pipeline at, and
  // an earlier version silently returned nothing for one -- readdir fails on a
  // file, the error was swallowed, and the file just never appeared in the
  // index with no message saying so. accept both.
  try {
    const stats = await fsp.stat(target);

    if (stats.isFile()) {
      return supported.has(path.extname(target).toLowerCase()) ? [target] : [];
    }
  } catch {
    return [];
  }

  const directory = target;

  async function walk(current) {
    let entries;

    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      // skip the usual noise plus anything hidden.
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      if (entry.isDirectory()) {
        await walk(full);
      } else if (supported.has(path.extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  }

  await walk(directory);

  return found.sort();
}
