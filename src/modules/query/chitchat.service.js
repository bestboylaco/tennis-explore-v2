// detects greetings and pleasantries, and answers them without touching
// retrieval.
//
// "hello" running the full plan -> retrieve -> grade -> generate pipeline was
// real, measured waste: several model calls for a question with nothing
// retrievable in it at all. rule-based for the same reason
// chat/services/routing.service.js's classifyQuery is rule-based -- paying for
// a classifier call to decide whether to skip the pipeline defeats the point
// of skipping it.
//
// deliberately narrow, both in what it matches and in how long a message it
// will even consider. a false positive here (a real question misread as
// chitchat) skips retrieval entirely and returns a canned non-answer, which is
// a much worse failure than the reverse -- a greeting that goes through the
// full pipeline still gets a reasonable reply, just an expensive one. so this
// only fires on short text that is ENTIRELY a greeting/thanks/pleasantry, not
// on a real question that happens to open with one ("hi, what was serve speed
// at the 2023 final" must fall through untouched).

const MAX_CHITCHAT_LENGTH = 40;

const PATTERNS = Object.freeze([
  { kind: "greeting", pattern: /^(hi|hello|hey|hiya|yo|good\s?(morning|afternoon|evening))[\s!.,]*$/i },
  { kind: "thanks", pattern: /^(thanks|thank\s?you|thanks a lot|cheers|ta|appreciated?)[\s!.,]*$/i },
  {
    kind: "howAreYou",
    pattern: /^(how('?s| is| are)( it going| things)?|how are you( doing)?|what'?s up|sup)[\s?!.,]*$/i,
  },
  { kind: "farewell", pattern: /^(bye|goodbye|see ya|see you|later|cya)[\s!.,]*$/i },
  { kind: "smalltalk", pattern: /^(ok(ay)?|cool|nice|great|got it|sounds good|no worries)[\s!.,]*$/i },
]);

const REPLIES = Object.freeze({
  greeting:
    "Hi! I'm the tennis performance assistant -- ask me anything about the research, match data or coaching material in the knowledge base.",
  thanks: "You're welcome -- let me know if there's anything else you'd like to look into.",
  howAreYou: "Running well, thanks for asking. What can I help you find?",
  farewell: "See you next time.",
  smalltalk: "Good to know. What would you like to look into?",
});

/**
 * returns the kind of chitchat this is, or null if the question should go
 * through the real pipeline.
 */
export function detectChitchat(question) {
  const text = String(question ?? "").trim();

  if (text === "" || text.length > MAX_CHITCHAT_LENGTH) return null;

  const match = PATTERNS.find(({ pattern }) => pattern.test(text));

  return match?.kind ?? null;
}

export function chitchatReply(kind) {
  return REPLIES[kind] ?? REPLIES.smalltalk;
}
