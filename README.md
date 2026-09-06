# TennisExplore V2

TennisExplore V2 is a modular AI-powered tennis intelligence platform that combines natural-language coaching questions, hybrid retrieval, structured data analysis, role-based access control, traceable citations, and telemetry in one application.

## Current Progress

### Completed

- Modular Express backend architecture with MongoDB integration
- Unified AI Coach web interface at `/`
- Platforms page at `/platforms` with navigation back to the AI Coach
- Single natural-language chat endpoint with no user-selected query mode, source, model, or backend route
- Visible processing, completed, and error states, including a deliberate failure endpoint for UI testing
- Session-based authentication with MongoDB-backed sessions
- Role-based access control for chat retrieval and protected telemetry/audit routes
- Access-audit recording for document access decisions
- Source Registry with create, read, ingest-trigger, and soft-delete APIs
- Telemetry records for API requests, query stages, ingestion runs, latency, volume, and cold starts
- Local indexing pipeline for PDF, CSV, XLS/XLSX, PPTX, TXT, MD, and JSON video manifests
- Optional OCR sidecar support for scanned PDFs
- Contextual chunking, metadata extraction, embedding generation, and sharded vector index storage
- Index schema v2 with access-control metadata, dates, authors, source location, and citation fields
- Hybrid retrieval using BM25 + dense vectors with Reciprocal Rank Fusion (RRF)
- LLM reranking by default, with optional external cross-encoder reranking service support
- Query planning, intent routing, and multi-hop decomposition
- Structured query engine for CSV/XLSX data with validated query specifications and rendered SQL
- Explicit abstention when the knowledge base cannot support an answer
- Generation pipeline with evidence grading, few-shot prompting, context ordering, citation verification, and grounding checks
- Citation binding back to indexed chunks with page, slide, row, or video timestamp locators
- Compact Sources popover and side-panel source viewer in the web UI
- Retrieval, generation, access-control, telemetry, citation, and UI unit-test coverage

### In Progress / Temporary Development Behaviour

- Source file upload and fully wired API-triggered ingestion stages
- Production-ready sign-in UI and session flow
- Player intelligence extensions
- Coaching intelligence extensions
- Replacing temporary platform links with the real platform URLs

