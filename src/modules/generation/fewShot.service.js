// worked examples, shown to the model before the real question.
//
// few-shot prompting is the cheapest quality lever in the whole system: no
// training, no extra inference, just a couple of hundred tokens of prompt. what
// it buys is FORMAT and BEHAVIOUR, which are exactly the things a local 8b
// model gets wrong most often when only described in the system prompt:
// citation format, answer length, when to quote verbatim, and what a refusal
// (or a partial answer) actually looks like.
//
// the examples below are deliberately SYNTHETIC -- invented documents about
// invented findings. using real passages from the corpus would risk the model
// treating an example's content as retrieved fact and repeating it in a real
// answer, which is a genuinely nasty failure to debug.
//
// examples are picked by intent AND by route (isTableAnswer) -- since v2 of the
// taxonomy split those apart, the same intent needs a different demonstration
// depending on whether the evidence is prose or a computed table. two more
// keys sit outside the normal intent set: MULTI_PART (a fact_retrieval
// question needing more than one lookup joined together) and PARTIAL (the
// evidence only partly answers the question). the most important examples are
// the refusal and the partial answer -- a model that has never seen either
// will not produce one.

import { INTENTS } from "../../shared/constants/queryTaxonomy.js";

// the evidence here is genuinely unrelated to the question -- not just thin
// or missing one detail. a refusal is only the right demonstration when
// nothing retrieved touches the subject at all; evidence that is merely
// adjacent (e.g. training load, when asked about tapering specifically)
// belongs in the PARTIAL example instead, because the new policy treats that
// as "answer what you have and name the gap", not "refuse".
const REFUSAL = {
  question: "What does Dr Halberd recommend for tapering before a grand slam?",
  evidence: "[1] (Court Surface Maintenance Manual, page 12)\nClay courts require watering twice daily to keep bounce consistent.\n\n[2] (Equipment Standards, page 4)\nRacquet string tension is typically restrung every 8-10 hours of play.",
  answer:
    "I don't have enough information in the knowledge base to answer this question directly. Nothing retrieved discusses tapering, training load, or a Dr Halberd -- this may not be something the available material covers, or it might be discussed in different terms. Try rephrasing, or ask about a related topic and I'll take another look.",
};

// demonstrates the three-part partial-evidence shape: what is known, what is
// missing (named specifically), then a brief offer to look further for the
// missing piece. shown regardless of intent, since evidenceIsPartial overrides
// the intent-specific instruction the same way for all of them.
const PARTIAL = {
  question: "How does tapering volume for a hard-court grand slam compare with a clay-court one?",
  evidence: "[1] (Training Load Review, page 3)\nWeekly training load should be reduced gradually across a mesocycle ahead of a hard-court major.\n\n[2] (Training Load Review, page 4)\nA typical taper runs two to three weeks, cutting volume by roughly 40% while keeping intensity high.",
  answer: "For a hard-court major, the taper runs two to three weeks and cuts volume by roughly 40% while keeping intensity high [1][2].\n\nThe evidence does not cover clay-court tapering specifically, so I can't compare the two directly.\n\nLet me know if you'd like me to look for clay-specific tapering guidance.",
};

