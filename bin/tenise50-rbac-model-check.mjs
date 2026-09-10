#!/usr/bin/env node
// TENISE-50 (E5-25) acceptance check: the confirmed role-to-data-classification
// matrix in docs/rbac-roles-and-permissions.md is a description of what
// src/shared/constants/accessControl.js already enforces. This script is the
// guard that keeps that true -- it recomputes each role's actual grants from
// the live ROLES export and diffs them against the matrix as documented and
// confirmed, so a silent edit to accessControl.js (a domain added, a
// sensitivity ceiling loosened, a program removed) fails a fast, no-Ollama,
// no-Mongo check instead of only being noticed the next time someone reads
// the doc side by side with the code.
//
// run with `npm run test:rbac-roles`.

import {
  ROLES,
  ROLE_IDS,
  DOMAINS,
  SENSITIVITY_ORDER,
  PROGRAMS,
} from "../src/shared/constants/accessControl.js";

// mirrors docs/rbac-roles-and-permissions.md §2 exactly. any change here
// must be a deliberate, documented policy change, not a drive-by code edit.
const EXPECTED = {
  academy_coach: {
    domains: ["performance", "physiological", "research"],
    maxSensitivity: "confidential",
    programs: ["national-academy"],
  },
  tour_coach: {
    domains: ["performance", "physiological", "research"],
    maxSensitivity: "confidential",
    programs: ["pro-tour"],
  },
  analyst: {
    domains: ["performance", "research"],
    maxSensitivity: "internal",
    programs: [],
  },
  strength_conditioning: {
    domains: ["performance", "physiological", "research"],
    maxSensitivity: "confidential",
    programs: [],
  },
  physiotherapist: {
    domains: ["physiological", "clinical", "performance", "research"],
    maxSensitivity: "restricted",
    programs: [],
  },
  member_services: {
    domains: ["personal", "administrative", "research"],
    maxSensitivity: "confidential",
    programs: [],
  },
  athlete: {
    domains: ["performance", "physiological", "research"],
    maxSensitivity: "internal",
    programs: [],
  },
  admin: {
    domains: [...DOMAINS],
    maxSensitivity: "restricted",
    programs: [],
  },
};

const EXPECTED_ROLE_IDS = Object.keys(EXPECTED).sort();
const EXPECTED_DOMAINS = [
  "performance",
  "physiological",
  "clinical",
  "personal",
  "research",
  "administrative",
];
const EXPECTED_SENSITIVITY_ORDER = ["public", "internal", "confidential", "restricted"];
const EXPECTED_PROGRAMS = ["national-academy", "pro-tour", "junior-development", "wheelchair-program"];

function sameSet(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((v) => setB.has(v));
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function main() {
  const failures = [];

  // axis 0: the role roster itself.
  if (!sameSet(ROLE_IDS, EXPECTED_ROLE_IDS)) {
    failures.push(
      `role roster drifted: code has [${ROLE_IDS.join(", ")}], doc says [${EXPECTED_ROLE_IDS.join(", ")}]`,
    );
  }

  // axis 1: what a domain even means, and its ordering (sensitivity is
  // ordinal -- a reordering silently changes every ceiling calculation).
  if (!sameSet(DOMAINS, EXPECTED_DOMAINS)) {
    failures.push(`DOMAINS drifted: code has [${DOMAINS.join(", ")}]`);
  }
  if (!sameOrder(SENSITIVITY_ORDER, EXPECTED_SENSITIVITY_ORDER)) {
    failures.push(`SENSITIVITY_ORDER drifted: code has [${SENSITIVITY_ORDER.join(", ")}]`);
  }
  if (!sameSet(PROGRAMS, EXPECTED_PROGRAMS)) {
    failures.push(`PROGRAMS drifted: code has [${PROGRAMS.join(", ")}]`);
  }

  // axis 2: per-role domains / ceiling / program scope, exactly as confirmed.
  for (const roleId of EXPECTED_ROLE_IDS) {
    const role = ROLES[roleId];
    const expected = EXPECTED[roleId];

    if (!role) {
      failures.push(`role "${roleId}" is documented as confirmed but no longer exists in code`);
      continue;
    }

    if (!sameSet(role.domains, expected.domains)) {
      failures.push(
        `${roleId}: domains drifted -- code [${role.domains.join(", ")}], expected [${expected.domains.join(", ")}]`,
      );
    }

    if (role.maxSensitivity !== expected.maxSensitivity) {
      failures.push(
        `${roleId}: maxSensitivity drifted -- code "${role.maxSensitivity}", expected "${expected.maxSensitivity}"`,
      );
    }

    if (!sameSet(role.programs, expected.programs)) {
      failures.push(
        `${roleId}: programs drifted -- code [${role.programs.join(", ")}], expected [${expected.programs.join(", ")}]`,
      );
    }
  }

  console.log("TENISE-50 role model check\n");

  for (const roleId of EXPECTED_ROLE_IDS) {
    const role = ROLES[roleId];
    if (!role) continue;
    console.log(
      `  ${roleId.padEnd(22)} domains=[${role.domains.join(",")}] ceiling=${role.maxSensitivity} programs=[${role.programs.join(",") || "all"}]`,
    );
  }

  console.log();

  if (failures.length > 0) {
    console.log(`FAIL (${failures.length} drift${failures.length === 1 ? "" : "s"} from the confirmed matrix):`);
    for (const failure of failures) console.log(`  - ${failure}`);
    console.log(
      "\nIf this drift is a deliberate, approved policy change, update docs/rbac-roles-and-permissions.md" +
        " and this script's EXPECTED table together -- they must never disagree silently.",
    );
    process.exitCode = 1;
  } else {
    console.log(`PASS -- all ${EXPECTED_ROLE_IDS.length} roles match the confirmed matrix exactly.`);
  }
}

main();
