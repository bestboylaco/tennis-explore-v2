#!/usr/bin/env python3
"""turn video and images into something the index can search.

the pipeline can already read prose, slides, tables and video *descriptions*.
what it cannot do is look at a picture or listen to a clip. this closes that
gap by converting both into text, which is the only thing an embedding model
understands.

    video   -> whisper transcribes the audio into timestamped segments
    images  -> a local vision model writes a caption, and OCR pulls any text
               off the slide or chart

both come out as JSON manifests that the Node pipeline already knows how to
read, so `npm run build:index` picks them up with no code change. it lives
outside Node for the same reason the OCR tool does: this needs PyTorch and a
GPU, and the rest of the system needs neither.

what this is NOT: it does not "understand" video. it transcribes speech and
describes sampled frames. a clip with no narration and no distinctive visuals
will produce very little, and that is worth saying out loud rather than
implying the system watches tennis.

usage
-----
    # everything, the common case
    python tools/media/ingest_media.py --video "C:/.../VIDEO" --images "C:/.../IMAGES"

    # just look at what it would do
    python tools/media/ingest_media.py --video "C:/.../VIDEO" --dry-run

    # pull the figures out of the decks and caption them
    python tools/media/ingest_media.py --figures "C:/.../powerpoint-folder"

then re-run the index build; it resumes, so only the new material is embedded.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

def _register_nvidia_dll_dirs() -> None:
    """makes the GPU findable without a manual PATH export every session.

    faster-whisper's backend (ctranslate2) loads cuBLAS/cuDNN with a plain
    Win32 LoadLibrary call, which walks the legacy search order (app dir,
    System32, then PATH) -- it does NOT consult directories registered via
    Python's os.add_dll_directory, that only affects LoadLibraryEx-based
    loads. So on a machine with only the NVIDIA driver installed (no full
    CUDA Toolkit), where those DLLs come from the
    `nvidia-cublas-cu12`/`nvidia-cudnn-cu12` pip packages instead, the only
    thing that works is prepending their `bin/` folders to the real PATH
    env var before ctranslate2 is imported.
    """
    if os.name != "nt":
        return

    for package in ("nvidia.cublas", "nvidia.cudnn"):
        try:
            module = __import__(package, fromlist=["__path__"])
            bin_dir = Path(list(module.__path__)[0]) / "bin"

            if bin_dir.is_dir() and str(bin_dir) not in os.environ.get("PATH", ""):
                os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
        except Exception:  # noqa: BLE001
            pass


_register_nvidia_dll_dirs()

DEFAULT_OUT = Path("data/media")

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

OLLAMA = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
# llava:7b is ~4.7 GB and fits an 8 GB card alongside nothing else. moondream is
# ~1.7 GB and noticeably weaker but leaves room for the embedding model, which
# matters if you are captioning and indexing in the same session.
VISION_MODEL = os.environ.get("VISION_MODEL", "llava:7b")
# whisper "small" is ~0.5 GB and fine for clear speech; "medium" is ~1.5 GB and
# markedly better on accented or noisy audio, which conference recordings are.
WHISPER_SIZE = os.environ.get("WHISPER_SIZE", "small")


def log(message: str) -> None:
    print(message, flush=True)


def doc_id_for(path: Path) -> str:
    """must match the Node side's docId, or nothing lines up downstream."""
    return "".join(c if (c.isalnum() or c in "._-") else "_" for c in path.stem)


# ---------------------------------------------------------------------------
# video
# ---------------------------------------------------------------------------

def transcribe(paths: list[Path], out_dir: Path) -> int:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        log("faster-whisper is not installed.  pip install faster-whisper")
        return 0

    # int8 on cpu, float16 on gpu. loaded once -- reloading per file costs more
    # than transcribing a short clip.
    device = "cuda" if _has_cuda() else "cpu"
    compute = "float16" if device == "cuda" else "int8"

    log(f"loading whisper {WHISPER_SIZE} on {device} ({compute})")
    model = WhisperModel(WHISPER_SIZE, device=device, compute_type=compute)

    written = 0

    for path in paths:
        out_path = out_dir / f"{doc_id_for(path)}.video.json"

        if out_path.exists():
            log(f"  skip (done)  {path.name}")
            continue

        started = time.time()

        try:
            # vad_filter drops silence, which stops whisper hallucinating
            # sentences into gaps -- a real failure mode on footage that is
            # mostly ball noise and crowd.
            segments, info = model.transcribe(str(path), vad_filter=True, beam_size=5)

            entries = merge_segments(segments)
        except Exception as error:  # noqa: BLE001
            log(f"  FAILED  {path.name}: {str(error)[:120]}")
            continue

        if not entries:
            # no speech is a real outcome for rally footage. saying so beats
            # writing an empty manifest that hides the file from every later run.
            log(f"  no speech found in {path.name} -- not written")
            continue

        # exactly the shape the Node video extractor already reads, so no code
        # change is needed to index this.
        manifest = {
            "videos": [
                {
                    "video_id": doc_id_for(path),
                    "url": None,
                    # where the actual media file is. without this a citation
                    # points at this manifest instead of the recording, and
                    # clicking it serves a wall of json.
                    "source_path": str(path),
                    "title": path.stem.replace("-", " ").replace("_", " "),
                    "source": "transcript",
                    "language": getattr(info, "language", None),
                    "segments": entries,
                }
            ]
        }

        out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        written += 1

        log(f"  [{written}] {path.name}: {len(entries)} segments, {time.time() - started:.0f}s")

    return written


