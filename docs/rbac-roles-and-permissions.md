# TennisExplore V2 — RBAC Roles & Permissions (Access Matrix)

**Ticket:** TENISE-50 / E5-25
**Epic:** Epic 5 — Security, Privacy & Governance
**Status:** Role names and domain/sensitivity mapping **confirmed** (2026-09-10). Programs axis and the
relationship between this document and the data-classification scheme in
[`data-threat-model-and-classification.md`](./data-threat-model-and-classification.md) resolved by
engineering judgement per §6 and §7 below, rather than left open pending further partner sign-off.

## 1. Purpose

This document is the role-to-data-classification access matrix required by TENISE-50 (E5-25). It
records, as project documentation, which of the eight roles implemented in
[`src/shared/constants/accessControl.js`](../src/shared/constants/accessControl.js) may see which
kind of data, so that the roles already enforced in code can be treated as approved policy rather
than provisional placeholders.

It does not change the enforcement mechanism. `accessControl.js` and
[`accessControl.service.js`](../src/modules/retrieval/accessControl.service.js) already implement
everything described here; this document validates and formalises that model, per the ticket's
"depends on" note.

## 2. Confirmed roles

| Role ID | Display name | Domains | Max sensitivity | Program scope | Note |
|---|---|---|---|---|---|
| `academy_coach` | National Academy Coach | performance, physiological, research | confidential | `national-academy` only | sees training load as performance monitoring, not clinical data |
| `tour_coach` | Professional Tour Coach | performance, physiological, research | confidential | `pro-tour` only | same permissions as academy coach, different athletes |
| `analyst` | Performance Analyst | performance, research | internal | all programs | deliberately **no** physiological access — see §4 |
| `strength_conditioning` | Strength & Conditioning Coach | performance, physiological, research | confidential | all programs | works across programs, no program restriction |
| `physiotherapist` | Physiotherapist | physiological, clinical, performance, research | restricted | all programs | the **only** role with clinical access — see §3 |
| `member_services` | Member Services Officer | personal, administrative, research | confidential | all programs | member contact details + published research; no performance or medical data |
| `athlete` | Athlete | performance, physiological, research | internal | all programs | production should additionally scope to `athlete_id == self` — **not yet implemented**, tracked as a follow-up, not a blocker to this ticket |
| `admin` | Platform Administrator | all six domains | restricted | all programs | unfiltered ceiling, for the eval harness — see §5 |

Every role also implicitly receives the `NO_PROGRAM` grant (research papers, policy documents that
belong to no specific program), and, within its domains, every sensitivity level up to and including
its ceiling (e.g. a `confidential`-ceiling role also sees `public` and `internal` content in its
domains).

## 3. Medical / clinical data access (domain: `clinical`)

`clinical` covers injury diagnosis, treatment notes, and medical records.

| Role | Clinical access? |
|---|---|
| `physiotherapist` | **Yes** — sole role with this domain, up to `restricted` |
| `admin` | Yes — unfiltered ceiling role, not a normal clinical operating account (see §5) |
| All other roles (`academy_coach`, `tour_coach`, `analyst`, `strength_conditioning`, `member_services`, `athlete`) | **No** |

This is a strict allow-list: nobody outside `physiotherapist`/`admin` can retrieve clinical content
through the chat interface, regardless of query phrasing, because the domain grant does not exist for
their role at all (not merely a sensitivity cap).

## 4. Physiological data access (domain: `physiological`)

`physiological` covers wearables, training load, heart rate — monitoring data, explicitly **not**
clinical.

| Role | Physiological access? | Max sensitivity within it |
|---|---|---|
| `academy_coach` | Yes | confidential |
| `tour_coach` | Yes | confidential |
| `strength_conditioning` | Yes | confidential |
| `physiotherapist` | Yes | restricted |
| `athlete` | Yes | internal |
| `admin` | Yes | restricted |
| `analyst` | **No** | — |
| `member_services` | **No** | — |

