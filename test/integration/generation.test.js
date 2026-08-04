import { test } from "node:test";
import assert from "node:assert/strict";

import { generateAnswer } from "../../src/modules/chat/services/generation.service.js";
import { chatConfig } from "../../src/modules/chat/chat.config.js";

// TENISE-19's two control tests, run against a real local Ollama model
// instead of Amazon Nova Pro (see the project's move away from AWS Bedrock).
//
// Skips cleanly if Ollama is not reachable -- this project's CI runner does
// not have it installed, and these tests need real inference time, so they
// are not run on every push (test/integration/README.md).

async function isOllamaReachable() {
  try {
    const response = await fetch(`${chatConfig.ollamaBaseUrl}/api/tags`);

    return response.ok;
  } catch {
    return false;
  }
}

const ollamaAvailable = await isOllamaReachable();
const skipReason = ollamaAvailable
  ? false
  : `Ollama is not reachable at ${chatConfig.ollamaBaseUrl}; skipping TENISE-19 control tests.`;

// Refusal phrasing the model is expected to use when it has no evidence.
// Heuristic, not exhaustive -- the acceptance criterion ultimately needs a
// human to read the five transcripts, which this test prints.
const REFUSAL_PATTERN =
  /cannot (answer|provide|determine)|can't (answer|provide|determine)|no evidence|not enough (evidence|information|data)|unable to answer|don't (have (enough|any) (evidence|information|data)|know)|no (data|information|context)( is)? (provided|available)|not been specified/i;

const EMPTY_EVIDENCE_QUESTIONS = [
  "What is the coached player's current first serve percentage?",
  "How many double faults did the player hit in their last match?",
  "Who is the top-ranked player on the roster this month?",
  "What was the player's break point save rate last week?",
  "How many aces did the player serve in their most recent session?",
];

// Each case pairs a well-known tennis fact with evidence that deliberately
// states a different value. The answer must reflect the supplied evidence,
// not the model's own (correct) knowledge -- that is what "grounded" means.
const CONTRADICTORY_EVIDENCE_CASES = [
  {
    question: "How many players compete on each side of a singles match at this club?",
    evidence: "At this club, singles matches are played with 3 players per side.",
    expected: "3",
  },
  {
    question: "What is the maximum number of sets in a match at this facility?",
    evidence: "Matches at this facility go to a maximum of 7 sets.",
    expected: "7",
  },
  {
    question: "How many games are needed to win a set at this facility?",
    evidence: "At this facility, a set is won once a player reaches 9 games.",
    expected: "9",
  },
  {
    question: "What colour is the tennis ball used in matches at this club?",
    evidence: "The balls used at this club are purple, per the equipment log.",
    expected: "purple",
  },
  {
    question: "How many minutes of warm-up are players given before a match at this club?",
    evidence: "Players at this club are given a 45-minute warm-up before each match.",
    expected: "45",
  },
];

test(
  "control test: 5 questions with evidence forced empty are all refused, not answered from parametric knowledge",
  { skip: skipReason, timeout: 120000 },
  async () => {
    const transcripts = [];

    for (const question of EMPTY_EVIDENCE_QUESTIONS) {
      const result = await generateAnswer({ question, evidence: [] });

      transcripts.push({ question, answer: result.answer });
    }

    console.log("\n--- TENISE-19 control test: empty evidence ---");
    for (const { question, answer } of transcripts) {
      console.log(`Q: ${question}\nA: ${answer}\n`);
    }

    for (const { question, answer } of transcripts) {
      assert.match(
        answer,
        REFUSAL_PATTERN,
        `expected a refusal for "${question}", got: ${answer}`,
      );
    }
  },
);

test(
  "control test: 5 questions with a deliberately incorrect fact in evidence are answered from that evidence",
  { skip: skipReason, timeout: 120000 },
  async () => {
    const transcripts = [];

    for (const { question, evidence, expected } of CONTRADICTORY_EVIDENCE_CASES) {
      const result = await generateAnswer({ question, evidence: [evidence] });

      transcripts.push({ question, evidence, expected, answer: result.answer });
    }

    console.log("\n--- TENISE-19 control test: contradictory evidence ---");
    for (const { question, answer } of transcripts) {
      console.log(`Q: ${question}\nA: ${answer}\n`);
    }

    for (const { question, expected, answer } of transcripts) {
      assert.match(
        answer,
        new RegExp(expected, "i"),
        `expected the answer to reflect the supplied evidence ("${expected}") for "${question}", got: ${answer}`,
      );
    }
  },
);