# how much speech goes in one chunk. whisper emits one segment per utterance --
# measured on a real talk: 575 segments, median 41 characters. embedded raw,
# each chunk is a single spoken line with nothing for the model to match on, and
# a citation lands on a fragment like "is critical for open-skilled sports"
# with no context around it.
#
# the document chunks target 1600 characters, and speech should be in the same
# range for the same reason. merging keeps the START of the first utterance and
# the END of the last, so the deep link still opens at the right moment.
TRANSCRIPT_WINDOW_CHARS = int(os.environ.get("TRANSCRIPT_WINDOW_CHARS", "1400"))


def merge_segments(segments) -> list[dict]:
    """joins consecutive utterances into windows of roughly a paragraph.

    accepts either whisper segment objects or plain dicts, so this can also
    repair a manifest that was written before the merging existed.
    """
    windows: list[dict] = []
    buffer: list[str] = []
    start = None
    end = None

    def flush():
        if not buffer:
            return

        text = " ".join(buffer).strip()

        if len(text) >= 40:
            windows.append({"start": start, "end": end, "description": text, "tags": []})

    for segment in segments:
        if isinstance(segment, dict):
            text = str(segment.get("description") or segment.get("text") or "").strip()
            seg_start, seg_end = segment.get("start"), segment.get("end")
            # already-written manifests carry "m:ss" strings, fresh whisper
            # output carries floats. both need to come out as "m:ss".
            seg_start = seg_start if isinstance(seg_start, str) else _timestamp(seg_start)
            seg_end = seg_end if isinstance(seg_end, str) else _timestamp(seg_end)
        else:
            text = segment.text.strip()
            seg_start, seg_end = _timestamp(segment.start), _timestamp(segment.end)

        if len(text) < 4:
            continue

        if start is None:
            start = seg_start

        buffer.append(text)
        end = seg_end

        if sum(len(part) + 1 for part in buffer) >= TRANSCRIPT_WINDOW_CHARS:
            flush()
            buffer, start, end = [], None, None

    flush()

    return windows


def _timestamp(seconds: float) -> str:
    seconds = int(seconds or 0)
    return f"{seconds // 60}:{seconds % 60:02d}"


def _has_cuda() -> bool:
    # faster-whisper runs on ctranslate2, not torch -- checking torch's own
    # CUDA build here was a false negative on this machine: a CPU-only torch
    # wheel was installed even though the GPU and ctranslate2 both work fine.
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------
# images
# ---------------------------------------------------------------------------

# ollama accepts png and jpeg. a pptx can also contain tiff, bmp, emf and wmf,
# and anything else comes back as HTTP 400 with no explanation -- 81 tiff files
# out of 5,979 figures did exactly that on the first real run.
#
# very large images 400 as well. resizing also makes captioning meaningfully
# faster, and a chart is perfectly legible at 1600px.
DIRECT_FORMATS = {".png", ".jpg", ".jpeg"}
MAX_EDGE_PIXELS = 1600


def _as_supported_image(path: Path) -> bytes | None:
    """returns png/jpeg bytes ollama will accept, converting if it has to."""
    suffix = path.suffix.lower()
    raw = path.read_bytes()

    needs_convert = suffix not in DIRECT_FORMATS or len(raw) > 4_000_000

    if not needs_convert:
        return raw

    try:
        import io as _io

        from PIL import Image

        with Image.open(_io.BytesIO(raw)) as image:
            image = image.convert("RGB")

            if max(image.size) > MAX_EDGE_PIXELS:
                ratio = MAX_EDGE_PIXELS / max(image.size)
                image = image.resize((int(image.width * ratio), int(image.height * ratio)))

            buffer = _io.BytesIO()
            image.save(buffer, format="PNG", optimize=True)

            return buffer.getvalue()
    except Exception:  # noqa: BLE001
        # vector formats like emf and wmf cannot be converted by pillow. those
        # are almost always diagrams drawn in powerpoint rather than data, so
        # skipping them costs little.
        return None


