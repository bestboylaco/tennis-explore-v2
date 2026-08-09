// turns text into vectors.
//
// two providers.
//
// "ollama" is the real one. it posts to a locally running ollama server, so no
// text leaves the machine -- which matters here, because the corpus contains
// athlete performance data and the partner's own security policy would not
// permit shipping it to a hosted embedding api.
//
// "hash" is a deterministic offline stand-in. it needs no model, no gpu and no
// network, and it exists so the pipeline and the tests can run on a laptop with
// nothing installed. the vectors it makes are meaningless for similarity, so the
// provider name is written into the index manifest and every tool that loads an
// index will warn if it finds a hash-built one. never demo with it.

import { retrievalConfig } from "../../config/retrieval.config.js";

export class EmbeddingError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "EmbeddingError";
    this.code = "EMBEDDING_FAILED";

    if (cause) this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// ollama
// ---------------------------------------------------------------------------

async function embedWithOllama(texts, { model, baseUrl, signal }) {
  const url = `${baseUrl}/api/embed`;

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // /api/embed takes an array and returns an array in the same order, which
      // is the whole reason we batch: one request for sixteen chunks instead of
      // sixteen round trips.
      body: JSON.stringify({ model, input: texts }),
      signal,
    });
  } catch (error) {
    throw new EmbeddingError(
      `could not reach ollama at ${url}. is ollama running? try: ollama serve`,
      { cause: error },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");

    if (response.status === 404) {
      throw new EmbeddingError(
        `ollama does not have the model "${model}". pull it first:\n  ollama pull ${model}`,
      );
    }

    throw new EmbeddingError(`ollama embed failed with status ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const vectors = payload.embeddings ?? (payload.embedding ? [payload.embedding] : null);

  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new EmbeddingError(
      `ollama returned ${vectors?.length ?? 0} vectors for ${texts.length} inputs. ` +
        `the batch and the results are no longer aligned, so nothing can be indexed safely.`,
    );
  }

  return vectors;
}

// ---------------------------------------------------------------------------
// hash (offline stand-in)
// ---------------------------------------------------------------------------

// fnv-1a. small, fast, and stable across runs and machines, which is the only
// property that matters here -- the same text must always give the same vector
// or the tests are not reproducible.
function fnv1a(text) {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
}

function embedWithHash(texts, { dimension }) {
  return texts.map((text) => {
    const vector = new Array(dimension).fill(0);

    // a bag-of-words sketch: every token lands in one bucket. this gives a weak
    // but real lexical signal, so a hash index at least behaves like *something*
    // rather than pure noise when you are testing the plumbing.
    for (const token of String(text).toLowerCase().split(/\s+/)) {
      if (token === "") continue;

      const bucket = fnv1a(token) % dimension;
      const sign = fnv1a(`${token}#sign`) % 2 === 0 ? 1 : -1;

      vector[bucket] += sign;
    }

    return vector;
  });
}

// ---------------------------------------------------------------------------
// public api
// ---------------------------------------------------------------------------

/**
 * embeds a list of texts, in batches, in order.
 *
 * `onProgress` is called after each batch so a long index build can print a
 * line instead of looking frozen for forty minutes.
 */
export async function embedTexts(texts, { onProgress = null, signal = null } = {}) {
  const { provider, model, dimension, baseUrl, batchSize } = retrievalConfig.embedding;

  if (texts.length === 0) return [];

  const out = [];

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);

    const vectors =
      provider === "hash"
        ? embedWithHash(batch, { dimension })
        : await embedWithOllama(batch, { model, baseUrl, signal });

    // check the very first vector against the configured dimension and stop
    // immediately if it disagrees. finding this out after embedding 7000 chunks
    // wastes an hour; finding it out on chunk one wastes a second.
    if (out.length === 0 && vectors[0]?.length !== dimension) {
      throw new EmbeddingError(
        `model "${model}" returns ${vectors[0]?.length}-dimension vectors but the ` +
          `config says ${dimension}. set EMBEDDING_DIMENSION=${vectors[0]?.length} ` +
          `in your .env, or switch models, then rebuild from scratch.`,
      );
    }

    out.push(...vectors);

    if (onProgress) onProgress({ done: out.length, total: texts.length });
  }

  return out;
}

export async function embedQuery(text, options = {}) {
  const [vector] = await embedTexts([text], options);
  return vector;
}

/**
 * a cheap liveness check so `build:index` can fail in two seconds with a useful
 * message instead of failing forty minutes in.
 */
export async function checkEmbeddingProvider() {
  const { provider, model, baseUrl } = retrievalConfig.embedding;

  if (provider === "hash") {
    return { ok: true, provider, model: "hash", warning: "hash vectors are not real similarity" };
  }

  try {
    const vector = await embedQuery("connection check");
    return { ok: true, provider, model, baseUrl, dimension: vector.length };
  } catch (error) {
    return { ok: false, provider, model, baseUrl, error: error.message };
  }
}
