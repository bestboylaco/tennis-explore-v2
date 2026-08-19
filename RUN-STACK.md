# Run stack

Everything runs from:

```
C:\Users\User\Documents\Claude\Projects\TennisAUS\tennis-explore-v2
```

Nothing here pushes to git.

---

## 0. Once, after pulling changes

```powershell
cd C:\Users\User\Documents\Claude\Projects\TennisAUS\tennis-explore-v2
npm install
npm test
```

Expect **115 passing**. If not, stop — nothing below will behave.

---

## 1. Build the full index

This is the long one. Two to four hours on an 8 GB card, roughly 128,000 chunks.

```powershell
$env:OLLAMA_NUM_PARALLEL="4"
ollama serve
```

Leave that window open. **In a second PowerShell window:**

```powershell
cd C:\Users\User\Documents\Claude\Projects\TennisAUS\tennis-explore-v2

Remove-Item -Recurse -Force data\index -ErrorAction SilentlyContinue

node --max-old-space-size=6144 bin/build-index.js `
  "C:\Users\User\Desktop\TA_S2\document-resources\research-pdfs" `
  "C:\Users\User\Desktop\TA_S2\document-resources\powerpoint-folder" `
  "C:\Users\User\Desktop\TA_S2\document-resources\match-data" `
  data\video
```

Leave it overnight.

**It checkpoints every 25 files.** If it crashes, you close the laptop or you
press Ctrl-C, run the *exact same command again* and it resumes. It refuses to
resume if you changed the model or chunk size, because mixing two embedding
spaces produces an index that loads fine and returns nonsense.

### Optional: OCR the ~5% that are scanned images

Only worth doing after the main build, and it needs a second build pass:

```powershell
pip install surya-ocr pypdfium2
python tools\ocr\ocr_scanned.py --from-report data\index\build-report.json --source-dir "C:\Users\User\Desktop\TA_S2\document-resources" --dry-run
```

Drop `--dry-run` to run it, then repeat the build command — it resumes, so only
the newly readable documents get embedded.

---

## 2. Test queries

Everything defaults to the **admin** role now, so nothing is filtered out unless
you ask for it.

### Documents — should answer with citations

```powershell
npm run ask -- "what does the research say about serve volume during tournaments?"
npm run ask -- "what percentage of a year's training is disrupted by a lumbar stress fracture?"
npm run ask -- "how many strokes were manually coded in the PhD study?"
npm run ask -- "who were the authors of the first Cardio Tennis publication?"
npm run ask -- "according to Beni Linder, what percentages of speed should players vary between?"
npm run ask -- "what does Nat Deegan present on?"
npm run ask -- "how many female tennis players were recruited in the Whiteside 2013 study?"
```

### Multi-source — should cite two or more different documents

```powershell
npm run ask -- "what does the research say about accelerometer load in matches compared with training, and how does the Catapult programme apply it?"
npm run ask -- "how was the wearable stroke detection algorithm validated, and what was it then used to measure?"
```

### Summarisation — should group by theme, not by document

```powershell
npm run ask -- "summarise what we know about lumbar stress injuries in junior players"
npm run ask -- "give me an executive summary of the wearable technology research"
```

### Tables — computed, not retrieved. Expect a table and the SQL

```powershell
npm run ask -- "how many matches were played on each surface?"
npm run ask -- "what is the median singles ranking per month?"
npm run ask -- "compare wins and losses on hard courts versus clay"
npm run ask -- "what is Carlos Alcaraz's best ranking in the match data?"
```

### Video — should cite a clip with a timestamp

```powershell
npm run ask -- "find footage of a defensive to offensive transition"
```

### Must refuse — these are the important ones

```powershell
npm run ask -- "what was Novak Djokovic's serve speed at the 2019 Australian Open final?"
npm run ask -- "what was the highest beep test result in the national data up to 26/08/2014?"
npm run ask -- "what does Allistair McCaw list as the E.Q. skills in coaching?"
```

Expect: *"The knowledge base does not contain an answer to this question."*

An answer here is worse than a wrong answer elsewhere — it means the system is
inventing.

### Access control — the same question, two roles

```powershell
npm run search -- --role admin   "athlete heart rate monitoring"
npm run search -- --role analyst "athlete heart rate monitoring"
```

Admin sees the confidential match records. Analyst does not.

### Score the whole set

```powershell
npm run eval:answers
```

Writes `evidence/answer_evaluation.json`. Watch the **abstention** row: a system
scoring well everywhere else while answering the unanswerable is worse than one
scoring lower and refusing cleanly.

---

## 3. The web UI

```powershell
npm start
```

Open <http://localhost:3000> and press **Ctrl+Shift+R** the first time — the
browser caches CSS, JS and even 404 responses aggressively.

- `/` — landing
- `/platforms` — the integrated platforms
- `/explore` — ask questions

The chat page returns the same thing the console does: the answer, the table and
SQL when the question was answered from records, and citation buttons that open
the source beside the conversation at the cited page, slide or timestamp.

The **role picker** sits in the header and defaults to Admin. Switch it to
Analyst and ask about heart rate monitoring to show the access filter working.

Needs MongoDB running. `npm run ask` does not.

---

## What is safe to change later, and what forces a rebuild

You do **not** have to redo the embedding to tune any of this:

| Change | Rebuild? |
|---|---|
| Rerank window, batch size, `OLLAMA_NUM_PARALLEL` | No |
| Query routing and the classifier | No |
| Prompts, grading thresholds, abstention wording | No |
| Roles, access rules, the UI | No |
| **Index schema fields** | **Yes, full rebuild** |
| Chunk size or overlap | **Yes** |
| Contextual header mode | **Yes** |
| Title extraction | **Yes** |
| Embedding model or dimension | **Yes**, and resume is refused |

So settle the schema first, run the long build once, then tune freely.

---

## When something goes wrong

| Symptom | Cause |
|---|---|
| `Could not reach the language model` | Ollama isn't running → `ollama serve` |
| `no index found at data/index` | Build hasn't run |
| `returns N-dimension vectors but config says M` | `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` disagree in `.env` |
| `will not resume` | Model or chunk size changed — delete `data\index` and rebuild |
| `JavaScript heap out of memory` | Add `--max-old-space-size=6144` |
| `ROUTE_NOT_FOUND` in the browser | Cached 404 — Ctrl+Shift+R, or check for a stale `node` process on port 3000 |
| Answers are vague | Run `npm run search` on the same question. If the right chunk isn't in that list it's retrieval, not the prompt |
| A table question refuses | The planner couldn't map your wording to a column. `npm run ask -- --json` shows why; column names come from the file headers |