`analyst` is the deliberate contrast case in the code (`accessControl.js:135-137`): it proves the
filter actively removes physiological content rather than merely existing unused.

## 5. Analyst restrictions (explicit)

`analyst` (Performance Analyst) is restricted to:
- Domains: `performance`, `research` only — no `physiological`, no `clinical`, no `personal`, no `administrative`.
- Max sensitivity: `internal` — cannot see `confidential` or `restricted` content even within performance/research.
- Programs: no program restriction (can see performance/research data across all programs), but that data is capped at `internal`.

Net effect: an analyst can discuss published research and non-sensitive performance results, but can
never retrieve physiological, medical, personal/PII, or administrative content, nor anything above
`internal` sensitivity, from any program.

## 6. Administrator access (explicit)

`admin` (Platform Administrator) holds all six domains (`performance`, `physiological`, `clinical`,
`personal`, `research`, `administrative`) at `restricted` (the top sensitivity tier) across all
programs — i.e. no filtering applies to this role.

This is intentional and scoped narrowly: the code comment (`accessControl.js:178`) states it "exists
so the eval harness can measure the unfiltered ceiling," not as a general-purpose operating role. Two
things follow from that for policy, not code:
- `admin` accounts should be provisioned only for evaluation/administration, not as a convenience
  login for staff who need broad-but-not-total access — the corporate role for that case is one of
  the seven scoped roles above, not `admin`.
- Every `admin` access is still written to the access-audit trail (`access_audit_records`, E5-19),
  so an unfiltered account is not an unaudited one.

## 7. Programs axis — resolution

The code's own comment (`accessControl.js:84-88`) flags `PROGRAMS` (`national-academy`, `pro-tour`,
`junior-development`, `wheelchair-program`) as "the least certain part of the model" and asks for
partner confirmation, unlike `DOMAINS`/`SENSITIVITY_ORDER` which trace directly to Tennis Australia's
own information security policy vocabulary.

**Resolution for this ticket:** the programs axis is accepted as the operating scope as-is, rather
than held open pending further sign-off, because:
1. The program names already come from the partner's own materials (the Perri papers reference the
   national academy program; the Catapult deck discusses squad transitions) — inferred, but from
   primary sources, not invented.
2. The scoping behaviour it enables is already proven correct in a live test (Test A,
   `data-threat-model-and-classification.md` §6): `academy_coach` and `tour_coach` hold identical
   domains/sensitivity and differ only by program, and a live run against real sessions confirmed
   `tour_coach` abstains on `national-academy`-scoped physiological content while `academy_coach`
   answers it.
3. Nothing in this ticket's acceptance criteria requires the *program list itself* to be closed —
   only that role-to-classification access is defined and representable by the existing filter, which
   it is.

If Tennis Australia later revises the program list (e.g. splits or renames a program), that is a data
(`PROGRAMS` array) and re-tagging change, not a re-architecture — the model already supports it.

## 8. Relationship to the data classification scheme in `data-threat-model-and-classification.md`

That document (§4, TENISE-43/E5-20) defines a five-tier **document intake** classification —
`Public < Internal < Sensitive < Personal < Biometric` — used to gate what may enter the corpus at all
(§7 Data Gate there). This document's sensitivity axis — `public/internal/confidential/restricted`,
from `accessControl.js` — is a separate, four-tier **RBAC enforcement** scheme used to filter queries
at retrieval time.

These are not the same axis and are not merged here, because they answer different questions:

| Question | Scheme | Where |
|---|---|---|
| "Is this document allowed into the corpus at all, and under what handling rule?" | 5-tier intake classification | `data-threat-model-and-classification.md` §4, enforced by the Data Gate (§7 there) |
| "Given a document already in the index, which roles may retrieve it?" | 4-tier RBAC sensitivity + domain + program | This document, enforced by `accessControl.service.js` |

