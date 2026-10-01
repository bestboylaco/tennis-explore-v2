#!/usr/bin/env node
// TENISE-36 acceptance run: role x document access matrix, verified from
// access_audit_records (Mongo), not from the chat response -- per the
// ticket's own methodology, a document absent from the answer but present
// in the evidence set is a failure, and an "access denied"-sounding answer
// is not proof of anything on its own.
//
// Roles: tour_coach (ceiling confidential, scoped to pro-tour) and athlete
// (ceiling internal, all programs) -- same domains, so any leak can only
// come from the sensitivity or program axis, not the domain axis (which
// TENISE-50/Test A already covers).
//
// needs a live Ollama, a built index, and MONGODB_URI reachable (for the
// audit trail this script reads back). run with `npm run test:rbac-matrix`.

import fs from "node:fs";

import { connectMongoDB, disconnectMongoDB } from "../src/infrastructure/database/mongodb.service.js";
import { findAccessAuditRecords } from "../src/modules/audit/services/accessAuditStore.service.js";
import { submitChatQuestion } from "../src/modules/chat/services/chat.service.js";

const CASES = [
  {
    category: "coach-only",
    docId: "2018-paris-joao-sousa-pre-match-analysis",
    expectedAcl: "performance:confidential:pro-tour",
    questions: [
      "In the 2018 Paris pre-match scouting analysis, what was the score by which Sousa defeated Cecchinato in Round 1?",
      "According to the Sousa scouting presentation slides for the 2018 Paris match, what forehand and backhand return error counts are recorded against Sousa?",
    ],
  },
  {
    category: "coach-only",
    docId: "2018-us-open-joao-sousa-pre-match-analysis",
    expectedAcl: "performance:confidential:pro-tour",
    questions: [
      "What was the score of the 2018 US Open match where Sousa defeated Pouille, according to the Sousa scouting analysis?",
      "In that same Sousa scouting report, what percentage of Sousa's first serves went in during the 2018 US Open match against Pouille, and how many times was he broken?",
    ],
  },
  {
    category: "coach-only",
    docId: "novak-djokovic-match-intelligence-report-wimbledon-2019",
    expectedAcl: "performance:confidential:pro-tour",
    questions: [
      "According to the Djokovic Wimbledon 2019 match intelligence report slides, what percentage of points were 0-4 shot rallies?",
      "According to that Djokovic Wimbledon 2019 match intelligence report, what was his net points won ratio?",
    ],
  },
  {
    category: "athlete-visible",
    docId: "231211-service-provision-talent-athlete-services-murphy",
    expectedAcl: "physiological:internal:national-academy",
    questions: [
      "According to the National Academy athlete services document, how many times per year are Physical Competency Screens (PCS) obtained for NDS squad athletes?",
      "At what age do athletes get an in-person musculoskeletal screen according to that athlete services document, and how often is it done?",
    ],
  },
  {
    category: "athlete-visible",
    docId: "aisworkload",
    expectedAcl: "physiological:internal:national-academy",
    questions: [
      "According to the load monitoring and injury prevention presentation, what did the Hulin et al. BJSM 2013 study find about doubling weekly workload?",
      "In that same load monitoring presentation, what threshold of overs bowled in a first-class match was linked to significantly higher bowling injury rates in the AJSM 2009 study?",
    ],
  },
  {
    category: "athlete-visible",
    docId: "ams-admin-audit-mar25",
    expectedAcl: "physiological:internal:national-academy",
    questions: [
      "According to the March 2025 AMS Admin Site Audit presentation slides, which staff member's name appears next to the Massage Consult Form and Compliance Form data permissions?",
      "According to the March 2025 AMS Admin Site Audit presentation slides, which staff members' names appear next to the Catapult Data Permissions for Alex De Minaur?",
    ],
  },
];

const ROLES = ["tour_coach", "athlete"];

// the sensitivity/program direction that should be GRANTED for each role.
function expectedOutcome(roleId, category) {
  if (roleId === "tour_coach") return category === "coach-only" ? "granted" : "denied";
  if (roleId === "athlete") return category === "athlete-visible" ? "granted" : "denied";
  throw new Error(`no expectation defined for role "${roleId}"`);
}