const DOCUMENT_EXAMPLES = Object.freeze({
  [INTENTS.FACT_RETRIEVAL]: [
    {
      question: "How many players were recruited for the serve study?",
      evidence: "[1] (Serve Kinematics Study, page 2)\nTwenty-four junior players (12 male, 12 female) were recruited from the national pathway.\n\n[2] (Serve Kinematics Study, page 5)\nServe speed was recorded with a radar gun at 2 m behind the baseline.",
      answer: "Twenty-four junior players were recruited, twelve male and twelve female [1].",
    },
    {
      // demonstrates EXTRACTIVE_SUFFIX's verbatim-quoting behaviour -- the
      // system prompt alone produces paraphrase about half the time; showing
      // it once fixes that.
      question: "What is the exact wording of the return-to-play criterion after a stress fracture?",
      evidence: "[1] (Return to Play Policy, page 2)\nAn athlete may resume full-intensity training only after \"eight consecutive weeks of pain-free load-bearing activity, confirmed by follow-up imaging.\"",
      answer: 'The policy states: "eight consecutive weeks of pain-free load-bearing activity, confirmed by follow-up imaging" [1].',
    },
    {
      // demonstrates the attribution-asymmetry rule: the passage fully
      // answers the question, but the citation carries no author. a good
      // answer says so plainly rather than inventing a name, dropping the
      // mention entirely, or refusing over a missing byline.
      question: "What does the injury surveillance report say about wrist injuries in juniors?",
      evidence: "[1] (Junior Injury Surveillance Report, page 6)\nWrist injuries accounted for 9% of all reported injuries in the under-16 cohort, most commonly linked to double-handed backhand technique.",
      answer: "The report attributes 9% of injuries in the under-16 cohort to the wrist, most commonly linked to double-handed backhand technique [1]. The source does not name an author for this report.",
    },
    REFUSAL,
    PARTIAL,
  ],

  FACT_RETRIEVAL_MULTI_PART: [
    {
      question: "How does the measured training load compare with what the programme recommends?",
      evidence: "[1] (Load Monitoring Paper, page 7)\nMean weekly accelerometer load during tournament weeks was 41% higher than in training weeks.\n\n[2] (Programme Guidelines, slide 12)\nWeekly load should not vary by more than 20% between blocks without a planned deload.",
      answer: "The measured tournament weeks ran 41% above training weeks [1], while the programme guidance sets a 20% ceiling on week-to-week variation without a planned deload [2]. The observed variation is therefore roughly double what the guidance allows.",
    },
    REFUSAL,
  ],

  [INTENTS.SUMMARISATION]: [
    {
      question: "Summarise what is known about recovery between matches.",
      evidence: "[1] (Consecutive Play Study, page 4)\nPerceptual fatigue remained elevated 24 hours after a three-set match.\n\n[2] (Consecutive Play Study, page 6)\nCounter-movement jump height did not return to baseline until 48 hours.\n\n[3] (Recovery Practices Deck, slide 8)\nCold water immersion is used routinely after evening matches.",
      answer: "**Physiological recovery outlasts the schedule.** Perceived fatigue is still elevated a day after a three-set match [1], and jump height does not return to baseline for two days [2] — so back-to-back match days begin before recovery is complete.\n\n**Practice partly reflects this.** Cold water immersion is used routinely after evening matches [3], though the evidence here does not establish whether it shortens the recovery window.",
    },
    PARTIAL,
  ],

  [INTENTS.COMPARISON]: [
    {
      question: "How do the periodisation paper's findings compare with what the conditioning deck recommends?",
      evidence: "[1] (Periodisation in Junior Tennis, page 9)\nBlock periodisation produced greater gains in repeated-sprint ability than linear periodisation over a 12-week programme.\n\n[2] (Conditioning Deck 2025, slide 6)\nThe squad currently runs a linear periodisation model year-round.",
      answer: "The periodisation paper found block periodisation outperformed linear periodisation for repeated-sprint ability over 12 weeks [1]. The squad's current conditioning plan runs a linear model year-round [2] -- the opposite of what the paper's findings would favour. The evidence does not say why the linear model was chosen, so that gap is not addressed here.",
    },
    REFUSAL,
  ],
});

const TABLE_EXAMPLES = Object.freeze({
  [INTENTS.FACT_RETRIEVAL]: [
    {
      question: "What is the player's best ranking?",
      evidence: "| player | best_ranking |\n| --- | --- |\n| A. Example | 58 |\n\nRows scanned: 412. Rows matched: 1.",
      answer: "Their best ranking is 58 [1].",
    },
    {
      question: "How many matches were played on each surface?",
      evidence: "| surface | matches |\n| --- | --- |\n| Hard | 68 |\n| Clay | 15 |\n| Grass | 14 |\n\nRows scanned: 98. Rows matched: 97.",
      answer: "Hard courts account for most of the record at 68 matches, against 15 on clay and 14 on grass [1]. This is computed over 97 of 98 rows.",
    },
  ],

  [INTENTS.SUMMARISATION]: [
    {
      question: "Give me an overview of match results by surface.",
      evidence: "| surface | matches | wins | losses |\n| --- | --- | --- | --- |\n| Hard | 68 | 44 | 24 |\n| Clay | 15 | 6 | 9 |\n| Grass | 14 | 9 | 5 |\n\nRows scanned: 98. Rows matched: 97.",
      answer: "Most match play is on hard courts (68 of 97 matches), with a winning record there (44–24) [1]. The record is close to even on grass (9–5) and below .500 on clay (6–9), though both of those samples are much smaller.",
    },
  ],

  [INTENTS.COMPARISON]: [
    {
      question: "Compare wins on hard versus clay.",
      evidence: "| surface | wins | losses |\n| --- | --- | --- |\n| Hard | 44 | 24 |\n| Clay | 6 | 9 |\n\nRows scanned: 98. Rows matched: 83.",
      answer: "The record is markedly better on hard courts: 44 wins to 24 losses, against 6 wins to 9 losses on clay [1]. The clay sample is small — 15 matches — so the difference should be read with that in mind.",
    },
  ],
});

/**
 * builds the example turns for one intent.
 *
 * returned as alternating user/assistant messages rather than pasted into the
 * system prompt. models follow a demonstrated conversational pattern much more
 * reliably than a described one, and it keeps the system prompt readable.
 */
export function fewShotMessages(intent, { isTableAnswer = false, isMultiPart = false } = {}) {
  const table = isTableAnswer ? TABLE_EXAMPLES : DOCUMENT_EXAMPLES;

  const examples =
    (isMultiPart && !isTableAnswer ? table.FACT_RETRIEVAL_MULTI_PART : table[intent]) ??
    table[INTENTS.FACT_RETRIEVAL];

  return examples.flatMap((example) => [
    { role: "user", content: `Evidence:\n${example.evidence}\n\nQuestion: ${example.question}` },
    { role: "assistant", content: example.answer },
  ]);
}

export { DOCUMENT_EXAMPLES, TABLE_EXAMPLES };
