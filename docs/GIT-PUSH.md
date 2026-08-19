# Pushing your work to GitHub

For someone who has not used Git much. Copy the commands exactly.

Mental model in one line: **your work lives in three places** — the files on your
disk, a staging area, and the saved history. `git add` moves disk → staging,
`git commit` moves staging → history, `git push` sends history to GitHub.

---

## First time only

Tell Git who you are. This name appears on every commit you ever make.

```bash
git config --global user.name "Zaina Ilyas"
git config --global user.email "your@email.com"
```

---

## The normal loop

### 1. See where you are

```bash
git status
git branch
```

`git status` lists what you have changed. `git branch` shows which branch you are
on, with a `*` next to it.

### 2. Get up to date with the team

Do this **before** you start work, every time. It saves conflicts later.

```bash
git checkout main
git pull origin main
```

### 3. Make a branch for your work

Never commit straight to `main`. A branch is a private line of work you can push
and open a pull request from.

```bash
git checkout -b feature/TENISE-17-hybrid-search
```

Name it after the ticket. Your team already uses this pattern
(`feature/TENISE-7-e-1-01-central-entry-point-chat-interface`), so match it.

`-b` means "create it". To move to a branch that already exists, drop the `-b`.

### 4. Stage what you want to save

```bash
git add .
```

That stages everything you changed. To be selective:

```bash
git add src/modules/retrieval/ docs/
```

Check what is staged before committing:

```bash
git status
```

Anything in green is going in. Anything in red is not.

### 5. Commit

```bash
git commit -m "feat(retrieval): hybrid search with ACL enforcement"
```

The message convention your repo uses is `type(scope): summary`:

- `feat` — new capability
- `fix` — a bug fixed
- `docs` — documentation only
- `chore` — housekeeping, rebuilt index, dependency bumps
- `test` — tests only
- `refactor` — code changed, behaviour did not

For anything substantial, write a longer message. Run `git commit` with no `-m`,
and it opens an editor: first line is the summary, blank line, then the body.
A full example is at the bottom of this file.

### 6. Push

The first push from a new branch needs `-u` to link it to GitHub:

```bash
git push -u origin feature/TENISE-17-hybrid-search
```

After that, just:

```bash
git push
```

### 7. Open a pull request

Go to <https://github.com/bestboylaco/tennis-explore-v2>. GitHub shows a banner
offering to open a pull request from the branch you just pushed. Click it, write
what changed and why, and request a review.

---

## Committing the search index

The index is three files in `data/index/` and they are meant to be committed —
that is what lets teammates query the same corpus without rebuilding it.

```bash
git add data/index
git commit -m "chore(index): rebuild with bge-m3, 7268 chunks"
git push
```

It is around 30 MB. Git handles that fine. If it ever passes ~200 MB, attach
`vectors.bin` to a GitHub release instead and put the URL in the manifest.

**Do not commit `data/raw/`.** That is the partner's source material, some of it
classified internal or above. `.gitignore` already excludes it — leave that alone.

---

## When something goes wrong

**"Updates were rejected because the remote contains work you do not have"**
Someone pushed since you last pulled.

```bash
git pull --rebase origin main
git push
```

`--rebase` replays your commits on top of theirs, which keeps history readable.

**A merge conflict**
Git marks the clashing section inside the file like this:

```
<<<<<<< HEAD
your version
=======
their version
>>>>>>> main
```

Open the file, delete the markers, leave the code you want (often a bit of both),
then:

```bash
git add the-file.js
git rebase --continue
```

**I committed to `main` by accident**
Nothing is lost. Move the commit onto a branch:

```bash
git branch feature/my-work
git reset --hard origin/main
git checkout feature/my-work
```

**I want to undo my last commit but keep the changes**

```bash
git reset --soft HEAD~1
```

**I want to throw away everything since the last commit**
Careful — this cannot be undone.

```bash
git checkout -- .
```