Cross-machine availability of original source assets used by citation previews is now available, opt-in, via S3 storage — see [Asset Storage (S3)](#asset-storage-s3) below. Off by default; the local-disk behaviour described above is unchanged unless `STORAGE_PROVIDER=s3` is set.

> **Development note:** non-production runs currently create a temporary Admin session automatically so the protected chat flow can be tested without manual sign-in. This must be removed or disabled before production deployment.

---

## Quick Start

### Requirements

Install:

- Node.js 20+
- [Ollama](https://ollama.com/download)
- MongoDB access for the web/API application

The command-line retrieval tools (`search`, `ask`, and evaluation commands) use the committed local index and do not require MongoDB.

### Setup

```bash
git clone https://github.com/bestboylaco/tennis-explore-v2.git
cd tennis-explore-v2
npm install
```

Create a local environment file:

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Set at least:

```env
PORT=3000
MONGODB_URI=your_mongodb_connection_string
SESSION_SECRET=your_local_session_secret
```

`SESSION_SECRET` is strongly recommended. If it is omitted, the app creates a random per-process secret and all sessions are invalidated whenever the server restarts.

Pull the local models:

```bash
ollama pull bge-m3
ollama pull llama3.1:8b
npm run check:models
```

Start the application:

```bash
npm run dev
```

Open:

- `http://localhost:3000/` — unified AI Coach
- `http://localhost:3000/platforms` — integrated platforms page
- `/explore` — compatibility redirect back to `/`

---

## Retrieval Quick Start

The committed index is stored in `data/index/`, so most teammates do **not** need to rebuild it.

```bash
# Retrieval only: inspect what evidence is returned
npm run search -- "accelerometer load during tournaments"

# Full answer with citations
npm run ask -- "how does serve load differ between training and tournaments?"

# Structured/table question
npm run ask -- "how many matches were played on each surface?"

# Evaluation
npm run eval
npm run eval:answers
```

### Build or Rebuild the Index

Only rebuild when you have the source corpus and intentionally need a new index:

```bash
npm run build:index -- "path/to/source-folder"
```

or with a larger Node heap:

```bash
node --max-old-space-size=6144 bin/build-index.js "path/to/source-folder"
```

The local indexer currently supports:

- PDF
- CSV
- XLS / XLSX
- PPTX
- TXT
- MD
- JSON video manifests containing timestamped video segments

Raw video files such as `.mp4` are not directly parsed by the indexer; video evidence is represented through indexed segment metadata/manifests. Scanned PDFs can use optional OCR sidecar text.

---

## Access Control

Retrieval requires a role and filters evidence **before ranking**. Supported roles are:

- `admin`
- `academy_coach`
- `tour_coach`
- `analyst`
- `strength_conditioning`
- `physiotherapist`
- `member_services`
- `athlete`

Example:

```bash
npm run search -- --role admin "athlete heart rate monitoring"
npm run search -- --role analyst "athlete heart rate monitoring"
```

The web chat uses the authenticated session role as the authoritative access role. A client-supplied role must not be treated as an authentication boundary.

For local authentication testing, demo users can be seeded with:

```bash
npm run seed:users -- --password "YourDemoPassword"
```

---

## Web UI

The root page is the unified AI Coach interface.

It supports:

- natural-language question submission
- processing and failure feedback
- normal document answers and structured table answers
- SQL display for structured queries
- citation markers in generated answers
- a compact Sources popover
- a side source panel that keeps the conversation visible
- page, slide, row, and video timestamp citation locations
- direct links to original indexed assets when available locally

If an index was built on another machine and the original source file is not present locally, `/api/assets/:docId` returns an explicit `ASSET_NOT_LOCAL` response. The indexed text and citation metadata remain available even when the raw file is missing. Enabling S3 storage (below) removes this limitation — every machine reads citation files from the same bucket instead of local disk.

---

## Asset Storage (S3)

Citation-linked source files (PDFs, slides, spreadsheets, video) are served from **local disk by default** (`STORAGE_PROVIDER=local`, or unset) — that's all the local demo needs, and it's what `/api/assets/:docId` has always done.

Setting `STORAGE_PROVIDER=s3` switches that route to read the same files from an S3 bucket instead, fixing the cross-machine gap above. It works against real AWS or any S3-compatible server — the code only ever speaks the S3 API, never anything AWS-specific — so it can be developed and tested against a local [MinIO](https://min.io/) container with no AWS account at all:

```bash
docker compose up -d   # starts MinIO, creates the bucket (docker-compose.yml)
```

### Switching to a partner-provided bucket

Once a real AWS bucket and an access key are available, no code changes are needed — only `.env`:

```bash
STORAGE_PROVIDER=s3
S3_BUCKET=<their bucket name>
S3_REGION=<their bucket's region>
S3_ENDPOINT=                # blank for real AWS; only set for MinIO/LocalStack
S3_FORCE_PATH_STYLE=false   # true only for MinIO/LocalStack
S3_ACCESS_KEY_ID=<their access key id>
S3_SECRET_ACCESS_KEY=<their secret access key>
ASSET_SOURCE_ROOT=<the local root every indexed file's path is under>
```

Then, once for the currently-built index (it does not need to be rebuilt — this only uploads files, it does not re-embed anything):

```bash
npm run backfill:s3
```

`ASSET_SOURCE_ROOT` is how a file already recorded in the index (`sourceUri`, a local path from whichever machine built it) maps to the S3 key that same file gets uploaded under — see `src/infrastructure/storage/storageKey.service.js`. Get it wrong and every citation will 410 with `ASSET_NOT_IN_BUCKET` rather than opening; a rerun of `npm run backfill:s3` after fixing it is safe, since it skips whatever the previous run already got into the bucket.

Going back to local disk at any point is just unsetting `STORAGE_PROVIDER` — nothing about local mode changes because S3 mode exists.

---

## API Endpoints

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| GET | `/api/health` | Server and MongoDB health | Public |
| POST | `/api/auth/login` | Create authenticated session | Public |
| POST | `/api/auth/logout` | Destroy authenticated session | Session |
| GET | `/api/auth/me` | Read current session user | Public/session-aware |
| POST | `/api/chat` | Submit a natural-language question | Authenticated |
| POST | `/api/chat/fail` | Deliberate failure endpoint for UI testing | Authenticated |
| GET | `/api/sources` | List active sources | Current implementation |
| POST | `/api/sources` | Create source metadata | Current implementation |
| GET | `/api/sources/:sourceId` | Get one active source | Current implementation |
| POST | `/api/sources/:sourceId/ingest` | Trigger instrumented ingestion orchestration | Current implementation |
| DELETE | `/api/sources/:sourceId` | Soft-delete/archive a source | Current implementation |
| GET | `/api/telemetry` | List telemetry records | Authenticated |
| GET | `/api/telemetry/summary` | Aggregated telemetry summary | Authenticated |
| GET | `/api/telemetry/:recordId` | Get one telemetry record | Authenticated |
| GET | `/api/assets/:docId` | Open the original asset behind a citation | Per-asset ACL check |
| GET | `/api/audit` | List access-audit records | Admin only |
| GET | `/api/audit/documents-accessed` | Reconstruct documents accessed by role/time | Admin only |

### Current API Ingestion Scope

The offline/local index builder is fully implemented. The Source Registry ingestion endpoint currently provides the instrumented orchestration and lifecycle/telemetry contract, while the API-side extraction, chunking, embedding, and indexing handlers are still being wired into that route.

---

## Telemetry and Audit

Telemetry records are written for startup/application activity, API requests, query processing, and ingestion orchestration. Query records can be correlated with HTTP request records through a shared correlation ID.

Telemetry includes stage timing, query class, run status, ingestion volume, model/API usage, and cold-start information.

Access-audit records separately capture which role was granted or denied access to which indexed documents without storing raw chunk content.

See:

- [`docs/telemetry-record-design.md`](docs/telemetry-record-design.md)
- [`docs/data-threat-model-and-classification.md`](docs/data-threat-model-and-classification.md)

---

## Project Structure

```text
src/
├── config/
├── infrastructure/
│   ├── database/
│   ├── storage/
│   └── vector/
├── middleware/
├── modules/
│   ├── assets/
│   ├── assistant/
│   ├── audit/
│   ├── auth/
│   ├── chat/
│   ├── generation/
│   ├── ingestion/
│   ├── query/
│   ├── retrieval/
│   ├── sources/
│   ├── structured/
│   └── telemetry/
└── shared/

public/
├── index.html
├── platforms.html
├── scripts/
└── styles/

bin/
├── ask.js
├── build-index.js
├── check-models.js
├── eval.js
├── eval-answers.js
├── search.js
└── seed-users.js
```

---

## Useful Commands

```bash
npm run dev              # development server with nodemon
npm start                # start server normally
npm test                 # unit tests
npm run test:unit        # unit tests
npm run test:integration # integration tests
npm run check:models     # verify Ollama models
npm run search -- "..." # retrieval only
npm run ask -- "..."    # full answer
npm run eval             # retrieval evaluation
npm run eval:answers     # end-to-end answer evaluation
npm run seed:users       # create demo users
```

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/HOW-TO-RUN.md`](docs/HOW-TO-RUN.md) | Detailed setup and running instructions |
| [`SYSTEM-OVERVIEW.md`](SYSTEM-OVERVIEW.md) | **Non-technical.** How it works, with diagrams and a worked example |
| [`CODE-TOUR.md`](CODE-TOUR.md) | Where everything is, and one question followed through the code |
| [`PIPELINE.md`](PIPELINE.md) | S3 to answers: prepare every content type, then build |
| [`TEAM-SETUP.md`](TEAM-SETUP.md) | Teammate setup and local model workflow |
| [`RUN-STACK.md`](RUN-STACK.md) | Full-stack run and troubleshooting notes |
| [`docs/RETRIEVAL-DESIGN.md`](docs/RETRIEVAL-DESIGN.md) | Retrieval techniques and design decisions |
| [`docs/MEDIA-INGESTION.md`](docs/MEDIA-INGESTION.md) | Transcribing video, captioning images and slide figures, plus the AWS pulls |
| [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) | End-to-end retrieval and answer flow |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture |
| [`docs/QUERY-HANDLING.md`](docs/QUERY-HANDLING.md) | Query classification, planning, and routing |
| [`docs/SHARING-THE-INDEX.md`](docs/SHARING-THE-INDEX.md) | Sharing the committed retrieval index |
| [`docs/CORPUS-AND-COVERAGE.md`](docs/CORPUS-AND-COVERAGE.md) | Corpus contents and answer coverage |
| [`docs/ASSET-GAP-REPORT.md`](docs/ASSET-GAP-REPORT.md) | Missing/local source asset analysis |
| [`docs/source-registry-design.md`](docs/source-registry-design.md) | Source Registry design |
| [`docs/telemetry-record-design.md`](docs/telemetry-record-design.md) | Telemetry record contract |
| [`docs/data-threat-model-and-classification.md`](docs/data-threat-model-and-classification.md) | Security classification and threat model |
| [`schema/index-schema.json`](schema/index-schema.json) | Retrieval/index schema contract |

---

## Development Workflow

Do not work directly on `main`.

```bash
git checkout -b feature/your-feature-name
```

After completing the work:

```bash
git add .
git commit -m "Describe the completed change"
git push -u origin feature/your-feature-name
```

Then create a pull request into `main`.

Before merging, make sure temporary development-only behaviour (especially automatic Admin authentication) is clearly identified and is not treated as the production security model.
