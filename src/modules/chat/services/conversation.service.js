// remembers the turns of one conversation, and nothing else.
//
// scope
// -----
// session only. this is not long-term memory: close the browser, or restart the
// server, and it is gone. that is the intended behaviour, not a limitation --
// the partner's information security position is that athlete questions do not
// accumulate anywhere, and an in-memory store that dies with the process is the
// easiest version of that promise to keep.
//
// it is also NOT the agent state used inside the AI Action loop. that is memory
// within answering one question, across tool steps. this is memory across user
// turns. they are solved differently and conflating them causes arguments.
//
// what is stored
// --------------
// the question, a short excerpt of the answer, and when. deliberately not the
// evidence, the citations or the retrieved chunks: the rewriter only ever reads
// the questions, and storing retrieved content would mean athlete material
// sitting in a process's heap for the life of a session.

const MAX_TURNS_KEPT = 12;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // matches the auth session lifetime
const MAX_SESSIONS = 500;
const ANSWER_EXCERPT_CHARS = 400;

const sessions = new Map();

function now() {
  return Date.now();
}

/**
 * drops sessions nobody has touched for longer than the ttl.
 *
 * called on write rather than on a timer: a timer keeps the process alive and
 * has to be cleaned up in tests, and this map only grows when someone is
 * actually asking questions.
 */
function evictStale() {
  const cutoff = now() - SESSION_TTL_MS;

  for (const [id, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(id);
  }

  // a hard ceiling as well as a ttl. the ttl alone does not bound memory if
  // many sessions are created inside one ttl window.
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()]
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      .slice(0, sessions.size - MAX_SESSIONS);

    for (const [id] of oldest) sessions.delete(id);
  }
}

/**
 * the turns of a conversation, oldest first. an unknown session is an empty
 * conversation rather than an error -- the first question of a session has no
 * history by definition, and that is the normal case, not a failure.
 */
export function getTurns(sessionId) {
  if (!sessionId) return [];

  const session = sessions.get(sessionId);

  if (!session) return [];

  if (session.updatedAt < now() - SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return [];
  }

  return session.turns;
}

/**
 * records one completed exchange.
 *
 * the answer is truncated, and truncated from the FRONT (kept: the tail) --
 * the rewriter reads it to resolve a bare "yes, do that" against whatever the
 * assistant last offered, and that offer is almost always the closing
 * sentence of a longer answer (e.g. the PARTIAL-evidence "let me know if
 * you'd like me to look for X" nudge). truncating from the back discarded
 * exactly the sentence a follow-up is most likely to be agreeing to
 * (observed live, 2026-09-17: "yep can you do that" had nothing to resolve
 * against once the offer fell outside the kept prefix).
 */
export function appendTurn(sessionId, { question, answer = "" } = {}) {
  if (!sessionId || typeof question !== "string" || question.trim() === "") return;

  const session = sessions.get(sessionId) ?? { turns: [], updatedAt: now() };

  session.turns.push({
    question: question.trim(),
    answer: String(answer ?? "").slice(-ANSWER_EXCERPT_CHARS),
    at: new Date().toISOString(),
  });

  // keep only the tail. an old turn is more likely to mislead a rewrite than
  // to inform it, and the rewriter reads a smaller window than this anyway.
  if (session.turns.length > MAX_TURNS_KEPT) {
    session.turns = session.turns.slice(-MAX_TURNS_KEPT);
  }

  session.updatedAt = now();
  sessions.set(sessionId, session);

  evictStale();
}

/**
 * forgets one conversation. what "new chat" should call, and what a user asking
 * to be forgotten is entitled to.
 */
export function clearSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * test and diagnostic helper. not wired to any route -- session contents are
 * not something an http caller should be able to enumerate.
 */
export function sessionStats() {
  return {
    sessions: sessions.size,
    turns: [...sessions.values()].reduce((total, s) => total + s.turns.length, 0),
  };
}

export function resetAllSessions() {
  sessions.clear();
}
