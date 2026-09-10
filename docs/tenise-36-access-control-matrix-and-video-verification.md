# TENISE-36 — Access Control Test Matrix & Video Verification Procedure

**Ticket:** TENISE-36 ("Sprint 4 access control matrix and video verification procedure")
**Epic:** Epic 5 — Security, Privacy & Governance
**Run date:** 2026-09-10
**Status:** Access control matrix and negative test — **executed live, evidence attached below**. Video
verification — **blocked**, see §4. Sprint 2 regression rerun — **descoped by owner decision**, see §5.

This ticket predates the AWS-to-local-stack pivot (TENISE-40) and was written against CloudTrail and
Nova Pro. Its acceptance criteria are re-interpreted here against what is actually implemented today:
"CloudTrail record and retrieval log" → the `access_audit_records` Mongo collection (E5-19); "evidence
set sent to Nova Pro" → the evidence array assembled for Ollama. The underlying requirement —
verification from logs, not the screen — is unchanged and is exactly what this run does.

## 1. Access control test matrix

### 1.1 Roles and documents used

The ticket asks for "2 roles" without naming them. Of the 8 roles now confirmed in TENISE-50, the two
that make this matrix meaningful on both axes of the real model
(`src/shared/constants/accessControl.js`) are:

- **`tour_coach`** (Professional Tour Coach) — domains `performance, physiological, research`, ceiling
  `confidential`, scoped to the `pro-tour` program only.
- **`athlete`** — domains `performance, physiological, research`, ceiling `internal`, **no** program
  restriction (gets every program).

These two roles hold the *same domains*, so a leak between them can only come from the two other axes
— sensitivity and program — which is a stronger test than picking two roles that differ by domain
alone (domain-based denial was already proven in TENISE-50/Test A).

Six real, already-ingested documents were used — no synthetic fixtures:

| # | Category | Document | Real classification |
|---|---|---|---|
| 1 | coach-only | `2018-paris-joao-sousa-pre-match-analysis` | `performance:confidential:pro-tour` |
| 2 | coach-only | `2018-us-open-joao-sousa-pre-match-analysis` | `performance:confidential:pro-tour` |
| 3 | coach-only | `novak-djokovic-match-intelligence-report-wimbledon-2019` | `performance:confidential:pro-tour` |
| 4 | athlete-visible | `231211-service-provision-talent-athlete-services-murphy` | `physiological:internal:national-academy` |
| 5 | athlete-visible | `aisworkload` | `physiological:internal:national-academy` |
| 6 | athlete-visible | `ams-admin-audit-mar25` | `physiological:internal:national-academy` |

Design: "coach-only" documents are `confidential` — above `athlete`'s `internal` ceiling, so denial is
by **sensitivity**. "athlete-visible" documents are scoped to `national-academy` — outside
`tour_coach`'s `pro-tour`-only program grant, so denial is by **program**. Each document therefore
tests a different axis of the model, on real content, not a contrived fixture.

Two real questions were written per document (12 questions), asked to both roles through the actual
HTTP API with real login sessions (`POST /api/auth/login`, `bin/seed-users.js` demo accounts) —
role came from `req.user.roleId` exactly as production does, never from the request body — for 24
executions, then a further 7 follow-up executions (see §1.3) to resolve query-routing artifacts found
in the first pass, for **31 real, live executions** against the actual Ollama + local hybrid index
pipeline (`llama3.1:8b`, `bge-m3`).

### 1.2 Verification method

Per the ticket, verification is from `access_audit_records` (Mongo Atlas), not the chat response.
Every request's audit rows were fetched by `roleId` and time window and inspected for
`documents[].docId`, `dataDomain`, `sensitivity`, `program`, and `outcome`
(`src/modules/audit/services/accessAuditRecorder.service.js` records the evidence set exactly as
handed to the model, after filtering — the same proof E5-19 needs).

### 1.3 Results

**Negative direction — must never appear (the security-critical property): 12 of 12 correct, zero
leaks.**

| Doc | `tour_coach` on athlete-visible docs | `athlete` on coach-only docs |
|---|---|---|
| 1 (Paris) | — | denied, target doc absent from evidence set (both Qs) |
| 2 (US Open) | — | denied, target doc absent (both Qs) |
| 3 (Djokovic) | — | denied, target doc absent (both Qs) |
| 4 (231211) | denied, target doc absent (both Qs) | — |
| 5 (aisworkload) | denied, target doc absent (both Qs) | — |
| 6 (ams-admin) | denied, target doc absent (both Qs) | — |

