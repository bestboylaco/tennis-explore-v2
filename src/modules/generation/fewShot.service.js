// worked examples, shown to the model before the real question.
//
// few-shot prompting is the cheapest quality lever in the whole system: no
// training, no extra inference, just a couple of hundred tokens of prompt. what
// it buys is FORMAT and REFUSAL BEHAVIOUR, which are exactly the two things a
// local 8b model gets wrong most often.
//
// telling a model "cite every factual sentence" produces citations on about
// half of them. showing it two answers that do it produces near-perfect
// compliance, because the pattern is now demonstrated rather than described.
//
// the examples below are deliberately SYNTHETIC -- invented documents about
// invented findings. using real passages from the corpus would risk the model
// treating an example's content as retrieved fact and repeating it in a real
// answer, which is a genuinely nasty failure to debug.
//
// the most important examples are the refusals. a model that has never seen a
// refusal will not produce one.

import { INTENTS } from "../../shared/constants/queryTaxonomy.js";

const REFUSAL = {
  question: "What does Dr Halberd recommend for tapering before a grand slam?",
  evidence: "[1] (Training Load Review, page 3)\nWeekly training load should be reduced gradually across a mesocycle.\n\n[2] (Squad Notes, page 1)\nAthletes reported lower perceived exertion in the final week.",
  answer: "The knowledge base does not contain an answer to this question.",
};

const EXAMPLES = Object.freeze({
  [INTENTS.SINGLE_HOP]: [
    {
      question: "How many players were recruited for the serve study?",
      evidence: "[1] (Serve Kinematics Study, page 2)\nTwenty-four junior players (12 male, 12 female) were recruited from the national pathway.\n\n[2] (Serve Kinematics Study, page 5)\nServe speed was recorded with a radar gun at 2 m behind the baseline.",
      answer: "Twenty-four junior players were recruited, twelve male and twelve female [1].",
    },
    REFUSAL,
  ],

  [INTENTS.MULTI_HOP]: [
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
  ],

  [INTENTS.ANALYTICAL]: [
    {
      question: "What is the player's best ranking?",
      evidence: "| player | best_ranking |\n| --- | --- |\n| A. Example | 58 |\n\nRows scanned: 412. Rows matched: 1.",
      answer: "Their best ranking is 58 [1].",
    },
  ],

  [INTENTS.AGGREGATION]: [
    {
      question: "How many matches were played on each surface?",
      evidence: "| surface | matches |\n| --- | --- |\n| Hard | 68 |\n| Clay | 15 |\n| Grass | 14 |\n\nRows scanned: 98. Rows matched: 97.",
      answer: "Hard courts account for most of the record at 68 matches, against 15 on clay and 14 on grass [1]. This is computed over 97 of 98 rows.",
    },
  ],

  [INTENTS.COMPARATIVE]: [
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
export function fewShotMessages(intent) {
  const examples = EXAMPLES[intent] ?? EXAMPLES[INTENTS.SINGLE_HOP];

  return examples.flatMap((example) => [
    { role: "user", content: `Evidence:\n${example.evidence}\n\nQuestion: ${example.question}` },
    { role: "assistant", content: example.answer },
  ]);
}

export { EXAMPLES };
