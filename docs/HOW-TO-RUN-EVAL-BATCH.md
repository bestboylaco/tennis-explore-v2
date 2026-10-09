# How to run an overnight evaluation batch

What this is: a script that runs a whole list of questions through the real pipeline — once at Low effort, once at High effort — and writes every answer, its citations, and its grounding stats into one spreadsheet. Built for the "leave it running overnight, review the spreadsheet in the morning" workflow.

You do **not** need the web app, MongoDB, or DynamoDB running for this. It calls the answer pipeline directly, in-process. You only need **Ollama running**.

---

## 1. Edit the question list

Questions live in a JSON file under `queries/`. The one from the first run is `queries/overnight_batch_2026-10-01.json` — open it in any editor. It's a plain array:

```json
[
  { "question": "What causes heat cramps in tennis players?", "expectedSource": "bergeron-et-al-2003 (heat cramps)" },
  { "question": "How does serve speed differ by surface?", "expectedSource": "gao-2026 (WTA serve velocity)" }
]
```

- `question` — required, exactly what you'd type into the chat box.
- `expectedSource` — optional, just a note-to-self for your own review (which document you expect this to cite). The script doesn't check it or score against it; it's only there so you can eyeball mismatches yourself in the spreadsheet later.

**For a new run**, don't edit the old file in place — copy it to a new one instead (e.g. `queries/my-next-batch.json`), so the old run's results stay intact and comparable. Add, remove, or edit questions freely.

## 2. Make sure Ollama is running

```
ollama serve
```

(If it's already running, this just says so and does nothing — harmless to run anyway.)

## 3. Run it

```
node bin/overnight-batch-run.mjs queries/my-next-batch.json
```

If you leave the path off, it defaults to the original `queries/overnight_batch_2026-10-01.json`.

It will print one line per question as it finishes, something like:

```
136 questions x 2 effort levels, low effort first, then high
writing to eval-runs/my-next-batch.xlsx after every question

[low] (104s) What causes heat cramps in tennis players?... -- 3 citations, cited 0.8
[low] (98s) How does serve speed differ by surface?... -- 5 citations, cited 1
...
```

It runs **every question at Low effort first, then every question again at High effort** — not interleaved.

## 4. Leave it running

Each question takes roughly 90–150 seconds. For 136 questions × 2 effort levels, budget **8–14+ hours** — it will likely still be running when you wake up, and that's fine.

Two things that will kill it if they stop:
- **Ollama must keep running** the whole time.
- **The machine must not sleep.** Check your power settings if you're leaving it overnight.

It is **safe to stop and restart**. If you close the terminal, the machine reboots, or it crashes partway through, just run the exact same command again — it skips every question it already finished and picks up where it left off. Nothing is lost except, at most, the one question that was in progress when it stopped.

## 5. Where the results land

Everything is named after your query file, so `queries/my-next-batch.json` produces:

| File | What it is |
|---|---|
| `eval-runs/my-next-batch.xlsx` | **The one to open.** One row per (question, effort) pair — question, intent/route, grounding stats, citation count, the full answer, a path to the full prompt text. Rewritten after every single question, so it's always safe to open mid-run. |
| `eval-runs/my-next-batch.progress.json` | Internal checkpoint — this is what makes resuming possible. No need to open it. |
| `eval-runs/prompts/my-next-batch/*.txt` | The **exact** system prompt + evidence text sent to the model for every generation call on that question (and the repair-pass call too, if one fired). The spreadsheet's `full_prompt_text` column has a short preview plus the path to the matching file here. |

A different query file never touches another run's output — each gets its own `.xlsx`/`.progress.json`/prompt folder, so you can keep several batches around to compare.

## 6. Reading the spreadsheet

Columns worth sorting/filtering by:
- `cited_fraction` — 1.0 means every factual sentence carried a citation; lower means some didn't.
- `grounded` — false if any *high-severity* problem was flagged (a citation pointing at nothing, a figure with no source, a figure attributed to the wrong one) — a stronger signal than `cited_fraction` alone.
- `warnings` — which specific problem(s), if any.
- `cited_doc_ids` / `cited_titles` — what the answer actually cited, to eyeball against your own `expected_source` note.
- `duration_ms` — how long that one question took.
- `error` — non-empty if that question failed outright (network hiccup, timeout). It's recorded as a row, not a crash — safe to ignore a handful of these, or just rerun the batch afterward to retry them (the resume logic only skips *successful* rows).

## Troubleshooting

**"Could not reach the language model at http://localhost:11434"** — Ollama isn't running. `ollama serve`, then rerun the same command.

**It's much slower than expected** — High effort pulls in more evidence per question and is expected to take longer than Low; this is normal, not stuck. Check the terminal is still printing a new line every minute or two.

**I want to stop it early** — close the terminal or Ctrl+C. Whatever's in the `.xlsx` at that point is complete and safe to open; nothing from already-finished questions is lost.
