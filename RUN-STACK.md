# Run stack — no pushing

Everything below runs from:

```
C:\Users\User\Documents\Claude\Projects\TennisAUS\tennis-explore-v2
```

Open PowerShell there and work top to bottom. Nothing here touches git.

---

## 0. Setup, once

```powershell
cd C:\Users\User\Documents\Claude\Projects\TennisAUS\tennis-explore-v2
npm install
copy .env.example .env
```

Then pull the models (~7 GB, once):

```powershell
ollama pull bge-m3
ollama pull llama3.1:8b
```

**Only two.** Do not try `ollama pull bge-reranker-v2-m3` — it fails, because
that model isn't in Ollama's library and Ollama has no rerank endpoint anyway.
Reranking runs through `llama3.1:8b` in batches and needs nothing extra.

Optional, if you want a real cross-encoder later (better ordering, ~1.1 GB more
VRAM):

```powershell
pip install fastapi uvicorn sentence-transformers
python tools\rerank\rerank_server.py
```

then set `RERANK_STRATEGY=service` and `RERANK_API_URL=http://localhost:8787/rerank`
in `.env`. Do this *after* everything below is working — it's an upgrade, not a
prerequisite.

---

## 1. Tests first — 30 seconds, no models needed

```powershell
npm test
```

**Expect: 109 passing, 0 failing.** If this fails, stop — nothing below will
behave.

This covers access control, RRF fusion, the query engine's validation guards,
int8 quantisation bounds, citation binding, abstention detection, and the source
panel in a real DOM.

---

## 2. Check the machine is ready

```powershell
npm run check:models
```

Tells you whether Ollama is running and which of the three models are present,
before you spend hours finding out.

---

## 3. Smoke test with no models at all

Proves the whole pipeline works before you commit to a long build. Uses a fake
offline embedder — results are meaningless, but every stage runs.

```powershell
$env:EMBEDDING_PROVIDER="hash"; $env:EMBEDDING_DIMENSION="1024"
node bin/build-index.js "C:\Users\User\Desktop\TennisAU\DOCUMENTS" "C:\Users\User\Desktop\TennisAU\MATCH_DATA" "C:\Users\User\Desktop\TennisAU\RANKINGS" data\video
npm run search -- --role admin "accelerometer load during tournaments"
```

**Expect:** ~640 chunks, a shard written, and a ranked list with page numbers.

Then clear it so a real index cannot be confused with a fake one:

```powershell
Remove-Item -Recurse -Force data\index
Remove-Item Env:EMBEDDING_PROVIDER; Remove-Item Env:EMBEDDING_DIMENSION
```

---

## 4. A real index on a small slice — ~10 minutes

Do this before the overnight run. It is the first time real embeddings are
involved, so it is where model or dimension mistakes surface.

```powershell
node bin/build-index.js "C:\Users\User\Desktop\TennisAU\DOCUMENTS" "C:\Users\User\Desktop\TennisAU\POWERPOINT" "C:\Users\User\Desktop\TennisAU\MATCH_DATA" "C:\Users\User\Desktop\TennisAU\RANKINGS" data\video
```

Then test all four routes:

```powershell
# retrieval only — no model writing, just "did it find the right thing"
npm run search -- --role admin "lumbar bone stress in junior players"

# document question
npm run ask -- --role admin "what does the research say about serve volume during tournaments?"

# table question — computed, not retrieved
npm run ask -- --role admin "how many matches were played on each surface?"

# must refuse
npm run ask -- --role admin "what was Djokovic's serve speed at the 2019 Australian Open final?"

# access control — analyst is denied physiological data, admin is not
npm run search -- --role admin   "athlete heart rate monitoring"
npm run search -- --role analyst "athlete heart rate monitoring"
```

**What good looks like**

| Command | Expect |
|---|---|
| `search` | Ranked chunks with real titles and page numbers |
| document `ask` | Prose with `[1]`-style citations and a source list |
| table `ask` | A sentence, a markdown table, and the SQL that produced it |
| refusal | "The knowledge base does not contain an answer to this question." |
| analyst vs admin | Analyst returns fewer results, or an access message |

Then score it:

```powershell
npm run eval:answers
```

Runs the gold set and reports routing, sources, grounding and — the column that
matters — whether it refused the questions it should have.

---

## 5. The web UI and the source panel

```powershell
npm start
```

Open <http://localhost:3000>, ask something, and **click a citation**.

**Expect:** a panel slides in from the right, the PDF opens *at the cited page*,
and the conversation stays exactly where it was behind it. Escape closes it.

This needs MongoDB (`MONGODB_URI` in `.env`). If you don't have it running, skip
this step — `npm run ask` needs neither MongoDB nor the server.

---

## 6. The full corpus — 2–4 hours

Only once the above is behaving.

```powershell
node --max-old-space-size=6144 bin/build-index.js "C:\Users\User\Desktop\TA_S2\document-resources"
```

**It checkpoints every 25 files.** If it crashes, you close the laptop, or you
hit Ctrl-C, run the *exact same command* again and it resumes.

Leave it overnight. Then:

```powershell
npm run eval:answers
npm run ask -- --role admin "according to Beni Linder, what percentages of speed should players vary between?"
npm run ask -- --role admin "who were the authors of the first Cardio Tennis publication?"
```

Those last two are Al's questions 5 and 7. Their sources are confirmed present
and extractable, so they should now be **answered**, not refused.

---

## 7. Optional — OCR the ~5% that are scanned images

```powershell
pip install surya-ocr pypdfium2
python tools\ocr\ocr_scanned.py --from-report data\index\build-report.json --source-dir "C:\Users\User\Desktop\TA_S2\document-resources" --dry-run
```

Drop `--dry-run` to actually run it, then re-run the step 6 build — it resumes,
so only the newly readable documents get embedded.

---

## When something goes wrong

| Symptom | Cause |
|---|---|
| `Could not reach the language model` | Ollama isn't running → `ollama serve` |
| `ollama does not have the model` | `ollama pull bge-m3` |
| `no index found at data/index` | You haven't built one yet |
| `returns N-dimension vectors but config says M` | `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` disagree in `.env` |
| `will not resume` | You changed model or chunk size — delete `data\index` and rebuild |
| `JavaScript heap out of memory` | Add `--max-old-space-size=6144` |
| `Missing required environment variable: MONGODB_URI` | Only `npm start` needs it; use `npm run ask` |
| Answers are vague | Run `npm run search` on the same question first. If the right chunk isn't in that list, it's retrieval, not the prompt |

---

## Confirm reranking is actually happening

It degrades silently by design — a missing reranker returns the fused order
rather than failing the request. That's the right behaviour, and it also means
you won't notice if it never runs. Check explicitly:

```powershell
npm run ask -- --json --role admin "serve volume during tournaments" | Select-String "reranked"
```

`"reranked": true` is what you want. If it says `false` with a reason, the
reason names the problem.
