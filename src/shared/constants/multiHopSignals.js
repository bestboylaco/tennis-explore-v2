// phrasing that means a question needs more than one retrieval pass joined
// together -- shared between queryPlanner.service.js (which uses it to decide
// whether the rules can be confident alone, or the model needs to be asked to
// extract the actual sub-questions) and queryAnalyzer.service.js (which uses
// it as a fallback decomposition trigger, only when the planner did not
// already supply sub-questions -- see retrieval.service.js).
//
// used to be two separately maintained lists that had drifted apart: one had
// the two-question-marks and "each of" patterns, the other had
// compare/versus/difference-between. neither omission was intentional, so
// this is their union, in one place.
export const MULTI_HOP_SIGNALS = Object.freeze([
  /\band (also|then)\b/i,
  /\bhow (do|does) .+ (relate|compare|differ)/i,
  /\b(both|each of)\b/i,
  /\?.*\?/, // two question marks means two questions
  /\bcompare\b/i,
  /\bversus\b|\bvs\.?\b/i,
  /\bdifference between\b/i,
]);
