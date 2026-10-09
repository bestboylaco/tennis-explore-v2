import path from "node:path";

import {
  FRAME_ADMISSION_MODE,
  processFrame,
} from "../vision/index.js";


function isObject(
  value,
) {
  return (
    value !== null &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value,
    )
  );
}


function assertImage(
  image,
) {
  if (
    !isObject(
      image,
    )
  ) {
    throw new TypeError(
      "Visual evidence preparation requires an image.",
    );
  }


  if (
    typeof image.path !==
      "string" ||
    image.path.trim().length ===
      0
  ) {
    throw new TypeError(
      "Visual evidence preparation requires image.path.",
    );
  }
}


function resolveImagePath(
  imagePath,
  manifestPath,
) {
  const trimmedPath =
    imagePath.trim();


  if (
    path.isAbsolute(
      trimmedPath,
    )
  ) {
    return trimmedPath;
  }


  if (
    typeof manifestPath ===
      "string" &&
    manifestPath.trim().length >
      0
  ) {
    return path.resolve(
      path.dirname(
        manifestPath,
      ),
      trimmedPath,
    );
  }


  return path.resolve(
    trimmedPath,
  );
}


// a table-shaped figure -- a stats graphic or a chart with a value table cut
// out of a PDF or slide deck -- is read by OCR, not by Textract's AnalyzeDocument,
// so there is no TABLE/CELL structure for it anywhere, only a flat string from
// pytesseract.image_to_string(). that string usually keeps one output line per
// row and two-or-more spaces between cells on the same row (the same column
// convention `pdftotext -layout` uses), because that is how Tesseract's own
// layout analysis renders a row it detected -- but nothing says which word sits
// under which header once the line breaks and the run of spaces are gone.
//
// a column needs at least two cells to have two cells confusable with each
// other, so a figure's OCR text is only worth re-reading as a table when it has
// a header-shaped line followed by at least one same-width data line with a
// number in it -- a plain caption or a one-word OCR snippet never matches that
// and is returned untouched.
const MIN_TABLE_COLUMNS = 2;

function splitOcrCells(line) {
  return line
    .trim()
    .split(/\s{2,}|\t+/)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");
}

/**
 * re-reads OCR text pulled off a table-shaped figure as `label: value` pairs
 * instead of the bare run of words Tesseract printed.
 *
 * this is the fix for TENISE-66: a query comparing men's vs. women's match
 * distance came back backwards because the figure's OCR text -- something like
 *
 *   Metric          Men     Women
 *   Distance (km)   3.2     2.8
 *
 * -- used to be handed to the generation model exactly as printed above, with
 * only whitespace saying that "3.2" sits under "Men" and not under "Women".
 * collapsed into one line by `joinSearchableText`'s old single-space join (or
 * even left as two lines, once the chunk is embedded next to other prose) that
 * whitespace is exactly the kind of signal an LLM reading a flattened passage
 * drops -- it has nothing left to stop it pairing the women's number with the
 * men's header. explicit labels do not leave that choice to be made:
 *
 *   Metric: Distance (km), Men: 3.2, Women: 2.8
 *
 * returns null, rather than a guess, when the text does not unambiguously look
 * like a table -- see the module comment above this function for exactly what
 * that requires. a caption or an OCR snippet that is not a table must be left
 * exactly as Tesseract read it, not have structure invented for it.
 */
export function restructureTabularOcrText(ocrText) {
  const lines = String(ocrText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length < 2) return null;

  const [header, ...body] = lines.map(splitOcrCells);

  if (header.length < MIN_TABLE_COLUMNS) return null;
  if (body.some((row) => row.length !== header.length)) return null;

  // a table worth restructuring has a number in it somewhere. the figures this
  // bug is about are statistics, not two caption lines that happen to wrap at
  // matching widths.
  if (!body.some((row) => row.some((cell) => /\d/.test(cell)))) return null;

  return body
    .map((row) => row.map((cell, index) => `${header[index]}: ${cell}`).join(", "))
    .join("\n");
}

function joinSearchableText(
  caption,
  ocrText,
) {
  const structuredOcrText = restructureTabularOcrText(ocrText);

  return [
    caption,
    structuredOcrText ?? ocrText,
  ]
    .filter(
      (value) =>
        typeof value ===
          "string" &&
        value.trim().length >
          0,
    )
    .map(
      (value) =>
        value.trim(),
    )
    .join(
      " ",
    );
}


export async function prepareVisualEvidence({
  image,

  manifestPath =
    null,

  processFrameFn =
    processFrame,
} = {}) {
  assertImage(
    image,
  );


  if (
    typeof processFrameFn !==
      "function"
  ) {
    throw new TypeError(
      "Visual evidence preparation requires processFrameFn.",
    );
  }


  const imagePath =
    resolveImagePath(
      image.path,
      manifestPath,
    );


  const frameId =
    image.imageId ??
    path.basename(
      imagePath,
    );


  const result =
    await processFrameFn({
      frameId,

      imageInput:
        imagePath,

      mode:
        FRAME_ADMISSION_MODE
          .GENERAL_CAPTION,

      source: {
        videoId:
          image.videoId ??
          null,

        timestampSeconds:
          image.timestampSeconds ??
          null,

        framePath:
          imagePath,
      },
    });


  const trustedEvidence =
    result?.trustedEvidence;


  if (
    !trustedEvidence ||
    trustedEvidence
      .evidenceEligible !==
      true
  ) {
    return null;
  }


  const text =
    joinSearchableText(
      trustedEvidence
        .caption
        ?.text,

      image.ocrText,
    );


  if (
    text.length ===
    0
  ) {
    return null;
  }


  return {
    ...image,

    path:
      imagePath,

    text,

    trustedCaption:
      trustedEvidence
        .caption
        ?.text ??
      null,

    qualityStatus:
      trustedEvidence
        .quality
        .status,

    qualityScore:
      trustedEvidence
        .quality
        .qualityScore,

    qualityIssues:
      [
        ...trustedEvidence
          .quality
          .issues,
      ],

    verificationStatus:
      trustedEvidence
        .verification
        .status,

    evidenceEligible:
      true,

    videoId:
      trustedEvidence
        .source
        .videoId,

    timestampSeconds:
      trustedEvidence
        .source
        .timestampSeconds,

    framePath:
      trustedEvidence
        .source
        .framePath,
  };
}