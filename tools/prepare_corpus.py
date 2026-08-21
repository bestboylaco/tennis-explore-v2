#!/usr/bin/env python3
"""one command between "pulled from S3" and "ready to embed".

point this at whatever came out of the bucket. it works out what each file is,
converts anything the indexer cannot read into something it can, and then tells
you the exact build command to run.

    PDF with a text layer      -> nothing to do, the indexer reads it
    PDF that is scanned images -> OCR
    PPTX                       -> text is read directly; the FIGURES get captioned
    video                      -> speech transcribed, and slides on screen captioned
    images                     -> captioned, plus OCR for any text in them
    CSV / XLSX                 -> nothing to do
    JSON manifests             -> nothing to do

the point is that you should not have to know which of those applies to which
file. that decision is what this script exists to make.

everything is resumable and everything is idempotent: run it again after adding
files and it only does the new ones.

    python tools/prepare_corpus.py --source "C:/.../document-resources"
    python tools/prepare_corpus.py --source "C:/.../document-resources" --inventory-only
    python tools/prepare_corpus.py --source "C:/.../media" --run-build

on python 3.14 the vision and OCR dependencies have no wheels yet. use 3.12:
    py -3.12 -m venv .venv
    .venv\\Scripts\\activate
    pip install faster-whisper pypdfium2 pytesseract pillow
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "media"))
sys.path.insert(0, str(HERE / "ocr"))

PDF_EXT = {".pdf"}
DECK_EXT = {".pptx"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
TABLE_EXT = {".csv", ".xlsx", ".xls"}
READY_EXT = {".txt", ".md", ".json"} | TABLE_EXT | DECK_EXT

# a pdf whose first pages yield less than this is a scan, not a document. 200
# characters is about one paragraph -- below that you are looking at page
# furniture that survived, not body text.
TEXT_LAYER_THRESHOLD = 200

# beyond this a pdf is a high-DPI page-image dump. the partner corpus has ten
# between 117 MB and 917 MB. OCR on those runs for hours and returns very
# little, so they are listed rather than attempted.
HUGE_PDF_BYTES = 80 * 1024 * 1024


def log(message: str = "") -> None:
    print(message, flush=True)


# ---------------------------------------------------------------------------
# preflight
# ---------------------------------------------------------------------------

def preflight() -> dict[str, bool]:
    """checks what is actually usable before any work starts.

    the alternative is finding out 41 files into a 180-file loop that a binary
    is missing, which is what happened on the first real run. importing a python
    package is not the same as having the tool it wraps.
    """
    available: dict[str, bool] = {}

    def probe(name, test, fix):
        try:
            test()
            available[name] = True
            log(f"  ok    {name}")
        except Exception:  # noqa: BLE001
            available[name] = False
            log(f"  MISS  {name}")
            log(f"          {fix}")

    log("checking what is installed")
    log("-" * 62)

    probe(
        "pypdfium2       read PDFs, detect scans",
        lambda: __import__("pypdfium2"),
        "pip install pypdfium2",
    )
    probe(
        "faster-whisper  transcribe video",
        lambda: __import__("faster_whisper"),
        "pip install faster-whisper",
    )
    probe(
        "ffmpeg          caption what is on screen in video",
        lambda: shutil.which("ffmpeg") or (_ for _ in ()).throw(RuntimeError()),
        "winget install Gyan.FFmpeg   (then reopen the shell)",
    )

    # OCR: either engine will do, so they are probed together.
    try:
        __import__("surya")
        available["ocr"] = True
        log("  ok    surya           OCR for scanned PDFs")
    except Exception:  # noqa: BLE001
        try:
            import pytesseract

            # the real check. the package imports without the binary present.
            pytesseract.get_tesseract_version()
            available["ocr"] = True
            log("  ok    tesseract       OCR for scanned PDFs")
        except Exception:  # noqa: BLE001
            available["ocr"] = False
            log("  MISS  OCR             scanned PDFs will be skipped")
            log("          pip install surya-ocr                    (GPU, no binary needed)")
            log("          or: winget install UB-Mannheim.TesseractOCR  (then reopen the shell)")

    # the vision model is a service, not a package.
    try:
        import urllib.request

        with urllib.request.urlopen(f"{os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434')}/api/tags", timeout=5) as response:
            models = json.loads(response.read()).get("models", [])
            names = [m.get("name", "") for m in models]
            vision = os.environ.get("VISION_MODEL", "llava:7b")
            has_vision = any(n == vision or n.startswith(vision.split(":")[0]) for n in names)

            available["vision"] = has_vision
            log(f"  {'ok  ' if has_vision else 'MISS'}  {vision:<15} caption images and slides")

            if not has_vision:
                log(f"          ollama pull {vision}")
    except Exception:  # noqa: BLE001
        available["vision"] = False
        log("  MISS  ollama          not running; images and slides will be skipped")
        log("          start the Ollama app")

    log()

    return available


# ---------------------------------------------------------------------------
# inventory
# ---------------------------------------------------------------------------

def has_text_layer(path: Path) -> bool | None:
    """does this PDF carry extractable text, or is it a picture of a page?

    returns None when we cannot tell -- a broken file, or pypdfium2 missing.
    None is deliberately not False: "unreadable" and "scanned" need different
    treatment, and collapsing them sends corrupt files to an OCR queue that
    will never fix them.
    """
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None

    try:
        document = pdfium.PdfDocument(str(path))

        try:
            characters = 0

            # first three pages only. a document whose body text starts on page
            # four is not a thing, and probing 2,300 files fully would take
            # longer than the OCR.
            for index in range(min(3, len(document))):
                characters += len(document[index].get_textpage().get_text_range().strip())

                if characters >= TEXT_LAYER_THRESHOLD:
                    return True

            return False
        finally:
            document.close()
    except Exception:  # noqa: BLE001
        return None


def take_inventory(sources: list[Path]) -> dict[str, list[Path]]:
    buckets: dict[str, list[Path]] = {
        "ready": [],
        "pdf_text": [],
        "pdf_scanned": [],
        "pdf_unreadable": [],
        "pdf_huge": [],
        "deck": [],
        "video": [],
        "image": [],
        "ignored": [],
    }

    files = []

    for source in sources:
        if source.is_file():
            files.append(source)
        else:
            files.extend(p for p in source.rglob("*") if p.is_file())

    log(f"scanning {len(files)} files")

    for index, path in enumerate(files, start=1):
        suffix = path.suffix.lower()

        if suffix in VIDEO_EXT:
            buckets["video"].append(path)
        elif suffix in IMAGE_EXT:
            buckets["image"].append(path)
        elif suffix in DECK_EXT:
            buckets["deck"].append(path)
        elif suffix in READY_EXT:
            buckets["ready"].append(path)
        elif suffix in PDF_EXT:
            if path.stat().st_size > HUGE_PDF_BYTES:
                buckets["pdf_huge"].append(path)
            else:
                verdict = has_text_layer(path)
                buckets["pdf_text" if verdict else "pdf_unreadable" if verdict is None else "pdf_scanned"].append(path)
        else:
            buckets["ignored"].append(path)

        if index % 250 == 0:
            log(f"  probed {index}/{len(files)}")

    return buckets


def report(buckets: dict[str, list[Path]]) -> None:
    labels = {
        "pdf_text": "PDF with a text layer      indexed as-is",
        "pdf_scanned": "PDF that is scanned        needs OCR",
        "pdf_unreadable": "PDF that will not open     needs a fresh copy",
        "pdf_huge": "PDF over the size limit    listed, not processed",
        "deck": "PPTX                       text as-is, figures captioned",
        "video": "video                      transcribed + slides captioned",
        "image": "image                      captioned + OCR",
        "ready": "already indexable          nothing to do",
        "ignored": "not a supported type       skipped",
    }

    log("\ninventory")
    log("-" * 62)

    for key, label in labels.items():
        count = len(buckets[key])

        if count:
            log(f"  {count:>6}  {label}")

    if buckets["pdf_unreadable"]:
        log("\n  will not open (ask for fresh copies):")

        for path in buckets["pdf_unreadable"][:8]:
            log(f"    {path.name}")

    if buckets["pdf_huge"]:
        log("\n  over the size limit:")

        for path in buckets["pdf_huge"][:8]:
            log(f"    {path.name}  ({path.stat().st_size / 1048576:.0f} MB)")


# ---------------------------------------------------------------------------
# the conversion steps
# ---------------------------------------------------------------------------

def run_ocr(paths: list[Path], cache: Path, engine: str) -> None:
    if not paths:
        return

    log(f"\nOCR: {len(paths)} scanned PDFs")

    try:
        from ocr_scanned import build_engine, doc_id_for, render_pages, PAGE_BREAK
    except ImportError as error:
        log(f"  cannot import the OCR tool: {error}")
        return

    cache.mkdir(parents=True, exist_ok=True)
    pending = [p for p in paths if not (cache / f"{doc_id_for(p)}.txt").exists()]

    log(f"  {len(pending)} still to do")

    if not pending:
        return

    reader = build_engine(engine)

    if reader is None:
        log("  no OCR engine available -- skipping OCR and carrying on with the rest.")
        return

    consecutive_failures = 0

    for index, path in enumerate(pending, start=1):
        try:
            pages = reader.read(list(render_pages(path)))
            text = PAGE_BREAK.join(pages)

            if len(text.strip()) < 200:
                log(f"  [{index}/{len(pending)}] {path.name}: produced almost nothing, left unmarked")
                continue

            consecutive_failures = 0
            (cache / f"{doc_id_for(path)}.txt").write_text(text, encoding="utf-8")
            log(f"  [{index}/{len(pending)}] {path.name}: {len(text):,} chars")
        except Exception as error:  # noqa: BLE001
            consecutive_failures += 1
            log(f"  [{index}/{len(pending)}] FAILED {path.name}: {str(error)[:90]}")

            # three in a row means the environment is wrong, not the files.
            # grinding through 180 identical failures helps nobody and buries
            # the one line that says what to fix.
            if consecutive_failures >= 3:
                log("\n  three failures in a row -- stopping OCR. this is an environment")
                log("  problem, not a problem with the files. fix it and re-run;")
                log("  anything already done is kept.\n")
                return


def run_media(buckets: dict[str, list[Path]], out: Path, keyframes: bool) -> None:
    try:
        import ingest_media
    except ImportError as error:
        log(f"\ncannot import the media tool: {error}")
        return

    if buckets["video"]:
        log(f"\nvideo: transcribing {len(buckets['video'])} file(s)")
        ingest_media.transcribe(buckets["video"], out)

        if keyframes:
            log("\nvideo: captioning what is on screen")
            run_keyframes(buckets["video"], out)

    if buckets["image"]:
        log(f"\nimages: captioning {len(buckets['image'])} file(s)")
        ingest_media.caption_images(buckets["image"], out, "standalone")

    if buckets["deck"]:
        log(f"\ndecks: extracting and captioning figures from {len(buckets['deck'])} deck(s)")
        figures = ingest_media.extract_figures(buckets["deck"][0].parent, out / "figures")

        if figures:
            ingest_media.caption_images(figures, out, "figures")


def run_keyframes(paths: list[Path], out: Path, every_seconds: int = 45) -> None:
    """samples frames and captions them.

    speech is only half of a lecture recording. the other half is the slide on
    screen, and for a presentation that is usually where the numbers are -- a
    speaker says "as you can see here", and everything that matters is in the
    picture.

    one frame every 45 seconds is a deliberate compromise. slides change on that
    sort of timescale in a talk, and captioning is 2-6 seconds a frame, so a
    40-minute recording costs about 50 frames and a few minutes rather than
    thousands and an afternoon.
    """
    if not shutil.which("ffmpeg"):
        log("  ffmpeg is not on PATH, so on-screen content is being skipped.")
        log("  install it (winget install Gyan.FFmpeg) and re-run to add slide captions.")
        return

    import ingest_media

    frame_dir = out / "frames"
    frame_dir.mkdir(parents=True, exist_ok=True)

    for path in paths:
        stem = ingest_media.doc_id_for(path)
        manifest_path = out / f"{stem}.video.json"

        if not manifest_path.exists():
            continue

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        if manifest.get("_keyframes_done"):
            log(f"  skip (done)  {path.name}")
            continue

        pattern = str(frame_dir / f"{stem}__%04d.jpg")

        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
             "-vf", f"fps=1/{every_seconds}", "-q:v", "4", pattern],
            check=False,
        )

        frames = sorted(frame_dir.glob(f"{stem}__*.jpg"))

        log(f"  {path.name}: {len(frames)} frames")

        captions = []

        for number, frame in enumerate(frames):
            caption = ingest_media.describe_image(frame)

            if not caption or ingest_media.is_decorative(caption):
                continue

            # frames come out in order, one every `every_seconds`, so the
            # position in the list is the timestamp. that keeps the caption
            # deep-linked to the moment the slide was on screen.
            seconds = number * every_seconds
            captions.append(
                {
                    "start": f"{seconds // 60}:{seconds % 60:02d}",
                    "end": f"{(seconds + every_seconds) // 60}:{(seconds + every_seconds) % 60:02d}",
                    "description": f"On screen: {caption}",
                    "tags": ["slide"],
                }
            )

        if captions:
            # appended as extra segments in the same manifest, so a question can
            # match either what was said or what was shown, and the citation
            # opens the clip at the same place either way.
            manifest["videos"][0]["segments"].extend(captions)
            manifest["videos"][0]["segments"].sort(key=lambda s: _seconds(s.get("start")))

        manifest["_keyframes_done"] = True
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        log(f"    added {len(captions)} on-screen caption(s)")


def _seconds(stamp) -> int:
    if not isinstance(stamp, str):
        return 0

    parts = [int(p) for p in stamp.split(":") if p.isdigit()]

    return parts[0] * 60 + parts[1] if len(parts) == 2 else 0


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare a corpus for indexing.")
    parser.add_argument("--source", action="append", required=True, help="folder or file (repeatable)")
    parser.add_argument("--ocr-cache", default="data/ocr-cache")
    parser.add_argument("--media-out", default="data/media")
    parser.add_argument("--engine", default="auto", choices=["auto", "surya", "tesseract"])
    parser.add_argument("--inventory-only", action="store_true", help="report what would happen, change nothing")
    parser.add_argument("--skip-ocr", action="store_true")
    parser.add_argument("--skip-media", action="store_true")
    parser.add_argument("--no-keyframes", action="store_true", help="transcribe speech but ignore what is on screen")
    parser.add_argument("--run-build", action="store_true", help="run the index build at the end")
    args = parser.parse_args()

    sources = [Path(s) for s in args.source]
    missing = [s for s in sources if not s.exists()]

    if missing:
        for path in missing:
            log(f"does not exist: {path}")
        sys.exit(1)

    available = preflight()

    buckets = take_inventory(sources)
    report(buckets)

    if args.inventory_only:
        log("\ninventory only, nothing changed.")
        return

    # each stage is isolated. OCR needing a binary that is not installed must
    # not stop the video from being transcribed -- on the first real run it did
    # exactly that, and video never ran at all.
    if not args.skip_ocr and available.get("ocr"):
        try:
            run_ocr(buckets["pdf_scanned"], Path(args.ocr_cache), args.engine)
        except KeyboardInterrupt:
            log("\n  OCR interrupted -- carrying on with the rest. re-run to resume.")
        except Exception as error:  # noqa: BLE001
            log(f"\n  OCR stage failed: {str(error)[:160]}")
            log("  carrying on with the rest.")

    elif not args.skip_ocr and buckets["pdf_scanned"]:
        log(f"\nOCR: skipping {len(buckets['pdf_scanned'])} scanned PDFs -- no engine installed (see above).")

    if not args.skip_media:
        try:
            run_media(
                buckets,
                Path(args.media_out),
                keyframes=not args.no_keyframes and available.get("ffmpeg", True),
            )
        except KeyboardInterrupt:
            log("\n  media stage interrupted -- re-run to resume.")
        except Exception as error:  # noqa: BLE001
            log(f"\n  media stage failed: {str(error)[:160]}")

    # ---- hand off ---------------------------------------------------------
    build_sources = [str(s) for s in sources] + [args.media_out]
    quoted = " ".join(f'"{s}"' for s in build_sources)

    log("\n" + "=" * 62)
    log("prepared. now build the index:\n")
    log(f"  node --max-old-space-size=6144 bin/build-index.js {quoted}")
    log("\nthe build resumes, so only new material is embedded.")

    if args.run_build:
        log("\nrunning it now\n")
        subprocess.run(
            ["node", "--max-old-space-size=6144", "bin/build-index.js", *build_sources],
            check=False,
        )


if __name__ == "__main__":
    main()
