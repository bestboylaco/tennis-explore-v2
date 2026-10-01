# How the assistant decides what to do

**TENISE-16 / E3-10** (agent and action group) and **TENISE-19 / E4-13**
(integration for text and document queries), against Al's brief of 2026-08.

This is the answer to "should we use function calling for intent?" — the short
version is **no, not on a local model**, and this explains what we do instead.

---

## What Al asked for

| His words | What that means in code |
|---|---|
| "reference where the information has come from … clicking on the link would open the asset" | Every citation carries a deep link to a page, slide or timestamp |
| "but not take them away from or lose the chat function spot" | Links are marked `target: "side_panel"`, served from `/api/assets/:docId` |
| "direct question from a single-entity query … return the precise lookup" | `analytical` intent → table lookup, not retrieval |
| "trend, comparison or aggregation … side by side table or graph" | `comparative` / `aggregation` → computed table + JSON + SQL |
| "concise executive summaries and overviews" | `summarisation` intent, own prompt, wider evidence window |
| "state that the answer doesn't seem to exist … doesn't hallucinate" | Abstention is built, not prompted |
| "Always provide the reference link" | Contract payload always includes citations |

His taxonomy is implemented literally in
[`src/shared/constants/queryTaxonomy.js`](../src/shared/constants/queryTaxonomy.js),
using his field names, so "how are we doing on multi-hop" is answerable by
reading a field called `multi_hop`.

---

## Why not function calling

The standard approach is to give the model tools — `search_documents()`,
`query_table()`, `summarise()` — and let it pick. On a frontier model this works
well. Three reasons it does not work here.

**1. Small models emit broken tool calls.** We run `llama3.1:8b`. It invents
argument names, omits required fields, and calls functions that do not exist.
Each of those is a failed request unless you write repair logic — and once you
have written the repair logic, you have written our planner anyway, just with
more moving parts.

**2. A tool call is a decision to act.** We do not want the model deciding to run
an aggregation over athlete data. We want it to describe what the coach asked
for; *our* code decides what runs. That distinction matters most where there is
an access filter involved — a model that picks the tool can be argued into
picking a different one.

**3. Al asked for specific output shapes.** If the model picks the tool, the
model implicitly picks the shape, and the same question returns prose on Monday
and a table on Tuesday. Nothing downstream can rely on that.

## What we do instead: the model fills in a form

Two stages, and the first is free.

**Stage 1 — rules.** A set of patterns classifies the obvious cases with no model
call at all: aggregation wording over table vocabulary, summary requests, clear
document questions. Each returns a confidence. Above 0.8 we trust it and skip the
model, which saves roughly a second per query.

The rules are deliberately unwilling to settle hard cases. "What is Player X's
best ranking" and "who had the highest beep test result" use identical words —
one is a lookup, the other ranks a whole population. The rules route both to the
structured path and return low confidence, leaving the intent to stage 2.

**Stage 2 — a schema-constrained form.** One call, no side effects. The model
fills in:

```json
{
  "intent": "aggregation",
  "entities": ["Australian Open"],
  "metrics": ["serve speed"],
  "timeframe": "year on year",
  "subQuestions": [],
  "needsExactWording": false
}
```

This is passed to Ollama as its `format`, so decoding is constrained to the
schema — the model *physically cannot* emit an invalid intent. That removes the
single most common tool-calling failure. Older Ollama builds ignore `format`, so
a validator catches it too, and anything invalid falls back to the rules: a worse
plan, never an invalid one.

**The route, the output contract and the evidence budget are then derived from
the intent by lookup table.** The model gets no say in those. That is what makes
the output shape stable.

---

## The structured path: why the model never writes SQL

Al asked for SQL as an output format. We produce it — and we never execute it.

An 8B model writes SQL that is syntactically fine and semantically wrong: it
averages a column of strings, or silently drops the null rows that were the
interesting ones. You get a number, it looks authoritative, and nothing says it
is nonsense. (And a model that can be talked into `DROP TABLE` is a real problem
on an endpoint a coach can reach.)

So the model fills in a **query spec** — table, filters, groupBy, metrics — which
is validated against the real schema before anything runs:

```
cannot apply avg to "tournament_name" because it is string, not a number.
numeric columns: Player_age, Player_ranking, Aces, double_faults, ...
```

That message goes straight back to the model as a correction, and it usually gets
it right second time, because the failure is nearly always "guessed a plausible
column name" rather than "misunderstood the question".

The spec is then executed by our own engine, and we **render** the equivalent SQL
as a string to display. Al gets his SQL output, the coach can audit the number,
and no model-written SQL was ever run. The SQL is documentation, not instruction.

**This is also the only way aggregation questions can work at all.** "What is the
median change in serve speed year on year" cannot be answered by retrieval — no
chunk contains that median, because nobody ever wrote it down. Retrieval can only
find text that already exists. Any RAG system that appears to answer such a
question is reading a number off a nearby chunk and hoping.

---

## Abstention

Al's clearest requirement, and the one most systems get wrong.

Abstention is **built, not prompted**. When retrieval returns nothing visible, or
the spec planner reports no table can answer, `answer.service.js` returns a fixed
sentence and **makes no model call at all**. The one situation where a model must
not improvise is the one where it has nothing to improvise from.

When evidence does exist, the prompt instructs the exact refusal sentence, and
`isAbstention()` detects it afterwards — including paraphrases, because small
models reword instructions even when told not to, and scoring an honest refusal
as a hallucination would make the evaluation actively misleading.

Four gold questions test this, including `ABS-04` — "What was Djokovic's serve
speed at the 2019 Australian Open final?" — which is plausible, specific, absent
from the corpus, and something the model genuinely knows from training. That is
the trap, and passing it is the point.

