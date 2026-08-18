#!/usr/bin/env python3
"""turn scanned pdfs into text the pipeline can index.

about 5% of the partner library is scanned images with no text layer -- older
conference handouts, mostly. the javascript pipeline cannot read them and skips
them by name into data/index/build-report.json. this reads that list, runs ocr,
and writes a text sidecar per document.

the node side then picks up the sidecar automatically on the next build, so this
is a separate optional step rather than a dependency of the main pipeline. that
separation is deliberate: ocr needs pytorch and a gpu, and the rest of the
system needs neither.

two engines, tried in order:

  surya      a 650M-parameter layout-aware ocr model. runs on the gpu, handles
             multi-column academic layouts properly, and is the right choice on
             an 8 gb card. roughly 1-3 seconds a page.
  tesseract  cpu, no model download, installed nearly everywhere. noticeably
             worse on multi-column pages but perfectly usable on clean scans,
             and it means this script does something on a machine with no gpu.

usage:
  python tools/ocr/ocr_scanned.py --from-report data/index/build-report.json
  python tools/ocr/ocr_scanned.py --dir "C:/path/to/pdfs" --engine tesseract
  python tools/ocr/ocr_scanned.py --from-report ... --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# page separator. the same character the node extractor already splits pdf text
# on, so the sidecar and a normal extraction produce identical page structure --
# which means citations keep their page numbers.
PAGE_BREAK = "\f"

DEFAULT_CACHE = Path("data/ocr-cache")


def log(message: str) -> None:
    print(message, flush=True)


def doc_id_for(path: Path) -> str:
    """must match the node side's docId exactly, or the sidecar is never found.

    node: path.basename(filePath, extension).replace(/[^A-Za-z0-9._-]+/g, "_")
    """
    stem = path.stem
    return "".join(c if (c.isalnum() or c in "._-") else "_" for c in stem)


def render_pages(pdf_path: Path, dpi: int = 200):
    """pdf pages -> PIL images.

    200 dpi is the usual sweet spot: 150 starts losing small print in tables,
    300 doubles the time for very little accuracy on documents that were
    scanned at 200-300 in the first place.
    """
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(pdf_path))
    scale = dpi / 72  # pdf user units are 72 per inch

    try:
        for index in range(len(document)):
            page = document[index]
            yield page.render(scale=scale).to_pil()
    finally:
        document.close()


# ---------------------------------------------------------------------------
# engines
# ---------------------------------------------------------------------------

class SuryaEngine:
    """layout-aware ocr on the gpu."""

    name = "surya"

    def __init__(self) -> None:
        from surya.detection import DetectionPredictor
        from surya.recognition import RecognitionPredictor

        # predictors hold the weights, so they are built once and reused. doing
        # this per document reloads ~650M parameters every time and is the
        # difference between hours and days.
        self.detection = DetectionPredictor()
        self.recognition = RecognitionPredictor()

    def read(self, images) -> list[str]:
        results = self.recognition(images, det_predictor=self.detection)
        pages = []

        for result in results:
            # surya returns text lines with bounding boxes, already in reading
            # order for the detected layout. joining with newlines preserves the
            # line structure the chunker uses to find paragraph boundaries.
            pages.append("\n".join(line.text for line in result.text_lines))

        return pages


class TesseractEngine:
    """cpu fallback."""

    name = "tesseract"

    def __init__(self) -> None:
        import pytesseract  # noqa: F401

        self.pytesseract = __import__("pytesseract")

    def read(self, images) -> list[str]:
        # psm 1 = automatic page segmentation with orientation detection. the
        # default (psm 3) does no orientation detection, and a fair number of
        # scanned handouts are rotated.
        return [self.pytesseract.image_to_string(image, config="--psm 1") for image in images]


def build_engine(preference: str):
    order = [preference] if preference != "auto" else ["surya", "tesseract"]

    for name in order:
        try:
            engine = SuryaEngine() if name == "surya" else TesseractEngine()
            log(f"using {engine.name}")
            return engine
        except Exception as error:  # noqa: BLE001
            log(f"  {name} unavailable: {str(error)[:120]}")

    log(
        "\nno ocr engine available. install one:\n"
        "  gpu (recommended):  pip install surya-ocr\n"
        "  cpu:                pip install pytesseract  (plus the tesseract binary)\n"
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def collect_targets(args) -> list[Path]:
    targets: list[Path] = []

    if args.from_report:
        report = json.loads(Path(args.from_report).read_text(encoding="utf-8"))
        names = [item["file"] for item in report.get("skipped", [])]

        if not args.source_dir:
            log("--from-report also needs --source-dir, to find the files it names")
            sys.exit(1)

        root = Path(args.source_dir)

        for name in names:
            matches = list(root.rglob(name))

            if matches:
                targets.append(matches[0])
            else:
                log(f"  not found under {root}: {name}")

    if args.dir:
        targets.extend(sorted(Path(args.dir).rglob("*.pdf")))

    # de-duplicate while keeping order
    seen = set()
    unique = []

    for path in targets:
        if path not in seen:
            seen.add(path)
            unique.append(path)

    return unique


def main() -> None:
    parser = argparse.ArgumentParser(description="OCR scanned PDFs into text sidecars.")
    parser.add_argument("--from-report", help="data/index/build-report.json")
    parser.add_argument("--source-dir", help="where the files named in the report live")
    parser.add_argument("--dir", help="OCR every pdf under this folder instead")
    parser.add_argument("--cache", default=str(DEFAULT_CACHE), help="where sidecars are written")
    parser.add_argument("--engine", default="auto", choices=["auto", "surya", "tesseract"])
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--max-pages", type=int, default=60,
                        help="skip beyond this many pages; a 400-page scan is rarely worth an hour")
    parser.add_argument("--dry-run", action="store_true", help="list what would be done")
    args = parser.parse_args()

    targets = collect_targets(args)

    if not targets:
        log("nothing to do -- pass --from-report with --source-dir, or --dir")
        return

    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)

    # already-done files are skipped, so this is resumable in the same way the
    # index build is. ocr over a few hundred scans is an hours-long job.
    pending = [p for p in targets if not (cache / f"{doc_id_for(p)}.txt").exists()]

    log(f"{len(targets)} file(s) targeted, {len(pending)} still to do")

    if args.dry_run:
        for path in pending[:40]:
            log(f"  would ocr: {path.name}")
        return

    engine = build_engine(args.engine)

    started = time.time()
    done = 0
    failed = 0

    for path in pending:
        out_path = cache / f"{doc_id_for(path)}.txt"

        try:
            images = list(render_pages(path, dpi=args.dpi))

            if len(images) > args.max_pages:
                log(f"  skipping {path.name}: {len(images)} pages, over --max-pages")
                continue

            pages = engine.read(images)
            text = PAGE_BREAK.join(pages)

            # a sidecar with almost nothing in it means the scan is unreadable
            # rather than that ocr succeeded. writing it would tell the next
            # build "this file is fine" and permanently mask the problem.
            if len(text.strip()) < 200:
                log(f"  {path.name}: ocr produced almost nothing, leaving it unmarked")
                failed += 1
                continue

            out_path.write_text(text, encoding="utf-8")
            done += 1

            elapsed = time.time() - started
            rate = done / max(elapsed, 0.1)
            remaining = int((len(pending) - done) / max(rate, 0.001))

            log(f"  [{done}/{len(pending)}] {path.name} -> {len(text):,} chars  (~{remaining // 60}m left)")
        except Exception as error:  # noqa: BLE001
            failed += 1
            log(f"  FAILED {path.name}: {str(error)[:140]}")

    log(f"\ndone. {done} file(s) written to {cache}/, {failed} failed.")
    log("re-run the index build to pick them up -- it will resume, so only the new text is embedded.")


if __name__ == "__main__":
    main()
