# Asset gap: Al's 12 test questions

**Short version: none of the 12 can be answered from the material we currently
hold.** Every one of them points at a source that has not been supplied.

That is a good result rather than a bad one — the questions are exactly right,
they just describe a library roughly ten times the size of our sample set. The
system now abstains cleanly on all of them (`ABS-01` through `ABS-03` in
`queries/gold_set.json` cover this), which is the behaviour Al asked for:
*"clear responses that state that the answer doesn't seem to exist in the
knowledge base and doesn't hallucinate."*

---

## What we currently hold

| Type | Items | What they are |
|---|---|---|
| Research papers | 9 PDFs | Perri et al. wearables and periodisation work, one conditioning guide |
| Presentations | 2 PPTX | Catapult NDP deck (27 slides), TP Performance presentation (9 slides) |
| Video | 2 clips | 7 described segments with timestamps |
| Tables | 4 files | Match data (2 CSV + 1 XLSX), rankings CSV |

636 indexed chunks in total.

---

## Question by question

| # | Question is about | Source needed | Have it? |
|---|---|---|---|
| 1 | Mark Kovacs — tournament round as a level indicator | Kovacs presentation or article | No |
| 2 | Mark Kovacs — junior ITF match counts at age 15 | Kovacs dataset or slides | No |
| 3 | Caroline Martin — leg action in a neutral forehand | Martin presentation or paper | No |
| 4 | Allistair McCaw — E.Q. skills in coaching (2026) | McCaw 2026 presentation | No |
| 5 | Beni Linder — speed variance principle | Linder presentation | No |
| 6 | 2023 lumbar bone stress + facet joint sprain counts | TA pathway injury surveillance data | **Partly** |
| 7 | First Cardio Tennis publication, Murphy/Duffield/Reid 2014 | That 2014 paper | No |
| 8 | Nat Deegan — female athlete performance | Deegan presentation | No |
| 9 | Gescheit 2015 IJSPP — consecutive days of match play | That 2015 paper | No |
| 10 | Beep test results to 26/08/2014, Peter Luczak 15.69 | S&C national testing spreadsheet | No |
| 11 | Bollettieri 2000 manual, Tip #8 | That manual | No |
| 12 | Whiteside 2013 — eleven female players recruited | That 2013 paper | No |

**On question 6** — the Catapult NDP deck does cover lumbar bone stress injuries
(mechanism, the bone stress continuum, developmental cost, risk factors) and
carries a "36% of total lumbar injuries have occurred in the past 3 years"
figure. It does **not** contain a 2023 count of 18, and it says nothing about
facet joint sprains. So the topic is present and the specific number is not —
which is the worst case for a RAG system, because there is plausible-looking
nearby material for a model to drift onto. It is worth keeping as a test.

---

## What to ask Al for

Grouped so it can be sent as one request.

**1. Conference and coach education presentations** — the largest single gap, and
six of the twelve questions live here.

> Kovacs, Caroline Martin, Allistair McCaw, Beni Linder, Nat Deegan, and any
> others in the same series. Slides are ideal; recordings with transcripts are
> better still.

**2. The research library** — we have nine papers and the questions imply a
proper collection.

> Specifically: Murphy, Duffield & Reid 2014 (Cardio Tennis), Gescheit 2015
> (IJSPP), Whiteside 2013. More usefully: whatever the full reference list is,
> rather than paper by paper.

**3. Coaching manuals** — the Bollettieri 2000 manual, and anything comparable.

**4. Injury surveillance data** — for question 6. A table of injuries by year,
body region and diagnosis across the pathway.

**5. Physical testing data** — for question 10. Beep test and related results
with athlete, date and score. Note this one is *structured*: it should be a
spreadsheet, not a PDF, so it can be aggregated rather than only quoted.

---

## Two things worth raising with him

**Questions 6 and 10 are structured questions in disguise.** "How many injuries
in 2023" and "who scored highest on the beep test" are aggregations over
records. If those arrive as PDF reports we can only quote whatever sentence
happens to state the total; if they arrive as spreadsheets we can compute any
cut of them and show the working. Worth asking for the underlying data rather
than the report.

**Ten of the twelve are single-hop lookups.** They test retrieval precision
well and say little about multi-hop reasoning or summarisation, which is where
these systems usually fail. Our own set in `queries/gold_set.json` adds
multi-source and summarisation cases, and it would be worth asking Al for a
few too — questions whose answer genuinely requires two documents, and a few
where the honest answer is "not in the knowledge base", so refusal gets
measured alongside recall.

---

## Answering his actual question

> *"How many do you think you need to begin with?"*

Around 30–40 to start, spread as:

- 15 single-hop lookups (his current 12 are the right shape)
- 8 multi-hop, requiring two or more documents
- 5 summarisation
- 8 structured — lookups, comparisons and aggregations over the tables
- 5 unanswerable, to measure refusal

The unanswerable ones matter as much as the rest. A system scoring 100% on
answerable questions while confidently inventing answers to the other five is
worse than one scoring 90% and refusing cleanly — and only a set containing both
can tell the two apart.
