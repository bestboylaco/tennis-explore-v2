# TennisExplore V2 — Source Registry Design

## 1. Purpose

The Source Registry manages every knowledge asset available to TennisExplore.

A source may represent:

- Research paper
- Coach interview
- Conference transcript
- Ranking dataset
- Match report
- Player report
- Internal coaching note
- Video transcript

The Source Registry stores identity, metadata, storage details, and processing state.

It does not store extracted chunks or embeddings directly.

---

## 2. Source Lifecycle

A source moves through the following states:

```text
pending
    ↓
uploaded
    ↓
processing
    ↓
completed