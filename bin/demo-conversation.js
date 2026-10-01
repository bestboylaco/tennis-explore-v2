#!/usr/bin/env node
//
// a scripted multi-turn conversation, run against the real index and the real
// model, printing what the session memory did at every turn.
//
//   npm run demo:conversation
//   npm run demo:conversation -- --scenario structured
//   npm run demo:conversation -- --scenario research
//   npm run demo:conversation -- --scenario topic-shift
//   npm run demo:conversation -- --scenario video
//   npm run demo:conversation -- --ask "your own question" --ask "and a follow-up?"
//
// each turn prints the question as typed, the question actually searched for,
// and why it was or was not rewritten. the point of the demo is the gap between
// those first two lines: that gap IS the conversation memory.

import { randomUUID } from "node:crypto";

import { answerQuestion } from "../src/modules/chat/services/answer.service.js";
import { appendTurn, getTurns, resetAllSessions } from "../src/modules/chat/services/conversation.service.js";
import { retrievalConfig } from "../src/config/retrieval.config.js";

const C = {
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  cyan: (s) => `[36m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
};

/*
 * Scenarios are written so each one demonstrates a different behaviour, and
 * every one contains at least one turn that must NOT be rewritten. A demo that
 * only shows successful rewrites proves nothing about the failure that matters.
 */
const SCENARIOS = {
  research: {
    title: "Research thread — coreference and ellipsis across turns",
    turns: [
      {
        ask: "What does the research say about the acute to chronic workload ratio and injury risk?",
        expect: "standalone — the opening question of a session is never rewritten",
      },
      {
        ask: "What about in tennis specifically?",
        expect: "ellipsis — the verb and object are missing and come from turn 1",
      },
      {
        ask: "Who wrote that study?",
        expect: "relative reference — 'that study' only means something given turn 2",
      },
      {
        ask: "How much strength does a player lose after a three hour match?",
        expect: "topic shift — a complete question about something else, left alone",
      },
    ],
  },

  structured: {
    title: "Match data thread — substitution follow-ups over the same table",
    turns: [
      {
        ask: "How many matches were played on each surface in 2025?",
        expect: "standalone — opening question",
      },
      {
        ask: "What about indoor versus outdoor?",
        expect: "ellipsis — 'how many matches were played' is implied",
      },
      {
        ask: "And the win rate for those?",
        expect: "continuation — 'and' plus a pronoun with no subject of its own",
      },
    ],
  },

  "topic-shift": {
    title: "Topic shift — the failure that matters, shown deliberately",
    turns: [
      {
        ask: "How many matches were played on clay in 2025?",
        expect: "standalone — opening question",
      },
      {
        ask: "What about hard court?",
        expect: "ellipsis — correctly rewritten, this is the feature working",
      },
      {
        ask: "And what does the research say about sleep and athlete recovery?",
        expect: "TOPIC SHIFT — opens with 'and' but is a new subject. Must NOT inherit clay.",
      },
      {
        ask: "What does the research say about clay court movement?",
        expect: "standalone — mentions clay, but stands on its own. Must NOT be rewritten.",
      },
    ],
  },

  video: {
    title: "Conference video thread — following up on a named speaker",
    turns: [
      {
        ask: "What does Allistair McCaw say makes a great coach?",
        expect: "standalone — opening question",
      },
      {
        ask: "What else does he cover in that talk?",
        expect: "coreference — 'he' and 'that talk' both come from turn 1",
      },
      {
        ask: "Do any other speakers make the same point?",
        expect: "relative reference — 'the same point' depends on the answer above",
      },
    ],
  },
};

function parseArgs(argv) {
  const args = { scenario: "topic-shift", role: "admin", asks: [], full: false };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--scenario") args.scenario = argv[i + 1];
    if (argv[i] === "--role") args.role = argv[i + 1];
    if (argv[i] === "--ask") args.asks.push(argv[i + 1]);
    if (argv[i] === "--full") args.full = true;
    if (argv[i] === "--list") args.list = true;
  }

  return args;
}

function rule(char = "─") {
  return char.repeat(78);
}

function describeReason(reason) {
  return {
    no_history: "first question of the session",
    standalone: "stands on its own",
    topic_shift: "new subject — history deliberately dropped",
    continuation_opener: "opens as a continuation",
    dangling_comparative: "'what about' with nothing to compare against",
    relative_reference: "refers to something already said",
    coreference_without_subject: "pronoun with no subject of its own",
    no_subject_of_its_own: "too short to carry a subject",
    subject_lost: "REJECTED — the rewrite dropped what was just asked",
    rewrite_too_long: "REJECTED — the model started answering instead of rewriting",
    model_unavailable: "model unreachable — degraded to no memory",
    model_error: "model call failed — degraded to no memory",
    empty_rewrite: "model returned nothing usable",
    model_returned_unchanged: "model returned the question unchanged",
    disabled: "rewriting is switched off in config",
  }[reason] ?? reason;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log("\nScenarios:\n");
    for (const [key, s] of Object.entries(SCENARIOS)) {
      console.log(`  ${key.padEnd(14)} ${s.title}`);
    }
    console.log();
    return;
  }

  const scenario = args.asks.length
    ? { title: "Custom conversation", turns: args.asks.map((ask) => ({ ask, expect: "" })) }
    : SCENARIOS[args.scenario];

  if (!scenario) {
    console.error(`Unknown scenario "${args.scenario}". Try --list.`);
    process.exitCode = 1;
    return;
  }

  // one session id per run, which is what makes the turns a conversation rather
  // than four unrelated questions.
  const sessionId = `demo:${randomUUID()}`;

  resetAllSessions();

  console.log(`\n${rule("═")}`);
  console.log(C.bold(`  ${scenario.title}`));
  console.log(rule("═"));
  console.log(C.dim(`  role: ${args.role}   rewriting: ${retrievalConfig.conversation.rewriteEnabled ? "on" : "OFF"}   window: last ${retrievalConfig.conversation.maxTurns} turns`));

  const summary = [];

  for (const [index, turn] of scenario.turns.entries()) {
    const history = getTurns(sessionId);

    console.log(`\n${rule()}`);
    console.log(`${C.bold(`TURN ${index + 1}`)}  ${C.dim(`(${history.length} previous turn${history.length === 1 ? "" : "s"} in memory)`)}`);
    console.log(rule());

    console.log(`\n  ${C.cyan("user typed")}   ${C.bold(turn.ask)}`);

    if (turn.expect) console.log(`  ${C.dim(`expected      ${turn.expect}`)}`);

    const startedAt = Date.now();

    let result;

    try {
      result = await answerQuestion(turn.ask, { roleId: args.role, history });
    } catch (error) {
      console.log(`\n  ${C.red("failed")}  ${error.message}`);
      break;
    }

    const took = ((Date.now() - startedAt) / 1000).toFixed(1);
    const conv = result.conversation ?? {};

    if (conv.rewritten) {
      console.log(`  ${C.green("searched as")}  ${C.green(C.bold(conv.searchedAs))}`);
      console.log(`  ${C.dim(`why           rewritten — ${describeReason(conv.reason)}`)}`);
      console.log(`  ${C.dim(`              used ${conv.turnsUsed} previous turn${conv.turnsUsed === 1 ? "" : "s"}`)}`);
    } else {
      console.log(`  ${C.yellow("searched as")}  ${C.dim("(unchanged)")}`);
      console.log(`  ${C.dim(`why           not rewritten — ${describeReason(conv.reason)}`)}`);
    }

    const answer = String(result.answer ?? "").trim();
    const shown = args.full ? answer : answer.slice(0, 420) + (answer.length > 420 ? "…" : "");

    console.log(`\n  ${C.bold("answer")}        ${result.answered ? C.green("answered") : C.yellow("abstained")}  ${C.dim(`· ${result.citations?.length ?? 0} citations · ${took}s · route ${result.route}`)}`);
    console.log();

    for (const line of shown.split("\n")) console.log(`    ${line}`);

    if (result.citations?.length) {
      console.log(`\n  ${C.dim("sources")}`);
      for (const citation of result.citations.slice(0, 4)) {
        const label = citation.link?.label ?? citation.title ?? "source";
        console.log(`    ${C.dim(`[${citation.number}] ${label}`)}`);
      }
    }

    appendTurn(sessionId, { question: turn.ask, answer });

    summary.push({
      turn: index + 1,
      askedAs: turn.ask,
      rewritten: Boolean(conv.rewritten),
      reason: conv.reason,
      answered: Boolean(result.answered),
      seconds: Number(took),
    });
  }

  console.log(`\n${rule("═")}`);
  console.log(C.bold("  SESSION SUMMARY"));
  console.log(rule("═"));
  console.log();
  console.log(`  ${"turn".padEnd(6)}${"rewritten".padEnd(12)}${"reason".padEnd(32)}${"answered".padEnd(10)}time`);
  console.log(`  ${rule("-").slice(0, 74)}`);

  for (const row of summary) {
    console.log(
      `  ${String(row.turn).padEnd(6)}${(row.rewritten ? "yes" : "no").padEnd(12)}${String(row.reason).padEnd(32)}${(row.answered ? "yes" : "abstained").padEnd(10)}${row.seconds}s`,
    );
  }

  const rewritten = summary.filter((r) => r.rewritten).length;

  console.log();
  console.log(`  ${rewritten} of ${summary.length} turns were rewritten.`);
  console.log(C.dim("  A turn left alone is not a failure — the default is to leave a question"));
  console.log(C.dim("  untouched unless it demonstrably depends on the conversation."));
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