def describe_image(path: Path) -> str | None:
    """asks the local vision model what the picture shows.

    the prompt is deliberately concrete. asked to "describe this image" a vision
    model writes travel-brochure prose -- "a dynamic scene full of energy" --
    which is unsearchable. asking for the specific things a coach would search
    for produces text with actual nouns in it.
    """
    import urllib.request

    data = _as_supported_image(path)

    if data is None:
        return None

    payload = {
        "model": VISION_MODEL,
        "prompt": (
            "You are cataloguing figures from a sports science archive.\n\n"
            "FIRST decide whether this image carries information. Logos, title-page "
            "artwork, decorative photographs, headshots, backgrounds and stock imagery "
            "carry none. If it is one of those, reply with exactly: SKIP\n\n"
            "Otherwise describe it factually in two or three sentences: the chart type "
            "and what it measures, the axis labels and any numbers you can read, the "
            "stroke or movement if a player is shown, and any readable text. "
            "No adjectives, no scene-setting, no speculation. Start with the noun."
        ),
        "images": [base64.b64encode(data).decode("ascii")],
        "stream": False,
        "options": {"temperature": 0},
    }

    request = urllib.request.Request(
        f"{OLLAMA}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read()).get("response", "").strip() or None
    except Exception as error:  # noqa: BLE001
        log(f"    vision model failed: {str(error)[:100]}")
        return None


_OCR_WARNED = False


def read_text_in_image(path: Path) -> str:
    """OCR, for the text a caption will not reproduce.

    a caption says "a bar chart of injury counts by year". the OCR says
    "2021 12, 2022 15, 2023 18". the second one is what answers a question, so
    both go into the indexed text.
    """
    global _OCR_WARNED

    try:
        import pytesseract
        from PIL import Image

        return pytesseract.image_to_string(Image.open(path)).strip()
    except ImportError:
        # said once, loudly. silently returning "" means every chart is indexed
        # by its description and none of its numbers -- and the numbers are the
        # half that answers questions. a first run produced 765 captions and
        # zero OCR text without anything saying why.
        if not _OCR_WARNED:
            _OCR_WARNED = True
            log("")
            log("  !! pytesseract is not installed, so NO text is being read out of the")
            log("     images -- only the model's description. The numbers on a chart are")
            log("     the part that answers questions. Install it and re-run:")
            log("       pip install pytesseract pillow")
            log("     (also needs the Tesseract binary: https://github.com/UB-Mannheim/tesseract/wiki)")
            log("")
        return ""
    except Exception:  # noqa: BLE001
        return ""


# phrases a vision model uses when there is nothing to describe. an image whose
# caption says "no visible text or chart" is furniture, and indexing it adds a
# chunk that matches vaguely against everything and answers nothing.
DECORATIVE_MARKERS = (
    "skip",
    "no visible text",
    "no text or chart",
    "no chart",
    "does not contain any text",
    "appears to be a logo",
    "is a logo",
    "decorative",
    "stock photo",
)


def is_decorative(caption: str) -> bool:
    lowered = caption.strip().lower()

    if lowered.startswith("skip") or lowered == "skip.":
        return True

    # only trust the marker phrases near the start; a long caption that mentions
    # "no chart" halfway through is usually still describing something real.
    return any(marker in lowered[:160] for marker in DECORATIVE_MARKERS)


def caption_images(paths: list[Path], out_dir: Path, source_label: str = "image") -> int:
    entries = []
    skipped_decorative = [0]
    out_path = out_dir / f"{source_label}-captions.images.json"

    existing = {}

    if out_path.exists():
        # resumable: captioning is ~2-6 seconds a picture and a slide deck
        # library has thousands.
        for item in json.loads(out_path.read_text(encoding="utf-8")).get("images", []):
            existing[item["image_id"]] = item

    for index, path in enumerate(paths, start=1):
        image_id = f"{doc_id_for(path)}"

        if image_id in existing:
            entries.append(existing[image_id])
            continue

        caption = describe_image(path)

        if not caption or is_decorative(caption):
            skipped_decorative[0] += 1
            continue

        text_in_image = read_text_in_image(path)

        entries.append(
            {
                "image_id": image_id,
                "path": str(path),
                "title": path.stem.replace("-", " ").replace("_", " "),
                "caption": caption,
                "ocr_text": text_in_image,
                "source_document": None,
                "page": None,
            }
        )

        if index % 5 == 0 or index == len(paths):
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps({"images": entries}, indent=2), encoding="utf-8")
            log(f"  [{len(entries)}/{len(paths)}] captioned, checkpointed")

    if entries:
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps({"images": entries}, indent=2), encoding="utf-8")

    if skipped_decorative[0]:
        log(f"  skipped {skipped_decorative[0]} decorative image(s) -- logos, title art, headshots")

    return len(entries)


