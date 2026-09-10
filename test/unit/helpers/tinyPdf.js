// builds a minimal, real PDF in memory for tests.
//
// the raster service exists to turn a page into a PNG, and there is no way to
// test that against a stub -- a fake "pdf" proves the code runs, not that it
// renders. checking in a binary fixture would work but hides what is being
// tested inside an opaque file, and a scanned partner document cannot be
// committed at all.
//
// so the fixture is built from PDF syntax here: a few hundred bytes, entirely
// readable, and pdf.js parses and rasterises it exactly as it would any other
// document.

/**
 * @param pageCount how many pages the document should have.
 * @param text false for pages with no text operators at all -- a stand-in for a
 *        scanned document, where the page is an image and every text extractor
 *        returns nothing. that is the condition the Textract path triggers on.
 * @returns the bytes of a valid PDF, one line of text per page.
 */
export function tinyPdf(pageCount = 2, { text = true } = {}) {
  const objects = [];
  const firstPage = 3;
  const fontObject = firstPage + pageCount;
  const firstContent = fontObject + 1;

  const kids = Array.from({ length: pageCount }, (_, index) => `${firstPage + index} 0 R`);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;

  for (let index = 0; index < pageCount; index += 1) {
    objects[firstPage + index] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ` +
      `/Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${firstContent + index} 0 R >>`;
  }

  objects[fontObject] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (let index = 0; index < pageCount; index += 1) {
    // a grey rectangle rather than a Tj text-showing operator. the page renders
    // to something visible but carries no text layer at all, which is exactly
    // what a scan looks like to pdf.js and to poppler.
    const stream = text
      ? `BT /F1 12 Tf 20 50 Td (Page ${index + 1}) Tj ET`
      : `0.5 g 20 20 160 60 re f`;

    objects[firstContent + index] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  // the cross-reference table has to hold the real byte offset of every object,
  // so the body is assembled first and measured as it goes.
  let body = "%PDF-1.4\n";
  const offsets = [];

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = body.length;
    body += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = body.length;

  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

  for (let index = 1; index < objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // latin1, not utf8: the offsets above are counted in characters, and any
  // multi-byte encoding would make every one of them wrong.
  return Buffer.from(body, "latin1");
}