Where a role got an answer to a similar-sounding question despite being denied the target document
(e.g. `tour_coach` on doc 4/5), the audit log confirms the answer came from a **different, legitimately
permitted, `research:public:*`** document — the system found an equivalent public fact rather than
leaking the restricted one. Confirmed directly from `documents[].docId` in the audit rows, not
inferred from answer text.

**Positive direction — must be shown when permitted: 10 of 12 cleanly demonstrated via audit log,
target doc present with the correct ACL tag.**

| Doc | `tour_coach` (coach-only) | `athlete` (athlete-visible) |
|---|---|---|
| 1 (Paris) | granted, target shown (both Qs, Q2 after rewording — see below) | — |
| 2 (US Open) | granted, target shown (both Qs) | — |
| 3 (Djokovic) | **not demonstrated** — see finding below | — |
| 4 (231211) | — | granted, target shown (both Qs) |
| 5 (aisworkload) | — | granted, target shown (both Qs) |
| 6 (ams-admin) | — | granted, target shown (both Qs, after rewording — see below) |

**24-of-24 pass condition:** the negative direction (the actual security property) is 12/12. The
positive direction needed a second pass on 3 of 12 cells because of a query-routing artifact unrelated
to access control (below), and 2 of 12 cells (doc 3, `tour_coach`) remain unresolved because of a
corpus text-extraction problem, also unrelated to access control. **Net: 22 of 24 original cells behave
exactly as recorded; the 2 exceptions are attributable to a diagnosed non-ACL cause, not to the filter.**

### 1.4 Secondary findings surfaced by this exercise (not ACL defects)

1. **Query-routing artifact.** Three cells (doc 1 Q2, doc 6 both Qs) initially came back denied via a
   *structured-table* route ("no tables are visible to the role — 52 table(s) exist; all are hidden"),
   never reaching the document-route filter at all — for **both** roles equally, so it was not an ACL
   symptom. Root cause: `queryPlanner.service.js`'s rule-based planner falls through to a low-confidence
   LLM routing call for phrasings like "how many..." or "who is assigned... permissions", and the model
   sent these to the (empty-for-every-role) table route instead of the document route. Rewording with
   explicit "presentation slides" vocabulary (which the rule engine's `UNSTRUCTURED_VOCABULARY` pattern
   matches deterministically, skipping the ambiguous LLM call) fixed all 3 cells on retry. **Recommend a
   follow-up ticket** on `queryPlanner.service.js`'s handling of "who/what is assigned/recorded against"
   phrasing over presentation-sourced content — this is a retrieval-quality gap, not a security one.
2. **Message precision.** One `tour_coach` response on doc 3 showed "Your role ... does not have access
   to the data needed to answer this" when the audit log shows `tour_coach` in fact holds the grant for
   this document — the true cause was zero relevant passages retrieved (see next item), not an ACL
   denial. The wording is misleading for a legitimately-permitted role and is worth a follow-up
   (distinguish "not found" from "access denied" more consistently — the same class of issue the v0.5
   changelog fixed for the table route specifically, this is its document-route counterpart).
3. **Corpus text-extraction quality (doc 3 only).** `novak-djokovic-match-intelligence-report-wimbledon-2019`
   extracted with heavy letter-spacing artifacts (e.g. `"Nov akDj ok ov i cRal l yL engt h"`), consistent
   with a PDF/PPT layout that defeated plain text extraction. This degrades embedding and BM25 matching
   for **any** role with legitimate access, independent of RBAC — confirmed by rewording the question
   twice without success, while every other document in the matrix answered correctly once access was
   granted. **Recommend a follow-up ticket** on re-extracting or OCR-ing this specific source rather than
   trusting its plain-text layer.

None of these three findings weaken the access-control conclusion in §1.3 — they explain the 2 cells
that could not be positively demonstrated, and were confirmed not to affect the 12 negative-direction
cells at all.

## 2. Negative test (filter-disabled control)

Per the ticket: "temporarily disable the ACL filter and confirm the restricted documents then do
appear... re-enable and rerun afterwards." Rather than toggling the filter on the live server (risking
the running demo and requiring a manual re-enable step to get right), the same effect was produced more
safely: the exact low-level search calls `retrieval.service.js` makes
(`bm25.search(..., { isAllowed })`, `store.search(..., { isAllowed })`) were invoked twice in a
standalone, read-only script — once with the real per-role filter
(`buildAccessFilter(roleId)`), once with an always-true predicate substituted for the same query — and
the results compared. This never touches the running server or any real request path, so there is
nothing to "re-enable": the live app's filter was never modified.

