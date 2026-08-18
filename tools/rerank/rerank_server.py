#!/usr/bin/env python3
"""a real cross-encoder reranker, on your GPU.

why this exists
---------------
ollama has no /api/rerank. it serves a reranker model's embedding layer but not
its classification head, so there is nothing to call -- and
`ollama pull bge-reranker-v2-m3` fails outright because the model is not in
ollama's library. the pull request adding rerank support has been open since
2024.

the default reranker in this project therefore scores passages with the ordinary
chat model, which works everywhere and needs nothing extra. it is decent. it is
not as good as a real cross-encoder, because a cross-encoder reads the query and
the passage together through full attention -- which is exactly the thing that
makes it better than the bi-encoder that retrieved them.

this is ~40 lines of server that gives you the real thing. it speaks the same
{query, documents} -> {results:[{index, relevance_score}]} shape as huggingface
text-embeddings-inference and infinity, so the node side does not care which one
you point it at.

setup
-----
    pip install fastapi uvicorn sentence-transformers

    python tools/rerank/rerank_server.py

then in .env:

    RERANK_STRATEGY=service
    RERANK_API_URL=http://localhost:8787/rerank

vram
----
bge-reranker-v2-m3 is ~1.1 GB in fp16. on an 8 gb card that sits alongside
bge-m3 (2.3 GB) and llama3.1:8b (4.7 GB) with very little room -- ollama will
swap the generation model in and out, so the first answer after a rerank is
slow and later ones are quick. if that is painful, use bge-reranker-base
(~280 MB) instead: noticeably smaller, still far better than llm scoring.
"""
from __future__ import annotations

import argparse
import os

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder

MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
MAX_LENGTH = int(os.environ.get("RERANK_MAX_LENGTH", "512"))

app = FastAPI(title="TennisExplore reranker")

# loaded once at startup, not per request. a cross-encoder is ~1 GB of weights
# and reloading it per call would make this slower than no reranking at all.
model: CrossEncoder | None = None


class RerankRequest(BaseModel):
    query: str
    documents: list[str]
    model: str | None = None
    top_n: int | None = None


@app.on_event("startup")
def load() -> None:
    global model

    # device=None lets sentence-transformers pick cuda when it is there and fall
    # back to cpu when it is not, so the same file runs on a laptop.
    model = CrossEncoder(MODEL, max_length=MAX_LENGTH)
    print(f"loaded {MODEL} on {model.model.device}", flush=True)


@app.get("/health")
def health() -> dict:
    return {"ok": model is not None, "model": MODEL}


@app.post("/rerank")
def rerank(request: RerankRequest) -> dict:
    if not request.documents:
        return {"results": []}

    pairs = [(request.query, document) for document in request.documents]

    # predict() batches internally and runs under no_grad.
    scores = model.predict(pairs)

    results = [
        # the index is what matters: the caller maps scores back onto its own
        # candidate list by position, and every service in this space sorts its
        # output, so returning bare scores in a different order would silently
        # attach each score to the wrong passage.
        {"index": index, "relevance_score": float(score)}
        for index, score in enumerate(scores)
    ]

    results.sort(key=lambda item: item["relevance_score"], reverse=True)

    if request.top_n:
        results = results[: request.top_n]

    return {"results": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)
