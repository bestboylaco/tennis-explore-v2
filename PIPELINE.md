# From S3 to answers

The whole path, in order. One preparation command handles every content type;
you should not have to know which treatment a given file needs.

---

## 0. Python 3.14 will not work

Pillow, PyTorch and Surya have no wheels for 3.14 yet. Use 3.12:

```powershell
winget install Python.Python.3.12       # if you don't have it

cd C:\Users\User\Documents\Claude\Projects\TennisAUS\tennis-explore-v2
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1

pip install faster-whisper pypdfium2 pytesseract pillow
```

You'll see `(.venv)` at the start of your prompt. That's the shell to run the
Python tools from. **Node is unaffected** — `npm run ask` and the index build
don't care.

Optional extras:

| | |
|---|---|
| `pip install surya-ocr` | better OCR on GPU than Tesseract |
| Tesseract binary — [UB-Mannheim](https://github.com/UB-Mannheim/tesseract/wiki) | needed for the CPU OCR path and for reading text off charts |
| `winget install Gyan.FFmpeg` | needed to caption what's on screen in video |

---

## 1. Pull from S3

```powershell
aws s3 sync s3://YOUR-BUCKET/ "C:\Users\User\Desktop\TA_S2\document-resources"
```

Resumable and skips what it already has. `--dryrun` first to see the volume.

---

## 2. Prepare — one command, all content types

```powershell
# see what you have and what it would do. changes nothing.
python tools\prepare_corpus.py --source "C:\Users\User\Desktop\TA_S2\document-resources" --inventory-only
```

It walks everything, and for PDFs it **opens each one and checks whether it has
a text layer** rather than trusting the extension. Output looks like:

```
inventory
--------------------------------------------------------------
    2131  PDF with a text layer      indexed as-is
     144  PDF that is scanned        needs OCR
      12  PDF that will not open     needs a fresh copy
      10  PDF over the size limit    listed, not processed
     292  PPTX                       text as-is, figures captioned
       6  video                      transcribed + slides captioned
     297  already indexable          nothing to do
```

Then run it for real:

```powershell
python tools\prepare_corpus.py --source "C:\Users\User\Desktop\TA_S2\document-resources"
```

| It finds | It does |
|---|---|
| PDF with text | nothing — the indexer reads it directly |
| PDF that is scanned | OCR into `data\ocr-cache\` |
| PDF that won't open | lists it; the file is corrupt, ask for another copy |
| PPTX | text read directly; **figures extracted and captioned** |
| Video | speech transcribed, **and slides on screen captioned** |
| Images | captioned, plus OCR for any text |
| CSV / XLSX / JSON | nothing |

**Resumable and idempotent.** Run it again after adding files and it only does
the new ones.

Useful flags: `--skip-media`, `--skip-ocr`, `--no-keyframes`, `--run-build`.

---

## 3. Build the index

```powershell
node --max-old-space-size=6144 bin/build-index.js `
  "C:\Users\User\Desktop\TA_S2\document-resources" `
  data\media
```

`prepare_corpus.py` prints this exact line with your paths filled in.

Checkpoints every 25 files. Ctrl-C, a crash or a closed laptop costs minutes,
not the run.

---

## 4. Ask

```powershell
npm run ask -- "what does the research say about serve volume?"
npm start        # web UI at http://localhost:3000
```

---

## What forces a rebuild, and what does not

This is the question that decides the order of everything else.

**No rebuild** — read at query time, change and restart:

```
TOP_N                 how many chunks reach the model
MAX_CONTEXT_CHARS     how much text they may total
RERANK_*              reranking strategy and window
EXPANSION_ENABLED     query rephrasing
GRADING_ENABLED       evidence grading
OLLAMA_GENERATION_MODEL   the model that writes answers
```

**Full rebuild** — these are baked into every chunk:

```
EMBEDDING_MODEL / EMBEDDING_DIMENSION
CHUNK_TARGET_CHARS / CHUNK_OVERLAP_CHARS
CONTEXTUAL_ENABLED / CONTEXTUAL_MODE
the index schema
```

The build refuses to resume if you change one of the second group, because
mixing vectors from two embedding spaces produces an index that loads without
error and returns quiet nonsense.

**Adding new material is not a rebuild.** Prepare it, re-run the same build
command, and only the new files are embedded.

---

## How video is handled

Two independent passes, and both end up in the same manifest:

**Speech** — Whisper transcribes, and consecutive utterances are merged into
~1,400-character windows. Whisper emits one segment per utterance; measured on a
real talk that was 575 segments at a median of **41 characters**, which is far
too small to embed usefully. Merged, the same talk becomes 18 windows. The first
start and last end time are kept, so citations still open at the right moment.

**What's on screen** — a frame every 45 seconds, captioned by a local vision
model, added as extra segments tagged `slide`.

That second pass matters more than it sounds for lecture recordings. A speaker
says *"as you can see here"* and everything that matters is in the picture. One
frame per 45 seconds is a deliberate compromise: slides change on roughly that
timescale, and captioning costs 2–6 seconds a frame, so a 40-minute talk is
about 50 frames rather than thousands.

Needs `ffmpeg` on PATH. Without it, speech is still transcribed and it says so.

**What this is not:** it doesn't understand tennis from footage. It transcribes
speech and describes sampled frames. A rally clip with no narration and no
graphics produces very little, and that's worth saying rather than implying
otherwise.
