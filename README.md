# TennisExplore V2

TennisExplore V2 is a modular AI-powered platform for tennis intelligence, coaching insights, and performance analytics.

## Current Progress

### Completed

- Modular backend architecture
- MongoDB connection
- Source Registry
- Source validation
- Create and read source APIs
- Soft-delete source API
- Telemetry scaffolding and record structure
- Document ingestion pipeline (PDF, CSV, XLSX, TXT, MD)
- Text extraction, contextual chunking, embedding generation
- Index schema v2 with enforced access control, dates and authors
- Hybrid retrieval: BM25 + dense vectors fused with RRF, cross-encoder reranking
- Query routing and multi-hop decomposition
- Citation binding back to source chunks, with deep links to page, slide or timestamp
- Query intent routing: single-hop, multi-hop, summarisation, analytical, comparative, aggregation
- Structured query engine over CSV/XLSX with validated specs and rendered SQL
- Explicit abstention when the knowledge base has no answer
- Slide deck and video segment ingestion
- Retrieval and end-to-end evaluation harnesses

### In Progress

- Source file upload
- Player intelligence
- Coaching intelligence

---

## Retrieval quick start

The retrieval pipeline runs on its own — no MongoDB, no AWS, no cloud APIs. It
needs [Ollama](https://ollama.com/download) and Node 20+.

```bash
npm install
ollama pull bge-m3 && ollama pull llama3.1:8b
npm run check:models

# build the index from folders of source documents
npm run build:index -- "path/to/DOCUMENTS" "path/to/MATCH_DATA"

# see what retrieval returns, with no model writing an answer
npm run search -- "accelerometer load during tournaments"

# full answer with citations
npm run ask -- "how does serve load differ between training and tournaments?"

# questions about the tables are computed, not retrieved
npm run ask -- "how many matches were played on each surface?"

# compare retrieval strategies, and score the whole assistant
npm run eval
npm run eval:answers
```

The built index is committed in `data/index/`, so if someone has already built
it you can skip straight to `npm run ask` after `git pull`.

**Access control is enforced on every query.** Pass `--role` to see it:

```bash
npm run search -- --role admin   "athlete heart rate monitoring"
npm run search -- --role analyst "athlete heart rate monitoring"
```

The analyst has no physiological access, so the second returns less. Roles are
`admin`, `academy_coach`, `tour_coach`, `analyst`, `strength_conditioning`,
`physiotherapist`, `member_services`, `athlete`.

### Documentation

| Document | What it covers |
|---|---|
| [`docs/HOW-TO-RUN.md`](docs/HOW-TO-RUN.md) | Step-by-step setup, using a larger embedding model, sharing the index |
| [`docs/RETRIEVAL-DESIGN.md`](docs/RETRIEVAL-DESIGN.md) | Why each technique is on or off, with sources |
| [`docs/QUERY-HANDLING.md`](docs/QUERY-HANDLING.md) | How questions are classified and routed, and why not function calling |
| [`docs/ASSET-GAP-REPORT.md`](docs/ASSET-GAP-REPORT.md) | Which partner test questions we cannot yet answer, and what is needed |
| [`docs/GIT-PUSH.md`](docs/GIT-PUSH.md) | Git workflow for this repo |
| [`schema/index-schema.json`](schema/index-schema.json) | The retrieval contract — every indexed field |

## Project Structure

```text
src/
├── config/
├── infrastructure/
├── middleware/
├── modules/
│   ├── assistant/
│   ├── ingestion/
│   ├── retrieval/
│   ├── sources/
│   └── telemetry/
└── shared/
```

## Requirements

Before running the project, install:

- Node.js
- MongoDB access
- Any external services configured in `.env.example`

## Setup

Clone the repository:

```bash
git clone https://github.com/bestboylaco/tennis-explore-v2.git
```

Open the project:

```bash
cd tennis-explore-v2
```

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
copy .env.example .env
```

Add the required values to `.env`.

Start the development server:

```bash
npm run dev
```

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check server health |
| POST | `/api/sources` | Create a source |
| GET | `/api/sources` | List active sources |
| GET | `/api/sources/:sourceId` | Get one active source |
| POST | `/api/sources/:sourceId/ingest` | Run an instrumented ingestion run |
| DELETE | `/api/sources/:sourceId` | Archive a source |
| GET | `/api/telemetry` | List telemetry records |
| GET | `/api/telemetry/summary` | Aggregated latency, volume and cold start figures |
| GET | `/api/telemetry/:recordId` | Get one telemetry record |

## Telemetry

Every run — startup, API request and ingestion — writes a record to the
`telemetry_records` collection. See
[telemetry-record-design.md](docs/telemetry-record-design.md) for the record
structure, the cold start handling and the optional `TELEMETRY_*` environment
variables.

## Development Workflow

Do not work directly on `main`.

Create a branch:

```bash
git checkout -b feature/your-feature-name
```

After completing the work:

```bash
git add .
git commit -m "Describe the completed change"
git push -u origin feature/your-feature-name
```

Then create a pull request on GitHub.