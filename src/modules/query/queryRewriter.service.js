// turns a follow-up question into one that stands on its own.
//
// the problem this solves
// ----------------------
// "what about clay?" is not a question. it has no verb and no object. bm25
// receives one term and the dense vector is close to meaningless, so retrieval
// finds nothing and the system abstains on something it could have answered
// easily. the previous turn holds the missing half.
//
// two things have to be filled back in:
//
//   coreference   "he", "that paper", "the second one"
//   ellipsis      "what about clay?" -- the verb and object are simply absent
//
//   turn 1   "how many matches were played on clay in 2025?"
//   turn 2   "what about hard court?"
//   rewrite  "how many matches were played on hard court in 2025?"
//
// this runs BEFORE retrieval, not inside generation, because both retrieval
// arms read the question text directly. rewriting after retrieval would be
// rewriting after the damage.
//
// why the default is to do nothing
// --------------------------------
// there are two ways to get this wrong and they are not equally bad.
//
// under-rewriting: the follow-up is not resolved, retrieval finds nothing, the
// system says so. the user rephrases. visible, cheap, self-correcting.
//
// over-rewriting: the user changes subject, the rewrite drags the old subject
// along, and the answer is confident, well cited, and about a question nobody
// asked. nothing looks broken. this is the one that matters.
//
// so a question is left alone unless there is positive evidence that it depends
// on the previous turn. no evidence, no rewrite. that ordering is the whole
// design.

import { retrievalConfig } from "../../config/retrieval.config.js";

// words that only mean something if an earlier turn supplied the referent.
// "it", "that", "those" -- a question containing one of these standing where a
// noun should be cannot be answered on its own.
const COREFERENCE = /\b(it|its|they|them|their|theirs|he|him|his|she|her|hers|this|that|these|those|the same|the former|the latter)\b/i;

// openings that announce a continuation. "what about x" is the canonical
// ellipsis: everything except the new subject has been left out.
const CONTINUATION_OPENER = /^\s*(and|but|so|also|what about|how about|and what about|what of|ok(ay)?,? (and|what|how)|then)\b/i;

// phrases that only make sense relative to something already said.
const RELATIVE_REFERENCE = /\b(the (first|second|third|last|next|other|previous) one|that study|that paper|that one|the study|the paper|as well|instead|compared to that|either of (them|those))\b/i;

// an ordinal or comparative with nothing to compare against.
const DANGLING_COMPARATIVE = /^\s*(what|how) about\b|\b(any (other|more)|what else|anything else|more on)\b/i;

const STOP = new Set([
  "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
  "does", "did", "do", "is", "are", "was", "were", "be", "been", "being",
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "about",
  "with", "that", "this", "these", "those", "from", "at", "by", "as", "it",
  "its", "can", "could", "would", "should", "will", "shall", "may", "might",
  "say", "says", "said", "tell", "show", "give", "me", "us", "our", "we",
  "you", "your", "any", "some", "there", "their", "them", "they", "he", "she",
  "his", "her", "have", "has", "had", "not", "but", "than", "then", "also",
  "much", "many", "more", "most", "less", "least", "into", "over", "under",
  "between", "during", "after", "before", "if", "so", "such", "only", "just",
  // acknowledgments and filler. "yep can you do that" has no real subject at
  // all -- it is pure agreement plus an anaphoric "that" -- but "yep" passes
  // the length filter and survived as if it were a content word, so
  // preservesSubject demanded every rewrite keep the word "yep" in it. no
  // correct rewrite ever does, so every rewrite was rejected and the
  // question fell back to itself (observed live, 2026-09-17: "yep can you do
  // that" retrieved nothing and refused, when the actual question -- what the
  // assistant had just offered to look into -- was answerable).
  "yep", "yeah", "yea", "yup", "sure", "please", "okay", "alright", "cool",
  "great", "nice", "thanks", "thank", "ok",
]);

/**
 * the content words of a question -- what it is actually about, with the
 * grammar stripped out. used both to decide whether a question carries its own
 * subject, and to check a rewrite did not lose it.
 */
export function contentWords(text) {
  return new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}-]+/u)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

