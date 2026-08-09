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

  let parsed;

  try {
    parsed = await parser.getText();
  } finally {
    // the parser holds a worker open. without this the build finishes and the
    // process just sits there instead of exiting.
    await parser.destroy();
  }

  // we keep the per-page split rather than mashing the document into one string,
  // because citations need page numbers -- "page 4 of the periodisation paper"
  // is a claim a coach can check, "somewhere in the periodisation paper" is not.
  const pages = (parsed.pages ?? [])
    .map((page) => String(page.text ?? "").replace(/[ \t]+/g, " ").trim())
    .filter((page) => page !== "");

  return { pages, rawInfo: {} };
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
    sourceType: guessSourceType(filePath),
    sourceUri: filePath,
  };

  if (extension === ".pdf") {
    const { pages, rawInfo } = await extractPdf(filePath);
    return { ...base, kind: "document", pages, rawInfo };
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

  if (extension === ".txt" || extension === ".md") {
    const text = await fsp.readFile(filePath, "utf8");
    return { ...base, kind: "document", pages: [text], rawInfo: {} };
  }

  return null;
}

/**
 * walks a folder tree and returns every file we can actually read.
 */
export async function listIngestableFiles(directory) {
  const supported = new Set([".pdf", ".csv", ".xlsx", ".xls", ".txt", ".md"]);
  const found = [];

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