async function runOne({ roleId, docId, expectedAcl, question, index }) {
  const correlationId = `rbac-matrix:${roleId}:${docId}:${index}`;
  const started = Date.now();

  const result = await submitChatQuestion(question, { roleId, correlationId });

  // the audit write is async best-effort (see accessAuditStore.service.js);
  // give it a moment to land before reading it back.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const records = await findAccessAuditRecords({ correlationId, limit: 10 });
  const docIdsShown = [...new Set(records.flatMap((r) => r.documents.map((d) => d.docId)))];
  const aclTagsShown = [
    ...new Set(records.flatMap((r) => r.documents.map((d) => `${d.dataDomain}:${d.sensitivity}:${d.program}`))),
  ];
  const targetDocShown = docIdsShown.includes(docId);

  return {
    roleId,
    docId,
    expectedAcl,
    question,
    correlationId,
    durationMs: Date.now() - started,
    auditOutcomes: records.map((r) => r.outcome),
    docIdsShown,
    aclTagsShown,
    targetDocShown,
  };
}

async function main() {
  console.log(`Starting TENISE-36 access matrix: ${ROLES.length} roles x ${CASES.length} documents x 2 questions = ${ROLES.length * CASES.length * 2} executions.`);
  console.log("Runs sequentially against the real pipeline (Ollama + Mongo audit trail) -- expect several minutes.\n");

  await connectMongoDB();

  const rows = [];

  for (const roleId of ROLES) {
    for (const testCase of CASES) {
      const expected = expectedOutcome(roleId, testCase.category);

      for (const [qIndex, question] of testCase.questions.entries()) {
        process.stdout.write(`[${roleId}] ${testCase.docId} Q${qIndex + 1}... `);

        const row = await runOne({
          roleId,
          docId: testCase.docId,
          expectedAcl: testCase.expectedAcl,
          question,
          index: qIndex,
        });

        // the pass condition is entirely about the audit log, per the ticket:
        // granted -> target doc must be in the evidence set; denied -> it
        // must never appear, no matter what the chat response text says.
        const pass =
          expected === "granted" ? row.targetDocShown : !row.targetDocShown;

        rows.push({ ...row, category: testCase.category, expected, pass });
        console.log(`${pass ? "PASS" : "FAIL"} (expected ${expected}, target doc shown: ${row.targetDocShown}) [${row.durationMs}ms]`);
      }
    }
  }

  await disconnectMongoDB();

  const denyRows = rows.filter((r) => r.expected === "denied");
  const grantRows = rows.filter((r) => r.expected === "granted");
  const leaks = denyRows.filter((r) => r.targetDocShown);
  const grantFailures = grantRows.filter((r) => !r.targetDocShown);

  const summary = {
    totalExecutions: rows.length,
    negativeDirection: {
      total: denyRows.length,
      leaks: leaks.length,
      passed: leaks.length === 0,
      note: "this is the security-critical property -- must be 0 leaks",
    },
    positiveDirection: {
      total: grantRows.length,
      undemonstrated: grantFailures.length,
      passed: grantFailures.length === 0,
      note: "a miss here can be a retrieval/routing gap, not necessarily an ACL bug -- inspect docIdsShown before concluding a defect",
    },
  };

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  if (leaks.length > 0) {
    console.log("\n*** LEAKS (restricted document appeared in evidence set for a role that should not see it) ***");
    for (const row of leaks) {
      console.log(`  ${row.roleId} saw ${row.docId} (expected denied) -- acl tags: ${row.aclTagsShown.join(", ")}`);
    }
  }

  if (grantFailures.length > 0) {
    console.log("\n--- positive-direction cells not demonstrated (inspect before treating as a defect) ---");
    for (const row of grantFailures) {
      console.log(`  ${row.roleId} / ${row.docId} / "${row.question.slice(0, 60)}..." -- docIdsShown: [${row.docIdsShown.join(", ") || "none"}]`);
    }
  }

  fs.mkdirSync("evidence", { recursive: true });
  fs.writeFileSync(
    "evidence/tenise36-access-matrix.json",
    JSON.stringify({ summary, rows }, null, 2),
  );

  console.log("\nFull results written to evidence/tenise36-access-matrix.json");
  process.exit(summary.negativeDirection.passed ? 0 : 1);
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exitCode = 1;
});