/**
 * does this question depend on an earlier turn?
 *
 * deliberately conservative: it answers yes only on positive evidence of
 * dependence. a question it is unsure about is treated as standalone and left
 * untouched, because leaving a question alone can only cost a retrieval miss,
 * while rewriting one wrongly costs a confident wrong answer.
 *
 * costs nothing -- no model call. a standalone question therefore adds no
 * latency at all, which matters because most questions are standalone.
 */
export function dependsOnHistory(question, history = []) {
  if (!history.length) return { dependent: false, reason: "no_history" };

  const text = String(question ?? "").trim();

  if (!text) return { dependent: false, reason: "empty" };

  if (CONTINUATION_OPENER.test(text)) {
    return { dependent: true, reason: "continuation_opener" };
  }

  if (DANGLING_COMPARATIVE.test(text)) {
    return { dependent: true, reason: "dangling_comparative" };
  }

  if (RELATIVE_REFERENCE.test(text)) {
    return { dependent: true, reason: "relative_reference" };
  }

  const own = contentWords(text);

  // a pronoun is only a dependency if the question has no subject of its own.
  // "what does the research say about his serve" needs the previous turn.
  // "does hulin's acute:chronic ratio apply to their junior squad" does not --
  // it names its own subject, and rewriting it risks replacing that subject.
  if (COREFERENCE.test(text) && own.size <= 2) {
    return { dependent: true, reason: "coreference_without_subject" };
  }

  // too short to carry a subject at all. "and clay?" is two words, one of
  // which is a conjunction.
  if (own.size <= 1) {
    return { dependent: true, reason: "no_subject_of_its_own" };
  }

  return { dependent: false, reason: "standalone" };
}

/**
 * has the user changed the subject?
 *
 * checked even when the question looks dependent, because the two signals
 * disagree more often than you would expect: "and what does the research say
 * about sleep?" opens like a continuation and is a completely new topic.
 *
 * the test is overlap of content words with the recent turns. no overlap and a
 * subject of its own means a new topic, so the history is dropped.
 */
export function isTopicShift(question, history = []) {
  const own = contentWords(question);

  if (own.size === 0) return false;

  const recent = new Set();

  for (const turn of history) {
    for (const word of contentWords(turn.question)) recent.add(word);
  }

  if (recent.size === 0) return false;

  let shared = 0;
  for (const word of own) if (recent.has(word)) shared += 1;

  if (shared > 0) return false;

  // sharing no words is not enough on its own, and getting this wrong breaks
  // the most common follow-up there is. "what about hard court?" shares nothing
  // with "how many matches were played on clay in 2025?" precisely BECAUSE it
  // is a substitution -- the user replaced the one word that changed and left
  // the rest implied. treating that as a new topic refuses to rewrite exactly
  // the case the feature exists for.
  //
  // so the question also has to be able to stand on its own before a lack of
  // overlap means anything. a fragment of two content words cannot; a complete
  // question with its own verb and object can.
  //
  //   "what about hard court?"                    2 words  -> fragment, substitution
  //   "and what does the research say about       4 words  -> complete, new topic
  //    sleep and recovery?"
  //
  // which is what separates a genuine change of subject from a follow-up that
  // merely opens with "and".
  const SELF_SUFFICIENT = 3;

  return own.size >= SELF_SUFFICIENT;
}

const SYSTEM_PROMPT = `You rewrite a follow-up question so that it can be understood on its own, without the conversation.

You are given the previous turns (what the user asked AND how the assistant answered) and the new question. Replace pronouns and fill in whatever the new question left out, using only what the previous turns say.

Some follow-ups refer to something the ASSISTANT said, not the user -- "yep can you do that" after the assistant offered to look something up means the new question IS that thing the assistant offered, not a repeat of the user's original question. Read the assistant's answer, not just the user's question, to find what a bare acknowledgement ("yes", "please do", "go ahead") is agreeing to.

Rules:
- Change as little as possible. Keep the user's own wording wherever it already works.
- Keep the NEW question's subject. If the new question names something, that thing is what is being asked about -- never replace it with the earlier subject.
- Never answer the question, and never add any fact that is not in the previous turns.
- If the new question already makes sense on its own, repeat it back unchanged.
- Reply with the rewritten question only. No explanation, no quotes, no preamble.`;