---

## Citations that open the right thing

A citation that opens a 40-page PDF at page 1 is barely better than none: the
reader still has to find the claim, and they will not.

| Source | Link | Opens at |
|---|---|---|
| PDF | `/api/assets/perri2022#page=7` | page 7 |
| Slides | `/api/assets/catapult-ndp#slide=12` | slide 12 |
| Video | `https://youtube.com/watch?v=abc&t=80s` | 1:20 |
| Table | `/api/assets/rankings` + the SQL that was run | the query |

`/api/assets/:docId` **re-checks access**. That is not redundant. Retrieval
already filtered what the caller could see, but this endpoint is reachable
directly with any docId, and "the UI only shows links they may click" is not
access control — anyone can type a URL.

A structured citation also reports what the number rests on:
`computed over 68 of 98 rows`. A median over four values and a median over four
thousand deserve different amounts of trust.

---

## Handling hybrid questions

Al's example — *"what are the differences between a platform and step up stance
in the serve?"* — wants prose, a table of the differing variables, **and** links.

The rules score that at 0.3 confidence and hand it to the planner. If it comes
back structured but the tables cannot answer it, `answerQuestion` **falls through
to the document route** rather than abstaining. That fallback exists because
questions like "how many junior ITF matches do top 10 players average at 15"
sound like table queries and are actually findings in a paper.

Full hybrid composition — a written summary with a supporting table drawn from
both routes in one answer — is the next piece of work. The routing, the contracts
and the citation format are all in place for it; what is missing is a composer
that merges two evidence sets into one answer, and a way to decide when the extra
latency is worth it.

---

## Effort levels: fast vs. thorough (TENISE-68)

Every toggle above -- routing, decomposition, expansion, reranking, `TOP_N` --
was global: set once from `.env` at process startup, applied to every question
the process ever answers. That is the right question for "how good should
this deployment be", and the wrong one for "how much should *this* question
cost". A coach asking "what was the score against Kumasaka" and a coach asking
"compare our return positioning research across both papers" do not deserve
the same machinery, and before this ticket they got it anyway.

`effort` is an optional field on the `/api/chat` request body: `"fast"`,
`"thorough"`, or omitted. Omitted is not a third level with its own
behaviour -- it means *no override*, so a caller that has never heard of this
parameter (every caller before TENISE-68) gets exactly what `.env` already
says, unchanged. That is what makes this backward compatible rather than a
second place the same decision gets made.

| | fast | thorough | omitted |
|---|---|---|---|
| decomposition | off | on | whatever `.env` says |
| expansion (corrective retry) | off | on | whatever `.env` says |
| reranking | off | on | whatever `.env` says |
| evidence window (`topN`) | x0.6 | x1.5 | unscaled |

Only four knobs, and three flags from `retrieval.config.js` were deliberately
left alone:

- **`PLANNER_ENABLED`** -- turning this off for "fast" would save a model
  call, but it is also what extracts the entities a structured (table)
  question needs to run at all. Disabling it trades latency for a *wrong*
  answer on exactly the questions that need it most, not for a thinner one.
- **`CONTEXTUAL_ENABLED`** -- this governs whether a chunk was written with a
  situating header when the index was *built*. By the time a chat request
  exists, every chunk already has its header or it does not; there is
  nothing left at query time to switch.
- **`HYDE_ENABLED`** -- stays off under both levels. It is already off
  globally because the benchmarks found it scores *below* plain dense
  retrieval (see `retrieval.config.js`). "Thorough" means spend more on the
  techniques that help, not re-enable the one technique measured to hurt.

Two levels, not three: the ticket asks for a speed/thoroughness tradeoff, and
every flag here is binary (a stage either runs or it does not) -- the only
place a third, intermediate level could live is `topN`, which already scales
with the question (`TOP_N_FOR_INTENT_ROUTE`, `queryTaxonomy.js`) before effort
is even applied. Nothing in this investigation argued for a value in between.

The design lives in [`src/config/effort.config.js`](../src/config/effort.config.js);
the wiring threads through `chat.validation.js` (validates and normalises the
field) → `chat.service.js` → `answer.service.js` (resolves the overrides once
and scales `plan.topN`) → `retrieval.service.js` / `ranking.service.js`
(actually skip or run decomposition and reranking). `npm run eval:effort`
runs the same four knobs against the real pipeline on a shared slice of the
gold set and checks that `fast` and `thorough` genuinely produce different
stage telemetry on every *document* question, and -- as a deliberate negative
control -- produce *no* difference on a structured (table) question, since
`answerFromTables` never calls `retrieve()` at all.

Note: only `/api/chat` (`answer.service.js`) honours `effort`. `/api/chat/v2`
(`agentOrchestrator.service.js`) is a separate Actions-based architecture that
does not call `retrieve()`, `planRetrieval()` or `rerankCandidates()` at all,
so there is no equivalent pipeline stage to switch there yet -- and per
`public/scripts/config.js`, the live interface already defaults to `/api/chat`
for unrelated reasons (v2's routing agent is not yet at parity).

---

## Trying it

```bash
npm run ask -- "how many matches were played on each surface?"        # aggregation
npm run ask -- "what is Carlos Alcaraz's best ranking?"                # analytical
npm run ask -- "summarise what we know about lumbar stress injuries"   # summarisation
npm run ask -- "what does Mark Kovacs say about tournament rounds?"    # abstention
npm run ask -- --json "compare wins on hard versus clay"               # full payload
npm run eval:answers                                                    # score the gold set
```
