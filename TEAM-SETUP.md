# Running TennisExplore — for the team

**You do not need to build the search index.** It is committed to the repo, so
you get the exact same one Zaina built and evaluated. That matters: if everyone
built their own, small differences in model version or which files they happened
to have would make every result incomparable.

**You do not need AWS, S3, or the source documents either.** Everything the
system searches — the text of every chunk, its metadata, its embedding, its page
number — is in the index. The original PDFs are only needed to *open* a source
from a citation, and that degrades gracefully if you do not have them.

About 15 minutes, most of it downloading models.

---

## 1. Install

**Node.js 20+** — <https://nodejs.org>, the LTS installer.

**Ollama** — <https://ollama.com/download>. This runs the AI models on your own
machine; no data leaves it.

**MongoDB** — only if you want the web UI. The command line works without it.

---

## 2. Get the code

```bash
git clone https://github.com/bestboylaco/tennis-explore-v2.git
cd tennis-explore-v2
git checkout feature/TENISE-15-17-21-retrieval-contract-hybrid-search-citations
npm install
```

The clone is large — a few hundred megabytes — because the index comes with it.
That is the point.

---

## 3. Pull the two models

```bash
ollama pull bge-m3
ollama pull llama3.1:8b
```

About 7 GB, once.

- **bge-m3** turns your *question* into a vector so it can be compared against
  the index. You need it even though you are not rebuilding the index, because
  the question has to be embedded by the same model that embedded the documents.
- **llama3.1:8b** writes the answers and scores passages for reranking.

**Do not try `ollama pull bge-reranker-v2-m3`.** It fails — that model is not in
Ollama's library and Ollama has no rerank endpoint anyway. Reranking runs through
the chat model.

Check everything is in place:

```bash
npm test          # expect 115 passing
npm run check:models
```

---

## 4. Set up your environment file

```bash
copy .env.example .env      # Windows
cp .env.example .env        # Mac / Linux
```

The defaults are correct. Only edit it if you want a different model.

---

## 5. Ask something

```bash
npm run ask -- "what does the research say about serve volume during tournaments?"
npm run ask -- "how many matches were played on each surface?"
npm run ask -- "summarise what we know about lumbar stress injuries"
```

First answer is slow — Ollama is loading the model into memory. Later ones are
quicker.

**Other useful commands:**

```bash
npm run search -- "accelerometer load"        # retrieval only, no model writing
npm run ask -- --json "..."                   # the full response payload
npm run ask -- --role analyst "..."           # ask as a restricted role
npm run eval:answers                          # score the gold question set
```

---

## 6. The web UI

```bash
npm start
```

Then <http://localhost:3000>. Needs MongoDB running.

- `/` landing
- `/platforms` the integrated platforms
- `/explore` ask questions

Click a citation and the source opens beside the conversation at the cited page.
If you do not have the original PDFs locally you get a clear message instead —
the answer, the quote, the page number and the authors all still work, because
they live in the index.

---

## When something goes wrong

| Symptom | Fix |
|---|---|
| `Could not reach the language model` | Ollama is not running. Open the Ollama app, or `ollama serve` |
| `ollama does not have the model` | `ollama pull bge-m3` and `ollama pull llama3.1:8b` |
| `no index found at data/index` | Your clone did not fetch it — `git pull` |
| `Missing required environment variable: MONGODB_URI` | Only `npm start` needs Mongo. Use `npm run ask` |
| `ASSET_NOT_LOCAL` when opening a citation | Expected. You do not have the source PDFs; everything else works |
| Answers are slow (20–60s) | Normal on consumer hardware. It is doing retrieval, grading, reranking and generation locally |
| Keyword search finds nothing that clearly exists | Your clone converted the index line endings. `.gitattributes` prevents this, but if you cloned before it existed: `git rm --cached -r data/index` then `git checkout data/index` |

---

## What you should NOT do

**Do not rebuild the index** unless you have the 17 GB source library and three
hours. If you do rebuild it, do not commit it — we would then have two different
indexes in the history and no way to tell which results came from which.

**Do not commit anything under `data/raw/`.** That is partner material, some of
it classified internal or above. `.gitignore` already excludes it.
