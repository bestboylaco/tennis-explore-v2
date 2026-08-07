# TennisExplore V2 Architecture

## 1. Purpose

TennisExplore V2 is a modular tennis knowledge and intelligence platform.

The system allows users to:

- upload tennis knowledge sources,
- store original files securely,
- process and index their contents,
- retrieve relevant evidence,
- combine evidence from multiple modules,
- generate structured AI answers with citations.

The architecture is designed so that new knowledge modules can be added without rewriting the central AI orchestration engine.

---

## 2. Current Technology Stack

### Backend

- Node.js
- Express
- JavaScript ES modules

### Databases and Storage

- MongoDB for source records and application metadata
- Qdrant for vector storage and semantic retrieval
- Amazon S3 for original uploaded files

### AI

- Ollama
- Llama 3.1 8B
- Embedding provider used by the ingestion pipeline

---

## 3. High-Level Architecture

```text
                         Client
                            │
                            ▼
                       Express API
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
        Source Management             AI Question
              │                           │
              ▼                           ▼
        Upload Pipeline              Orchestration
              │                           │
              ▼                           ▼
          Amazon S3                Module Selector
              │                           │
              ▼                           ▼
          MongoDB                  Retrieval Planner
              │                           │
              ▼                           ▼
        Ingestion Pipeline          Retriever Registry
              │                           │
              ▼                           ▼
           Qdrant                Multiple Retrievers
                                          │
                                          ▼
                                  Evidence Merger
                                          │
                                          ▼
                                  Evidence Ranking
                                          │
                                          ▼
                                   Context Builder
                                          │
                                          ▼
                                    Prompt Builder
                                          │
                                          ▼
                                        Ollama
                                          │
                                          ▼
                                  Structured Answer
                                          │
                                          ▼
                                  Citation Builder



src/
├── config/
│   ├── env.js
│   ├── database.js
│   ├── qdrant.client.js
│   └── s3.client.js
│
├── infrastructure/
│   ├── database/
│   │   └── mongodb.service.js
│   │
│   ├── storage/
│   │   ├── index.js
│   │   ├── storage.service.js
│   │   └── storageKey.service.js
│   │
│   └── vector/
│       └── vectorStore.service.js
│
├── middleware/
│   ├── asyncHandler.js
│   ├── errorHandler.js
│   ├── notFoundHandler.js
│   └── upload.middleware.js
│
├── modules/
│   ├── ai/
│   ├── ingestion/
│   ├── orchestration/
│   ├── retrieval/
│   └── sources/
│
├── shared/
│   └── constants/
│
├── app.js
└── server.js