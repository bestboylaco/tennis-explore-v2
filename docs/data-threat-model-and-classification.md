# TennisExplore V2 — Data Threat Model & Data Classification Controls

**Ticket:** TENISE-43 / E5-20
**Epic:** Epic 5 — Security, Privacy & Governance
**Status:** Draft v0.6 — under active development

**Change log**
- **v0.6 (2026-08-20):** Correction to v0.5: the dead `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` / `QDRANT_*` values removed from this machine's
  `.env` were put back by the project owner, deliberately, to keep them on
  hand even though nothing currently reads them. T-05 is **not** partially
  addressed by that cleanup any more — the live AWS key is confirmed still
  sitting in plaintext on this machine by choice. This does not change what
  T-05 actually needs (rotate/deactivate the AWS key, rotate the Mongo Atlas
  password), only that a local `.env` edit is not the fix and should not be
  read as progress toward it.
- **v0.5 (2026-08-20):** Two of E5-20's three open High-risk blockers are now
  closed in code. **T-04:** `errorHandler.js` no longer does a raw
  `console.error(error)` — it logs `error.stack`/`error.message` only (never
  the raw error object, which a custom Error subclass could carry arbitrary
  extra fields on, and never `req.body`), through a redaction pass that masks
  any `scheme://user:pass@host` credential shape before it reaches the log,
  verified with a live test against a fake Mongo-connection-string error.
  **T-08:** `app.use(cors())` (no origin allow-list at all) is now
  `app.use(cors({ origin: env.allowedOrigin }))`, defaulting to this app's own
  origin (`ALLOWED_ORIGIN` env var to override); verified live that a request
  claiming `Origin: http://evil.example.com` gets back
  `Access-Control-Allow-Origin: http://localhost:3000`, not a reflected
  `evil.example.com`. **T-05 partially addressed, not closed:** this machine's
  `.env` had live `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` and unused
  `QDRANT_*` values sitting in plaintext, dead since the AWS pivot — confirmed
  nothing in `src/` reads any of them, and removed. What remains and needs a
  human with the relevant console access, not an engineering task: rotate or
  deactivate that AWS key, and rotate the MongoDB Atlas password noted below
  as shared through a non-secret channel on 2026-07-28. Data Gate (§7) still
  has three unchecked boxes untouched by this revision — data classification
  sign-off, retention/deletion policy (T-07), and project owner authorisation
  — all human decisions, not code.
- **v0.4 (2026-08-20):** Test A's previously-unproven half — a real authenticated
  session tied to a real retrieval query, confirming a restricted document is
  absent from both the response and the audit trail — has now been run, live,
  through the actual chat UI with a real Ollama and the built index. The same
  question ("What new hardware or technology is the National Academy planning
  to use for measuring athlete movement, recovery, or capacity, such as Prism
  Neuro, the 1080 Sprint, or VO2 Master?", matching content classified
  `physiological:internal:national-academy`) was asked by three logged-in
  accounts: `analyst` (no `physiological` domain) and `tour_coach`
  (`physiological`, but scoped to `pro-tour`) both abstained; `academy_coach`
  (`physiological`, scoped to `national-academy`) answered correctly with
  citations. The `access_audit_records` rows for the same question confirm it
  at the log level, not just the interface: `academy_coach`'s record lists the
  4 restricted chunks it was shown; `analyst`'s record for the identical
  question lists none of them. T-01 and T-02 are now fully closed rather than
  "mitigated", and TENISE-23 (E5-17) has been moved to Done in Jira with this
  evidence attached. TENISE-25 (E5-19) was already Done; a clarifying comment
  was added there since its acceptance criteria still name AWS
  CloudTrail/Bedrock/OpenSearch, which no longer applies literally post-pivot.
  Separately, a live bug was found and fixed this session: `answerFromTables`
  reported "access_denied" whenever zero structured tables were visible to a
  role, without distinguishing that from zero tables being loaded at all
  (the demo machine's `data/index/manifest.json` records `sourceDirs` from the
  machine that built the index, which do not exist here — no CSV/XLSX ever
  shipped with the repo, so every role sees 0 tables). Every role, including
  `admin`, was getting a misleading "your role does not have access" message
  for any table-routed question on a machine with no table source files at
  all. Now reported as "not found" unless tables actually exist and are hidden
  by the filter. Unrelated to T-01/T-02, noted here because it was found while
  proving Test A.