# ---------------------------------------------------------------------------
# figures inside documents
# ---------------------------------------------------------------------------

def extract_figures(source_dir: Path, work_dir: Path) -> list[Path]:
    """pulls the pictures out of decks and pdfs.

    this is where the real value is in this corpus. the presentation library is
    11.5 GB for 292 decks -- roughly 40 MB each -- and a slide averages 412
    characters of text. the substance is in the charts, and until now the index
    held the caption-free remainder.
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    found: list[Path] = []

    # a pptx is a zip; its images sit in ppt/media/ already as jpg or png.
    import zipfile

    for deck in sorted(source_dir.rglob("*.pptx")):
        try:
            with zipfile.ZipFile(deck) as archive:
                for name in archive.namelist():
                    if not name.startswith("ppt/media/"):
                        continue

                    suffix = Path(name).suffix.lower()

                    if suffix not in IMAGE_EXT:
                        continue

                    data = archive.read(name)

                    # skip icons, bullets and logos. anything under ~20 KB is
                    # furniture, and captioning it wastes minutes per deck.
                    if len(data) < 20_000:
                        continue

                    target = work_dir / f"{doc_id_for(deck)}__{Path(name).name}"

                    if not target.exists():
                        target.write_bytes(data)

                    found.append(target)
        except Exception as error:  # noqa: BLE001
            log(f"  could not open {deck.name}: {str(error)[:80]}")

    return found


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def collect(target: str | None, extensions: set[str]) -> list[Path]:
    if not target:
        return []

    path = Path(target)

    if path.is_file():
        return [path] if path.suffix.lower() in extensions else []

    return sorted(p for p in path.rglob("*") if p.suffix.lower() in extensions)


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe video and caption images for indexing.")
    parser.add_argument("--video", help="file or folder of video to transcribe")
    parser.add_argument("--images", help="folder of standalone images to caption")
    parser.add_argument("--figures", help="folder of pptx files to pull figures out of and caption")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="where manifests are written")
    parser.add_argument("--limit", type=int, default=0, help="stop after N items, for a quick trial")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--remerge",
        action="store_true",
        help="re-window existing transcripts in --out without re-transcribing",
    )
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.remerge:
        fixed = 0

        for manifest_path in sorted(out_dir.glob("*.video.json")):
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

            for video in manifest.get("videos", []):
                before = len(video.get("segments", []))
                video["segments"] = merge_segments(video.get("segments", []))
                after = len(video["segments"])

                log(f"  {manifest_path.name}: {before} -> {after} segments")

            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            fixed += 1

        log(f"\nre-windowed {fixed} transcript(s). no re-transcription needed.")
        return

    videos = collect(args.video, VIDEO_EXT)
    images = collect(args.images, IMAGE_EXT)
    figures: list[Path] = []

    if args.figures:
        figures = extract_figures(Path(args.figures), out_dir / "figures")
        log(f"pulled {len(figures)} figures out of the decks")

    if args.limit:
        videos, images, figures = videos[: args.limit], images[: args.limit], figures[: args.limit]

    log(f"\n{len(videos)} video, {len(images)} images, {len(figures)} figures")

    if args.dry_run:
        for path in (videos + images + figures)[:30]:
            log(f"  would process {path.name}")
        return

    if videos:
        log("\ntranscribing video")
        transcribe(videos, out_dir)

    if images:
        log(f"\ncaptioning images with {VISION_MODEL}")
        caption_images(images, out_dir, "standalone")

    if figures:
        log(f"\ncaptioning slide figures with {VISION_MODEL}")
        caption_images(figures, out_dir, "figures")

    log(f"\nwritten to {out_dir}/")
    log("now re-run the index build and point it at that folder as well:")
    log(f'  node --max-old-space-size=6144 bin/build-index.js ... "{out_dir}"')


if __name__ == "__main__":
    main()
