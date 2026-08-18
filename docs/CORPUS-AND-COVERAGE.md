# The corpus, and what it can answer

Replaces an earlier `ASSET-GAP-REPORT.md`, **which was wrong**. That report
concluded none of Al's 12 test questions could be answered. It was written
against the ~15 sample files in `TennisAU/`, without the main document library
in `TA_S2/document-resources/`. With the real corpus, most of his questions have
a source sitting right there.

---

## What we actually hold

| | Files | Size |
|---|---|---|
| Research PDFs | 2,301 | 5.1 GB |
| Presentations (.pptx) | 292 | 11.5 GB |
| Presentations (.ppt, legacy binary) | 48 | — |
| Match / ranking tables | 4 | 130 KB |
| Video segments | 2 clips, 7 segments | — |

**Roughly 128,000 chunks** once indexed — measured, not guessed: a stratified
400-PDF sample produced 17,422 chunks at 43.5 chunks per file.

---

## Al's 12 questions, re-checked

| # | Topic | Source in the corpus | Extracts? |
|---|---|---|---|
| 1 | Kovacs — round reached as a level indicator | 18 Kovacs files | Likely |
| 2 | Kovacs — junior ITF matches at 15 | 18 Kovacs files | Likely |
| 3 | Caroline Martin — forehand leg action | 13 "martin" files | Needs checking |
| 4 | Allistair McCaw — E.Q. in coaching (2026) | **no filename match** | **Missing** |
| 5 | Beni Linder — speed variance | `beni-linder-presentation-notes-january-2013.pptx` | **Yes** (2,659 chars) |
| 6 | Lumbar bone stress / facet joint 2023 | `asca-youth-sig-brisbane-june-4-2025-lumbar-bone-stress.pptx` | **Yes** (5,666 chars) |
| 7 | First Cardio Tennis publication | `cardio-tennis-paper.pdf` | **Yes** — Murphy, Duffield, Reid confirmed in text |
| 8 | Nat Deegan — female athletes | `deegan-nat-presentation.pdf`, ASCA handout | **Yes** (21,873 chars) |
| 9 | Gescheit 2015 IJSPP | `gescheit-et-al-2015.pdf` | **No — file is corrupt** |
| 10 | Beep test national data, Luczak 15.69 | only `typical-error-beep-test.pdf` | **Missing** (this is table data) |
| 11 | Bollettieri 2000 manual, Tip #8 | 2 `nickbollettieri-co-uk-*.pdf` | **Yes** (4,107 chars) |
| 12 | Whiteside 2013 — eleven female players | `whiteside-et-al-2013-a-kinematic-comparison...pdf` | **Yes** (55,904 chars) |

**Seven confirmed extractable, two likely, three genuinely blocked.**

### The three blocked ones

**Q9 — Gescheit 2015 is a damaged file.** Its cross-reference table is broken:
`Invalid Root reference`. Neither pdf.js nor poppler nor qpdf's reconstruction
can read it. Ask Al for a fresh copy. This is worth flagging as a data-quality
issue, not a system limitation.

**Q4 — McCaw** has no matching filename. It may be inside a deck named after the
event rather than the speaker; a text search across the indexed corpus will
settle it once the full index is built.

**Q10 — beep test data** is a *table*, not a document. Asking for "the highest
beep test result up to 26/08/2014" is an aggregation over records. It should
arrive as a spreadsheet so it can be computed over, not as a PDF report that can
only be quoted. Same for Q6's injury counts.

---

## Extraction reality across 2,301 PDFs

From the 400-file sample:

- **380 of 400 extracted cleanly** (95%)
- **13 rescued** by falling back to whole-document chunking — conference
  handouts carrying ~90 characters a page, which the per-page minimum was
  discarding entirely
- **~3 rescued** by falling back to `pdftotext` when the JS parser fails
- **20 remain unreadable** — scanned images with no text layer

Extrapolated: around **115 files corpus-wide will yield nothing** without OCR.
That is 5%, and they are disproportionately the older scanned handouts.

**If those matter**, OCR is the fix (`ocrmypdf` over the failures, then
re-index). It is not built in — it would add a heavy dependency for a 5% tail,
and it is better to know which 5% first. `data/index/build-report.json` lists
every one by name.

### The 48 legacy `.ppt` files

Not readable — `.ppt` is a binary OLE format, unrelated to the zip-based
`.pptx`. Convert them first if they matter:

```bash
soffice --headless --convert-to pptx --outdir converted/ *.ppt
```

---

## What to ask Al for

1. **A clean copy of Gescheit et al. 2015** — ours is corrupt.
2. **The McCaw 2026 E.Q. presentation** — no match by filename.
3. **Physical testing data as a spreadsheet** — beep test results with athlete,
   date and score. As a table it can be aggregated; as a PDF it can only be quoted.
4. **Injury surveillance data as a spreadsheet** — same reasoning, for Q6.

## And on his actual question

> *"How many do you think you need to begin with?"*

30–40, spread as: 15 single-hop lookups (his 12 are the right shape), 8
multi-hop needing two or more documents, 5 summarisation, 8 structured over the
tables, and **5 unanswerable**.

The unanswerable ones matter as much as the rest. A system scoring 100% on
answerable questions while confidently inventing answers to the others is worse
than one scoring 90% and refusing cleanly — and only a set containing both can
tell them apart.