- **v0.3 (2026-08-18):** real authentication landed (session-based, `express-session` + `connect-mongo`, `src/modules/auth`) — T-01 is now **closed** at the backend/API level: role comes from `req.user.roleId` (the session), never from anything a client sends, proven end-to-end by `test/integration/auth.test.js` including the specific case of a client sending `role: "admin"` in the request body and having it ignored. T-03 (prompt injection) moved from no defence to a **prompt-level mitigation**: both system prompts now explicitly instruct the model to treat evidence as data, and every evidence block is wrapped in `<<<BEGIN/END EVIDENCE>>>` markers; an adversarial Test B exists (`generation.test.js`) but has not been empirically run against a live model in any environment used so far (see §6). The login UI itself (frontend) is built locally but **not yet in this repo** — held back by an unrelated local-only `public/` exclude pending a teammate's separate WebUI work, so nothing below should be read as "the demo has a working login screen today."
- **v0.2 (2026-08-18):** the AWS pipeline this document originally described (OpenSearch, Bedrock Agents/Rerank/KB, Nova Pro, CloudTrail) was dropped by the team on 2026-07-30 (no AWS account access — TENISE-40) in favour of a local stack. §3 and §5 are updated to describe what is actually implemented now, not what Epics 2–5 originally planned against AWS. E5-17 (access filtering) and E5-19 (audit trail) have real implementations as of this revision; see the updated rows below. This revision does **not** check any §7 Data Gate box — implementation existing is not the same as it being reviewed, tested end-to-end, and signed off.

## 1. Purpose

Identify how data moves through TennisExplore, what security and privacy
threats exist at each stage, and which controls are required, so that the
demonstration never exposes sensitive information or relies on undocumented
security assumptions, and so stakeholders are shown a security model that
scales to a production solution.

## 2. Scope

Per the acceptance criteria this covers: local document storage, ingestion,
document processing, the retrieval index, generation requests, the chat
interface, temporary files and application logs. (Originally written as "S3
storage... OpenSearch, Bedrock requests" — see the change log above for why
those AWS-specific nouns no longer match the implementation; the boundaries
they described still exist, just against different components.)

Three layers exist side by side in this repository today and all are in
scope, because threats introduced in Sprint 1 do not wait for the rest of
the pipeline to be built:

| Layer | State | Source |
|---|---|---|
| Source Registry API (Express + MongoDB Atlas) | **Implemented** (this repo, `src/modules/sources`) | Current code |
| Local hybrid retrieval (BM25 + dense vector store) → access filter → rerank → Ollama generation | **Implemented**, local stack, replaces the AWS pipeline below | `src/modules/retrieval`, `src/modules/chat/services/answer.service.js` |
| Ingestion → OpenSearch → Bedrock Agents → Nova Pro → Guardrails pipeline | **Dropped 2026-07-30** (no AWS account access — TENISE-40); kept here only so the original Epic 2–5 wording is traceable | Jira TENISE-2, TENISE-3, TENISE-4, TENISE-5 |

