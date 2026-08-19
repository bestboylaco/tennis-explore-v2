// turns an evidence set into the block of text the model actually reads.
//
// the formatting here is doing real work. the model has to be able to tell the
// chunks apart in order to cite them, so each one is numbered and labelled with
// where it came from. a plain concatenation of passages gives the model no way
// to attribute anything, and it will then cite nothing or cite everything.

import { retrievalConfig } from "../../config/retrieval.config.js";

/**
 * formats one chunk as a numbered evidence block.
 *
 * note it prints `text`, not `embedding_text`. the contextual header was there
 * to help retrieval find this chunk; showing it to the model just adds tokens
 * and invites it to quote our header back as if the document said it. the same
 * facts are already in the source line above.
 */
function formatChunk(chunk) {
  const source = [
    chunk.title,
    chunk.section ? `section: ${chunk.section.replace(/_/g, " ")}` : null,
    chunk.page ? `page ${chunk.page}` : null,
    chunk.authors?.length ? chunk.authors.slice(0, 3).join(", ") : null,
    chunk.event_date ?? null,
  ]
    .filter(Boolean)
    .join(" | ");

  return `[${chunk.citationNumber}] (${source})\n${chunk.text}`;
}

/**
 * builds the evidence block, stopping before it overruns the model's context.
 *
 * a local 8b model with an 8k window will silently truncate a prompt that is too
 * long, and it truncates from wherever it likes -- so the chunks you carefully
 * ranked first can be the ones that fall off. cutting here, in rank order, means
 * if something has to go it is the lowest-ranked chunk, which is the correct one
 * to lose.
 */
export function buildContext(evidence, { maxChars = 12000 } = {}) {
  const blocks = [];
  const included = [];

  let used = 0;

  for (const chunk of evidence) {
    const block = formatChunk(chunk);

    if (used + block.length > maxChars && blocks.length > 0) break;

    blocks.push(block);
    included.push(chunk.citationNumber);
    used += block.length + 2;
  }

  return {
    text: blocks.length > 0 ? blocks.join("\n\n") : "(no evidence provided)",
    includedCitationNumbers: included,
    droppedCount: evidence.length - included.length,
    chars: used,
  };
}

export const CONTEXT_DEFAULT_MAX_CHARS = 12000;
export const CONTEXT_TOP_N = retrievalConfig.retrieval.topN;