**I do not know what state I am in**

```bash
git status
git log --oneline -10
```

Those two almost always answer it.

---

## A commit message for this work

```
feat(retrieval): hybrid retrieval, ACL-enforced index schema v2, citation binding

Implements TENISE-15 (E3-09), TENISE-17 (E3-11) and TENISE-21 (E4-15), and
fills the ingestion stubs left by TENISE-11 (E2-05). The retrieval and
ingestion service files were empty placeholders; this is their first
implementation, so nothing existing was overwritten.

Index schema v2 (schema/index-schema.json)
- acl_groups, event_date and authors are now REQUIRED and enforced at ingest
  by metadata.service.enforceSchema, which throws rather than repairing.
  Adding an indexed field after the corpus is embedded means re-embedding all
  of it, so these have to exist in the schema from the start.
- event_date is the date the content is ABOUT (publication date, match date),
  kept separate from ingested_at. Partner CSVs are dd-mm-yyyy and JavaScript's
  Date() reads that as month-first, so dates are parsed explicitly.
- acl_groups is validated against the classification it denormalises, so
  editing data_domain by hand cannot silently desynchronise the grant string.

Access control (shared/constants/accessControl.js)
- Three axes: data domain, sensitivity (Tennis Australia's own classification
  vocabulary) and owning program. Roles expand to flattened grant strings;
  access is a set intersection.
- Enforced INSIDE both retrieval arms, before either produces a ranked list. A
  post-filter would let a forbidden chunk take a slot and then be dropped,
  silently shortening the result set.
- assertAccessInvariant re-checks after fusion and throws. It should never
  fire; it exists so a refactor that drops the pre-filter fails loudly instead
  of returning a fluent answer built on data the caller cannot see.
- member_services was given research access after a test caught it being
  denied published journal articles. Refusing literature anyone can download
  protects nothing; the boundary is athlete data, not the literature.

Retrieval (modules/retrieval/)
- BM25 + dense, fused with Reciprocal Rank Fusion at k=60. RRF rather than a
  weighted blend because the two arms' scores are on unnormalised scales that
  shift per query, so any fixed alpha is tuned to the last query looked at.
- Contextual chunk headers, applied before embedding and before BM25
  tokenisation. Largest single quality gain in the pipeline.
- Cross-encoder reranking with graceful degradation: a missing reranker
  returns the fused order with a reason rather than failing the request.
- Query routing and multi-hop decomposition. Entity lookups get a smaller
  vector budget because our own numbers show they gain nothing from it.
- HyDE implemented but OFF by default: current benchmarks place it below plain
  dense retrieval. Kept behind a flag so the eval harness can show that on our
  corpus rather than us quoting someone else's result.

Citation binding (TENISE-21)
- Prompt bumped to v3: evidence blocks are numbered and every factual sentence
  must carry a [n] marker.
- Markers are bound back to chunk, page, authors and date. Dangling citations,
  unused evidence and numbers appearing in no source are all reported rather
  than hidden.

Infrastructure
- Portable file-backed vector store: manifest.json, chunks.jsonl, vectors.bin.
  No server, so the index can be committed and a teammate can query the exact
  corpus that was evaluated instead of rebuilding their own.
- Vectors are L2-normalised at write time, so search is a dot product.

Evaluation
- npm run eval runs seven configurations, each in its own process. Node caches
  modules and freezes config at import, so an in-process ablation silently
  runs every strategy with the first one's settings and reports an identical
  row for each — which reads as "nothing helped" when nothing was tested.

Also
- CLI entry points: build:index, search, ask, eval, check:models. None of them
  require MongoDB, so retrieval can be run and demonstrated on its own.
- 29 new unit tests covering access enforcement, RRF, citation binding, date
  parsing and the schema gate. All 60 tests pass, including the 31 pre-existing
  telemetry tests.

Refs: TENISE-11, TENISE-15, TENISE-17, TENISE-21
```
