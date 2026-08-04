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

### In Progress

- Source file upload
- Document ingestion pipeline

### Planned

- Text extraction
- Document chunking
- Embedding generation
- Qdrant vector storage
- Retrieval engine
- AI assistant
- Player intelligence
- Coaching intelligence

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