The initial corpus must contain only synthetic, public, anonymised or
otherwise approved information — see [§7 Data Gate](#7-data-gate-hard-constraint).

## 3. System Inventory & Trust Boundaries

### 3.1 Components

| # | Component | Type | State | Notes |
|---|---|---|---|---|
| C1 | Chat interface (browser client) | Client | **Implemented** (`public/explore.html`), login UI built but not yet merged (see change log) | Untrusted input origin. The role picker is gone from the reference implementation — role now comes from the session, per C18 |
| C2 | Admin/API client (curl, Postman, future UI) | Client | Implemented | `/api/chat`, `/api/telemetry`, `/api/audit` now require a session (C18); `/api/sources` does not yet — see §8 |
| C3 | Express API (`src/app.js`, `modules/sources`, `modules/chat`) | Application | Implemented | Public CORS (`cors()` with no origin allow-list) |
| C4 | MongoDB Atlas (`tennis_explore_v2`) | Data store | Implemented | External managed service, holds source registry, telemetry, and (new) access-audit records |
| C5 | Local document store (`data/`, ingested from operator's filesystem) | Data store | **Implemented, replaces S3** | No upload API mounted yet (`upload.middleware.js` still unused) — today's corpus is built offline via `bin/build-index.js`, not uploaded through the app |
| C6 | Local OCR sidecar (`tools/ocr/ocr_scanned.py`) | Processing | **Implemented, replaces Textract** | Python tool, run offline; output cached to `data/ocr-cache/`, read back by `extraction.service.js` |
| C7 | Chunking/embedding (`ingestion/chunking.service.js`, `embedding.service.js`, via Ollama) | Processing | **Implemented, replaces Bedrock Knowledge Bases** | Writes to the local index, not OpenSearch |
| C8 | Local hybrid index — BM25 (`retrieval/bm25.service.js`) + sharded int8 vector store (`infrastructure/vector/vectorStore.service.js`) | Data store (vector + keyword index) | **Implemented, replaces OpenSearch Serverless** | Carries `acl_groups` on every chunk from first write (TENISE-15); this is the ACL field E5-17 needed to exist before reindexing became expensive, and it does |
| C8a | Access filter (`retrieval/accessControl.service.js`, `shared/constants/accessControl.js`) | Control plane | **Implemented (E5-17)** | Applied *inside* both the BM25 and dense arms, before fusion — the pre-retrieval enforcement point this document called for in v0.1. `assertAccessInvariant` re-checks after fusion as a second line of defence. See §5 T-01/T-02. |
| C9 | Query planner / intent routing (`modules/query/queryPlanner.service.js`) | Processing | **Implemented, replaces Bedrock Agents routing** | Decides statistics (structured table) vs. document route |
| C10 | Rerank (`retrieval/ranking.service.js`, batched LLM scoring via `tools/rerank/rerank_server.py` or Ollama) | Processing | **Implemented, replaces Bedrock Rerank** | Degrades to unreranked fused order (with a stated reason) if the rerank service is unavailable, rather than failing the request |
| C11 | Ollama (local LLM, `llama3.1:8b` by default) | External-to-app model, but **runs on the operator's machine, not AWS** | **Implemented, replaces Amazon Nova Pro** | Receives assembled evidence + prompt; video-frame generation was never implemented, so that sub-threat no longer applies |
| C12 | Grounding/abstention layer (`retrieval/answerContract.service.js`, `generation/verifier.service.js`, `chat/prompts/generationPrompt.js`) | Control plane | **Implemented, replaces Bedrock Guardrails** | Covers "refuse when evidence is insufficient" (contextual grounding) and, as of v0.3, a prompt-level anti-injection rule plus `<<<BEGIN/END EVIDENCE>>>` isolation (T-03). No dedicated detection/classification layer exists — the mitigation is entirely in how the prompt is written, which is weaker than a purpose-built guardrail |
| C13 | Application logs / console output | Data store | Implemented | `errorHandler.js` logs `error.stack`/`error.message` only, redacted for connection-string-shaped credentials — never the raw error object or `req.body` (T-04, closed v0.5) |
| C14 | Telemetry store (`modules/telemetry`) | Data store | **Implemented** (TENISE-26/30) | Per-stage records; deliberately content-free (`sanitizeAttributeValue` strips objects, truncates strings) |
| C15 | Access-audit trail (`modules/audit`, Mongo collection `access_audit_records`) | Audit | **Implemented (E5-19), replaces AWS CloudTrail** | Who (role) accessed which document/table, when; one row per document per request, deliberate 400-day retention. Still records `roleId`, not an account id — a per-account audit trail would need `auditRecorder.js` to also take `req.user.id`, which it does not yet |
| C16 | Temporary files (multer upload buffer/disk) | Data store (transient) | Wired but unused (`upload.middleware.js` present, no route mounts it yet) | Unchanged since v0.1 — needs explicit cleanup policy once wired |
| C17 | `.env` / environment configuration | Secrets | Implemented | Holds `MONGODB_URI` with embedded DB credentials; gitignored |
| C18 | Authentication (`modules/auth`: `User` model, session middleware, `requireAuth`/`requireRole`) | Control plane | **Implemented (v0.3)** | Session-based, `express-session` + `connect-mongo` on the same Atlas cluster. No self-registration route — accounts are provisioned via `bin/seed-users.js`, one per role, since every role is a real access boundary. Closes T-01's authentication gap |

### 3.2 Trust boundaries

```mermaid
flowchart LR
    subgraph Untrusted["Untrusted zone"]
        Client["Browser / API client (C1, C2)"]
        Upload["Ingested documents & video (C5, C16)"]
    end

    subgraph AppBoundary["Application trust boundary"]
        API["Express API (C3)"]
        Plan["Query planner (C9)"]
        Filter["Access filter (C8a)"]
        Rerank["Rerank (C10)"]
        Guard["Grounding / abstention (C12)"]
    end

    subgraph DataBoundary["Data store trust boundary"]
        Mongo["MongoDB Atlas (C4)"]
        Docs["Local document store (C5)"]
        Idx["Local hybrid index: BM25 + vectors (C8)"]
        Logs["App logs (C13)"]
        Tel["Telemetry (C14)"]
        Trail["Access-audit trail (C15)"]
    end

    subgraph ModelBoundary["Operator's local machine (no longer an AWS account boundary)"]
        OCR["OCR sidecar (C6)"]
        Ollama["Ollama (C11)"]
    end

    Client -->|HTTP, session-gated for chat/telemetry/audit| API
    Upload -->|offline ingestion| Docs
    API --> Mongo
    API --> Plan
    Docs --> OCR
    OCR --> Idx
    Plan --> Filter
    Filter --> Idx
    Idx --> Rerank
    Rerank --> Guard
    Guard --> Ollama
    Ollama --> Guard
    Guard --> API
    API --> Client
    API -.-> Logs
    Filter -.-> Trail
    API -.-> Tel
```

**Key boundary crossings that matter for threats:**

1. **Client → API (T1 boundary):** `/api/chat`, `/api/telemetry` and
   `/api/audit` now require a session (C18, v0.3) and role comes from it,
   never from the request body. `/api/sources` (create/archive/ingest a
   source) is **still unauthenticated** — deliberately out of scope for this
   revision to avoid breaking an existing test that drives it anonymously;
   see the open question in §8.
2. **API/Plan → Ollama (local model):** document content leaves the
   retrieval layer and reaches the generation step. This no longer crosses
   an AWS account boundary (Ollama runs on the operator's own machine), but
   the trust question is unchanged: prompt injection embedded in an
   ingested document still crosses this boundary as instructions, not just
   data, and nothing here defends against that specifically yet (T-03).
3. **Access filter → Rerank (C8a → C10):** this is the pre-retrieval
   access-control enforcement point required by Epic 5, now implemented —
   filtering runs inside both the BM25 and dense arms before fusion, so a
   restricted chunk is never assembled into a ranked list in the first
   place. Filtering in the UI afterward would not be real access control,
   because the content would already have reached the model by then.
4. **Access filter → Access-audit trail (C8a -.-> C15):** every grant and
   denial is now recorded (E5-19) — this is the negative-proof mechanism
   Test A needs: an audit row that never contains a given document, for a
   given role, over a given window.
5. **API/Plan → Logs/Telemetry:** anything logged here persists outside
   the data classification the source was assigned (e.g. a sensitive query
   string ending up in a plaintext log). Telemetry (C14) is deliberately
   content-free; application logs (C13) are not (T-04, unchanged since
   v0.1).

## 4. Data Classification Scheme

| Tier | Definition | Criteria | Examples in this system |
|---|---|---|---|
| **Public** | Freely shareable, already public before entering the system | No restriction on redistribution; no attribution to an identifiable individual required | Published ranking data, public conference talks, research papers |
| **Internal** | Not secret, but not meant for external distribution | Produced or held by the team for internal coaching/demo use; disclosure would cause minor embarrassment or confusion, not harm | Internal coaching notes, draft match reports, demo corpus manifests |
| **Sensitive** | Disclosure could cause reputational, competitive or contractual harm | Tied to a specific team/organisation's competitive advantage, or covered by a data-sharing agreement | Unpublished scouting reports, coach interview transcripts, opponent analysis |
| **Personal** | Identifies or can reasonably identify a natural person | Contains name, contact detail, or another identifier that is linkable to one individual, per privacy-law definitions of PII | Athlete names tied to performance stats, player contact info, session participant identity |
| **Biometric** | Derived from an individual's physical/behavioural characteristics | Data captured from body, motion or physiological signal, usable to identify or profile a specific person | Video frames showing an identifiable stroke sequence/face, any future motion-capture or physiological data |

Ordering is cumulative for risk purposes: `Public < Internal < Sensitive <
Personal < Biometric`. A document containing any Personal or Biometric
element is classified at that level even if the rest of the document is
Public.

### 4.1 Data inventory (current + planned) mapped to classification

| Data | Where it lives | Classification | Why |
|---|---|---|---|
| Source registry metadata (title, description, sourceType) | MongoDB (C4) | Internal | Team-authored catalog entries, no PII by design today |
| Ingested research papers, ranking data (published) | Local store → local index (C5, C8) | Public | Already public before ingestion |
| Coach interviews, internal notes, scouting/match reports | Local store → local index (C5, C8) | Sensitive (may contain Personal) | Competitive value; may name athletes |
| Video clips with identifiable stroke sequences | Local store → Ollama (C5, C11) | Biometric | Directly identifies a person via motion/appearance. Not currently ingested — no video path exists in the implemented pipeline |
| Chat queries and generated answers | API ↔ query planner ↔ Ollama (C3, C9, C11) | Inherits the classification of the evidence cited | An answer citing a Sensitive source is itself Sensitive |
| Access-audit records (role, document/chunk id, classification tags — never chunk text) | C15 | Internal | Same content-free rule as telemetry; identifiers and classification tags only |
| Application error logs | Console / C13 | Currently unclassified — **gap, unchanged since v0.1** | `console.error(error)` may capture request bodies/stack traces containing any of the above |
| `.env` credentials (Mongo URI) | Local `.env`, gitignored | Sensitive (secret) | Full database access if leaked |
| Telemetry records | C14 | Internal (must stay content-free) | Must record metadata (counts, latency) not raw content — see T-04 |

## 5. Threat Register

Risk = Likelihood × Impact, rated Low / Medium / High. Every **High**
risk carries a mandatory mitigation and is recorded as a **blocker** to
handling any real (non-synthetic) data, per §7.

| ID | Category | Threat | Affected component(s) | Likelihood | Impact | Risk | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|
| T-01 | Unauthorised data access | ~~No *authentication* exists on the API today~~ **Closed for `/api/chat`, `/api/telemetry`, `/api/audit` (v0.3, C18)** — role now comes from `req.user.roleId`, set by `requireAuth` from a server-side session, never from a request field. `test/integration/auth.test.js` proves this end-to-end, including the specific case of a client sending `role: "admin"` in the body and having it ignored. `/api/sources` is a known, deliberate exception — still open, see §8 | C2, C3, C18 | Low (for the gated routes) | High | Medium (was High) | Session-based auth (`express-session` + `connect-mongo`), no self-registration (`bin/seed-users.js` provisions accounts). Combined with E5-17's filter (T-02), a role can no longer be both claimed and trusted by the same untrusted caller | E5-17/C18 owner | **Closed for chat/telemetry/audit (v0.4: Test A's live session run passed, see §6) — `/api/sources` still open, tracked as a new item in §8** |
| T-02 | Cross-user data leakage | Retrieval returns chunks the requesting role should not see, because ACL filtering happens after retrieval instead of before | C8, C8a, C9 | Low (mitigated) | High | Medium (was High) | **Closed in code**: `acl_groups` is written on every chunk at index time (schema v2, TENISE-15), and `buildAccessFilter`/`isPermitted` filter inside both the BM25 and dense arms before fusion, re-verified by `assertAccessInvariant` after. Unit-tested (`test/unit/accessControl.test.js`, `test/unit/vectorStore.test.js` — "applies the access filter before scoring, not after"). Residual risk is entirely T-01's: filtering is only as trustworthy as the role it's given | E5-17 owner | **Closed — Test A passed live end-to-end (v0.4), see §6** |
| T-03 | Prompt injection via ingested documents | Instructions embedded in an ingested PDF/DOCX/transcript attempt to override system behaviour once ingested and later cited as evidence | C5, C6, C9, C11, C12 | Medium (mitigated, not eliminated) | High | Medium (was High) | **Prompt-level mitigation added (v0.3)**: both system prompts (`generationPrompt.js`, `answerContract.service.js`) now explicitly instruct the model to treat evidence as data even when phrased as an instruction, and every evidence block is wrapped in `<<<BEGIN/END EVIDENCE>>>` markers the rule points at. Test B (adversarial evidence: forced output, alter-ego, system-prompt exfiltration) is written in `generation.test.js`, but **has not been empirically run against a live model in any environment used on this project so far** — it needs Ollama running to execute, same constraint as the existing TENISE-19 control tests. A prompt-level defence is inherently weaker than a dedicated guardrail/classifier layer; this is risk reduction, not elimination | E4/E5 owners | **Mitigated, unverified — Test B needs a real run before this can be called closed** |
| T-04 | Sensitive data in prompts/responses/logs | A Sensitive/Personal/Biometric source is quoted verbatim in a generated answer, or the request/response pair is written to logs or telemetry unredacted | C11, C13, C14 | Low (mitigated) | High | Medium (was High) | Citation binding references chunk IDs, not forced verbatim reproduction. Telemetry (TENISE-26) is confirmed content-free (`sanitizeAttributeValue` strips objects, truncates strings). The access-audit trail (E5-19, C15) stores only identifiers and classification tags, never chunk text, by the same rule. **Closed (v0.5)**: `errorHandler.js` no longer does a raw `console.error(error)` — logs `stack`/`message` only, through a credential-redaction pass, never `req.body` | Telemetry + logging owners | **Closed (v0.5)** |
| T-05 | Credential exposure | Secrets (Mongo URI, cloud keys) committed to git, printed to logs, or shared in chat/tickets in plaintext | C17, C13 | Medium | High | **High** | `.env` stays gitignored (already true); logs are now redacted for connection-string-shaped credentials (T-04, v0.5). A live AWS key and unused `QDRANT_*` values, dead since the AWS pivot, are confirmed unread by any code but are kept in `.env` deliberately (project owner's choice, v0.6) rather than removed. **Still open, needs a human with console access, not an engineering task**: rotate/deactivate that AWS key, and rotate the MongoDB Atlas password (see note below) — a local `.env` edit was never going to be the actual fix for either | Whole team | **Open — blocker (unchanged; live credential rotation still needed)** |
| T-06 | Malicious or corrupt uploads | A corrupt or crafted file (e.g. the deliberately corrupt PDF in TENISE-34's test corpus, or a zip bomb / oversized file) disrupts ingestion or is used as an attack vector | C5, C6, C16 | Medium | Medium | Medium | Ingestion pipeline must isolate per-file failures (already an acceptance criterion of TENISE-11) and cap file size/type at upload; multer middleware (`upload.middleware.js`) needs size/type limits wired before it is mounted — still not mounted on any route | TENISE-11 owner | Open, unchanged since v0.1 |
| T-07 | Incomplete data deletion | Archiving a source (`archiveSource`) only sets `isActive: false` — the document and its underlying chunks/embeddings/log traces are not actually erased | C4, C8, C13, C14, C15 | High (already true today) | Medium | Medium | Define and document a real deletion/retention path before real data is loaded: what "delete" means across Mongo, the local index, logs, telemetry, and now the audit trail too (audit retention is deliberately long, 400 days — see `audit.config.js` — which makes this more not less important to define) | Data owner (TBD) | Open, unchanged since v0.1 |
| T-08 | Unrestricted cross-origin access | `app.use(cors())` allowed any origin with no allow-list, widening who could call the API from a browser context once C2 is not the only client | C3 | Low (mitigated) | Medium | Low (was Medium) | **Closed (v0.5)**: `cors({ origin: env.allowedOrigin })`, defaulting to this app's own origin (`ALLOWED_ORIGIN` env var to override). Verified live: a request claiming `Origin: http://evil.example.com` gets back `Access-Control-Allow-Origin: http://localhost:3000`, not a reflected `evil.example.com` | C18 owner | **Closed (v0.5)** |

**Note on T-05:** a real MongoDB Atlas connection string (including
password) was shared in this chat session on 2026-07-28 to unblock local
development. It is stored only in the gitignored `.env` file, but per this
threat's own mitigation it should be **rotated** once no longer needed for
active development, since it passed through a non-secret channel. (v0.5: a
second, unrelated live credential was found the same way while working on an
unrelated bug — a real AWS access key sitting in the same `.env`, dead since
the AWS pivot. v0.6: the project owner has chosen to keep that key and the
unused `QDRANT_*` values in `.env` rather than delete them, even though
nothing reads them — that is a legitimate call for a local dev file, but it
means the key itself still needs deactivating in AWS directly; deleting it
from `.env` here was never going to accomplish that on its own.)

## 6. Required Tests (per acceptance criteria)

| Test | Verifies | Depends on | Status |
|---|---|---|---|
| **Test A** — a role without access to a restricted document cannot retrieve it through the chat interface, even indirectly via citation | T-01, T-02 | E5-17 (access-control implementation), E3-09 (ACL field in schema) | **Fully passed (v0.4).** (1) Role cannot be spoofed: proven end-to-end against a real server, `test/integration/auth.test.js` — a session's real role is used even when the request body claims `role: "admin"`. (2) The filter itself: unit-tested (`accessControl.test.js`, `vectorStore.test.js`). (3) The end-to-end run: run live through the real chat UI with real sessions for `analyst`, `tour_coach`, `academy_coach` on the identical question against a document classified `physiological:internal:national-academy`. `academy_coach` answered with citations; `analyst`/`tour_coach` abstained. The `access_audit_records` rows for the same question, compared directly, confirm it at the log level: `academy_coach`'s record lists the 4 restricted chunks; `analyst`'s record for the identical question lists none of them. See the change log (v0.4) for the full detail and TENISE-23 for the Jira-side evidence comment |
| **Test B** — a document containing embedded instructions ("ignore previous instructions...") cannot change system behaviour when ingested and cited | T-03 | E4-16 (prompt template — now written, see T-03), E5-18 (Guardrails — still not built) | **Written, not yet run.** `generation.test.js` has three adversarial cases (forced output, alter-ego, system-prompt exfiltration) that skip cleanly (not fail) when Ollama is unreachable, same as the existing TENISE-19 tests. Nobody has run this against a live model yet — do that before treating T-03 as closed rather than mitigated |
| **Test C** — application logs and telemetry records, inspected after a full test run, contain no Personal/Biometric/Sensitive content | T-04 | TENISE-26 (telemetry structure), logging conventions | **Runnable now, and the one known failure is fixed.** Telemetry (C14) and the access-audit trail (C15) are both content-free by construction and unit-tested for it (`accessAuditRecorder.test.js` asserts chunk text is dropped). `errorHandler.js` (v0.5) no longer does an unfiltered `console.error(error)`; verified live with a fake credential-bearing error message. Still needs a full test run inspected end-to-end to formally pass this test, not just the component-level fix |

Test A's remaining gap and Test B both need a machine with Ollama (and, for
Test A, a built index) to actually execute — write them once such an
environment is available for a CI run or a supervised local run, rather
than leaving them permanently aspirational.

## 7. Data Gate (hard constraint)

> No real, identifiable athlete information may be uploaded, indexed, sent
> to an AI model, or included in logs until **all** of the following are
> confirmed:

- [ ] Data classification scheme reviewed and accepted (§4)
- [x] Access controls implemented and tested (T-01, T-02 closed — Test A passes) — **closed v0.4, TENISE-23.** Test A's end-to-end half ran live (real session + real retrieval + audit trail together, see §6) and TENISE-23 (E5-17) was moved to Done in Jira with this evidence attached on 2026-08-20.
- [ ] Retention/deletion requirements defined (T-07 closed)
- [ ] Project owner authorisation recorded

Until every box is checked, the corpus (TENISE-34) must remain synthetic,
public, or anonymised, which matches TENISE-34's own acceptance criteria.
This document is the tracking point for that gate — do not check a box
here without linking the Jira ticket that closed it. (v0.4 note: one box
closed with a linked ticket. The remaining three are unrelated to access
control — data classification sign-off, retention/deletion policy (T-07),
and project owner authorisation are still open and still need a human,
not an engineering task, to close them.)

## 8. Open Questions / Assumptions

1. ~~**Vector store mismatch**~~ — **Resolved (2026-08-18), differently than either option this document previously named.** Neither Qdrant nor OpenSearch: the team dropped AWS entirely (TENISE-40, 2026-07-30) and the implemented retrieval index is a custom local store — sharded, int8-quantised vectors (`infrastructure/vector/vectorStore.service.js`) plus a separate BM25 keyword index (`retrieval/bm25.service.js`), combined by reciprocal rank fusion. `qdrant.client.js` is still an empty, unreferenced stub and should still be deleted — it describes neither the old plan nor the current implementation.
2. **Temporary file handling:** `upload.middleware.js` exists but is not
   mounted on any route yet. Unchanged since v0.1. Somewhat lower priority
   now that ingestion in practice runs offline via `bin/build-index.js`
   against a local filesystem path, not through an upload endpoint — but
   the acceptance criteria still call for one, so this remains open.
3. ~~**Auth mechanism choice**~~ — **Resolved (2026-08-18, v0.3): session-based**, via `express-session` + `connect-mongo` on the existing Atlas cluster, no new datastore. `User` model in `modules/auth`, provisioned by `bin/seed-users.js` (one demo account per role), no self-registration route.
4. **`/api/sources` is not behind `requireAuth`.** Every other route that
   touches non-public data now is (C1, C2 notes). This one was left open
   deliberately in v0.3 — `test/integration/telemetryHttpRoute.test.js`
   drives it anonymously (`POST /api/sources/:id/ingest`) and gating it
   would have broken a passing test as a side effect of unrelated work.
   Gating it properly needs that test updated to authenticate first, which
   is a small, contained follow-up, not a redesign.
5. **The frontend login page exists locally but is not in this repository**
   (see change log). Until it lands, there is no way to reach `/api/chat`
   through the browser at all — a demo today needs `curl`/Postman with a
   session cookie from `POST /api/auth/login`, or the frontend work merging
   in from wherever it currently lives.
6. **Audit trail identity is still role-level** (C15), not per-account, even
   though C18 now has real accounts to attribute to. `accessAuditRecorder.js`
   would need `req.user.id` threaded through in addition to `roleId` to
   close this — small, not done in v0.3.

## 9. Definition of Done (mirrors ticket acceptance criteria)

- [x] All components, data stores, external services and trust boundaries identified (§3) — updated v0.2 for the local stack
- [x] All data types classified with criteria (§4)
- [x] Threat register covering all eight required categories (§5)
- [x] Each threat records likelihood, impact, mitigation, owner, status (§5)
- [x] Every High-risk threat has a mitigation strategy and is recorded as a blocker (§5, T-01–T-05)
- [ ] Test A, B, C pass against a running system (§6) — **v0.4: Test A fully passed, live, end-to-end (§6).** Test B is written and still needs a live run to move from "should work" to "does work" — same live Ollama environment now exists, so this is unblocked, just not yet done. Test C needs the `errorHandler.js` fix, unchanged