| Case | Role | Target doc | With real filter | With filter bypassed |
|---|---|---|---|---|
| Sensitivity-axis denial | `athlete` | `2018-paris-joao-sousa-pre-match-analysis` | absent from top-50 | **present** in top-50 |
| Program-axis denial | `tour_coach` | `aisworkload` | absent from top-50 | **present** in top-50 |

**Result: PASS on both axes.** The restricted document is retrievable and would rank highly enough to
reach the model — it is only the access filter keeping it out, not some accident of ranking. This is
exactly the ticket's point: a passing result is now distinguishable from a filter that is silently doing
nothing.

## 3. Acceptance run status (§ "Acceptance run for this sprint" in the ticket)

- [x] 24-cell (→ 31-execution, see §1.1) access matrix executed and results recorded — §1.3
- [x] Negative test executed and recorded — §2
- [ ] Video rubric scoring completed by both scorers — **blocked, see §4**
- [ ] Sprint 2 routing/hybrid sets rerun to confirm no unexplained regression — **descoped, see §5**

## 4. Video verification — blocked

TENISE-36 asks for a scoring rubric (from TENISE-31), two independent scorers, 6 video questions with
expected observable content "from manual review of the footage," and a timestamp-verification procedure
with the 2-second tolerance from TENISE-32.

**This cannot be executed against this codebase as it stands.** Confirmed directly in the source:

- `docs/data-threat-model-and-classification.md` (§4.1): "Video clips with identifiable stroke
  sequences... **Not currently ingested — no video path exists in the implemented pipeline**."
- `docs/data-threat-model-and-classification.md` (C11 row): "video-frame generation was never
  implemented, so that sub-threat no longer applies."
- `docs/MEDIA-INGESTION.md` and `data/media/*.video.json` show only **video transcripts** (Whisper
  speech-to-text) ingested as plain text chunks — there is no video playback, no frame/timestamp
  citation, and no way for a chat answer to point back to a specific moment in a clip.

There is nothing to write a rubric against: a rubric scores answers against *observable video content
at specific timestamps*, and no code path produces a timestamped, playable citation to video at all.
Writing the rubric today would be scoring a feature that does not exist.

Per direct confirmation from the project owner, no other workstream is currently building this video
citation/playback feature. Recommendation: **this portion of TENISE-36 should be either descoped from
this ticket into its own feature ticket** (build video citation/timestamp playback, *then* write and run
the rubric against it) **or explicitly marked out of scope for the current milestone**, rather than left
as an unresolved acceptance criterion on a ticket whose other half (the access control matrix) is done.
This mirrors how TENISE-25's stale AWS-era acceptance criteria were handled (clarifying comment, not a
silent close).

## 5. Sprint 2 regression rerun — descoped

The "Sprint 2 routing and hybrid sets" this line refers to are not a separate deliverable of this
ticket — they are the three shared question sets (routing set, hybrid-necessity set, grounding
control set) that **TENISE-35** ("TS-02 Sprint 2 shared question sets and walking skeleton acceptance")
was supposed to build and commit, for TENISE-16/17/19 to consume. TENISE-35 itself is still **To Do**,
not Done, so there is no confirmed, committed Sprint-2 question set to rerun as a like-for-like
baseline — `evidence/answer_evaluation.json`, `evidence/e5-18-refusal-rate.json` and
`queries/query_set.json` exist in the repo but their relationship to TENISE-35's specific three sets was
never confirmed.

**Decision (project owner, 2026-09-10): do not pick up TENISE-35 as part of closing this ticket.** The
regression-rerun line item is left undone by that decision, not by omission — re-running against
whatever eval artifacts happen to exist would not actually satisfy "rerun the Sprint 2 sets" if those
were never confirmed to be the sets TENISE-35 specifies. If this line item is picked up later, it
depends on TENISE-35 first.

## 6. Reproducing this run

- Roles/passwords: `bin/seed-users.js` (`tour_coach@demo.tennisexplore.local`,
  `athlete@demo.tennisexplore.local`, shared demo password).
- Server: `npm start` (requires `ollama serve` running locally with `llama3.1:8b` and `bge-m3` pulled,
  and the built index at `data/index/`).
- Audit verification: query `access_audit_records` by `roleId` and time window
  (`findAccessAuditRecords` in `accessAuditStore.service.js`) and inspect `documents[].docId` —
  never trust the chat response text alone, per §1.2.