Rough correspondence, for readers moving between the two documents (not a formal mapping, since the
axes classify different things — one a whole document's admissibility, the other a chunk's
retrievability):

| Intake tier (§4 there) | Typically carries RBAC domain(s) | Typically capped at RBAC sensitivity |
|---|---|---|
| Public | `research`, `administrative` | `public` |
| Internal | `performance`, `administrative`, `research` | `internal` |
| Sensitive | `performance` (scouting/opponent analysis) | `confidential` |
| Personal | `personal` | `confidential` (member_services) |
| Biometric | `physiological`, `clinical` | `confidential`/`restricted` |

A `clinical` or `physiological` chunk is expected to also be `Personal` or `Biometric` at the intake
level in most real cases (it identifies an athlete), which is consistent — the two schemes agreeing on
"this is sensitive" via different vocabularies is not a conflict to resolve, only two governance
layers doing their own jobs.

## 9. Access scenarios (restricted vs. permitted, per sensitive domain)

### Clinical
- **Permitted:** `physiotherapist` queries a treatment-note chunk tagged
  `clinical:restricted:national-academy` → chunk passes `isPermitted` (physiotherapist holds
  `clinical` up to `restricted`, all programs) → answered with citation.
- **Restricted:** `academy_coach` asks the same question → `clinical` is not in `academy_coach`'s
  domain list at all → chunk excluded before ranking → assistant abstains, no citation, no chunk text
  reaches Ollama.

### Physiological
- **Permitted:** `academy_coach` asks about National Academy athlete training-load/wearable data
  (`physiological:internal:national-academy`) → answered with citation. **This exact scenario has
  already been run live**, not just modelled — see Test A in
  `data-threat-model-and-classification.md` §6 (v0.4): `academy_coach` answered with 4 restricted
  chunks; the audit trail confirms it.
- **Restricted:** `analyst` asks the identical question → `physiological` is not in `analyst`'s domain
  list → abstains. Also run live in the same Test A: `analyst`'s audit record for the identical
  question lists none of those chunks.

### Personal (PII)
- **Permitted:** `member_services` queries a member contact-detail record
  (`personal:confidential:*`) → answered with citation.
- **Restricted:** `strength_conditioning` asks the same question → `personal` is not in
  `strength_conditioning`'s domain list → abstains.

## 10. Representability by the existing filter

This matrix requires no new enforcement mechanism. It is already fully representable by the deployed
pipeline, with role coming only from the server-side session, never a client-supplied value:

`req.session.user.roleId` (set at login, `modules/auth`) → `requireAuth` → `chat.controller.js:34`
reads `roleId` → `buildAccessFilter(roleId)`
(`accessControl.service.js:19`) → `grantsForRole(roleId)` (`accessControl.js:189`) expands the role
above into the grant set → `isPermitted`/`isChunkAllowed` filters both the BM25 and dense retrieval
arms before fusion → `assertAccessInvariant` re-checks after fusion.

## 11. Acceptance criteria status

| AC | Status |
|---|---|
| Existing provisional roles reviewed with the relevant industry stakeholder | Role names + domain/sensitivity mapping confirmed 2026-09-10 |
| Final or approved role names recorded | §2 |
| Role-to-data-classification access matrix committed to project documentation | This document |
| Medical/clinical data access explicitly defined | §3 |
| Physiological data access explicitly defined | §4 |
| Analyst restrictions explicitly defined | §5 |
| Administrator access explicitly defined | §6 |
| At least one restricted + one permitted scenario per sensitive classification | §9 |
| Approved model representable by existing pre-retrieval filtering, no client-supplied role | §10 — already true today, no code change needed |

The one item this document does **not** close: `athlete` self-scoping (`athlete_id == self`) is
policy-approved as a requirement (§2) but not yet implemented in code — tracked as a follow-up, not a
blocker to this ticket's acceptance criteria, none of which require it.