function buildUserPrompt(question, history) {
  const turns = history
    .map(
      (turn, index) =>
        `Turn ${index + 1}\nUser asked: ${turn.question}\nAssistant answered: ${turn.answer ?? ""}`,
    )
    .join("\n\n");

  return `${turns}\n\nNew question: ${question}\n\nRewritten question:`;
}

/**
 * strips the things a small model adds even when told not to: surrounding
 * quotes, a "Rewritten question:" echo, a trailing explanation on its own line.
 */
function cleanModelOutput(raw) {
  let text = String(raw ?? "").trim();

  text = text.replace(/^rewritten question:\s*/i, "");
  text = text.split(/\n/)[0].trim();
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();

  return text;
}

/**
 * would this rewrite lose the user's subject?
 *
 * the failure this catches: the model latches onto the earlier turn and returns
 * a rewording of THAT question, discarding what was just asked. the answer then
 * looks perfect and addresses the wrong thing.
 *
 * the rule is mechanical -- every content word the follow-up brought must
 * survive into the rewrite. a rewrite that drops one is rejected and the
 * original question is used instead.
 */
export function preservesSubject(question, rewritten) {
  const asked = contentWords(question);
  const produced = contentWords(rewritten);

  for (const word of asked) {
    if (!produced.has(word)) return false;
  }

  return true;
}

/**
 * rewrites a follow-up into a standalone question.
 *
 * always returns a usable question. on any failure -- model unreachable, empty
 * output, a rewrite that dropped the subject -- it returns the original and
 * says why. a broken rewriter must degrade to "no conversation memory", never
 * to "no answer".
 *
 * the shape it returns is deliberately verbose because the ticket requires the
 * rewrite to be visible to the user and separable in telemetry: both failure
 * modes have to be countable on their own.
 */
export async function rewriteFollowUp(question, history = [], { signal = null } = {}) {
  const original = String(question ?? "").trim();

  const unchanged = (reason) => ({
    question: original,
    original,
    rewritten: false,
    applied: false,
    reason,
    turnsUsed: 0,
  });

  if (!retrievalConfig.conversation?.rewriteEnabled) return unchanged("disabled");
  if (!original) return unchanged("empty");
  if (!Array.isArray(history) || history.length === 0) return unchanged("no_history");

  // only the last few turns. the whole conversation is never pasted in: it
  // costs tokens linearly, and an old turn is far more likely to pull the
  // rewrite off course than to help it.
  const window = history.slice(-retrievalConfig.conversation.maxTurns);

  const dependency = dependsOnHistory(original, window);

  // the cheap path, and the common one. a question that stands on its own is
  // returned as it came in, with no model call and no added latency.
  if (!dependency.dependent) return unchanged(dependency.reason);

  if (isTopicShift(original, window)) {
    return unchanged("topic_shift");
  }

  try {
    const response = await fetch(`${retrievalConfig.generation.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: retrievalConfig.conversation.rewriteModel,
        stream: false,
        // no reasoning block. this asks for one rewritten sentence, and a
        // <think> block would be parsed as the rewrite.
        think: false,
        // no json schema here on purpose. the output is one sentence, and a
        // schema around a single string buys nothing while measurably costing
        // accuracy on a small model -- it spends decoding capacity on the
        // wrapper rather than the task.
        options: { temperature: 0, num_predict: 120 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(original, window) },
        ],
      }),
      signal,
    });

    if (!response.ok) return unchanged("model_unavailable");

    const payload = await response.json();
    const candidate = cleanModelOutput(payload.message?.content);

    if (!candidate || candidate.length < 8) return unchanged("empty_rewrite");

    // a rewrite far longer than the turns that produced it is the model
    // starting to answer rather than rewrite.
    if (candidate.length > original.length + 400) return unchanged("rewrite_too_long");

    if (!preservesSubject(original, candidate)) return unchanged("subject_lost");

    if (candidate.toLowerCase() === original.toLowerCase()) {
      return unchanged("model_returned_unchanged");
    }

    return {
      question: candidate,
      original,
      rewritten: true,
      applied: true,
      reason: dependency.reason,
      turnsUsed: window.length,
    };
  } catch {
    return unchanged("model_error");
  }
}
