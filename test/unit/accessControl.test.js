// the tests that matter most in this repo.
//
// a retrieval bug returns a worse answer. an access control bug returns someone
// else's medical data, and it does it silently, wrapped in a fluent paragraph
// that looks exactly like a correct answer. so these are written as "prove the
// wrong person is refused", not "prove the right person is allowed" -- the
// second passes even when the filter is missing entirely.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  grantsForDocument,
  grantsForRole,
  isPermitted,
  ROLE_IDS,
} from "../../src/shared/constants/accessControl.js";
import { assertAccessInvariant, buildAccessFilter } from "../../src/modules/retrieval/accessControl.service.js";

const physioChunk = {
  chunk_id: "wearables#0001",
  acl_groups: grantsForDocument({
    domain: "physiological",
    sensitivity: "confidential",
    program: "national-academy",
  }),
};

const publicResearch = {
  chunk_id: "paper#0001",
  acl_groups: grantsForDocument({ domain: "research", sensitivity: "public", program: "*" }),
};

describe("access control", () => {
  it("denies the analyst physiological data", () => {
    // this is the contrast case the whole model is built around. the analyst
    // exists in the role list specifically so there is someone the filter must
    // say no to.
    assert.equal(isPermitted(physioChunk.acl_groups, grantsForRole("analyst")), false);
  });

  it("allows the academy coach the same chunk", () => {
    assert.equal(isPermitted(physioChunk.acl_groups, grantsForRole("academy_coach")), true);
  });

  it("denies the tour coach another program's data", () => {
    // same permissions as the academy coach, different athletes. this proves the
    // program axis does something, rather than sensitivity doing all the work.
    assert.equal(isPermitted(physioChunk.acl_groups, grantsForRole("tour_coach")), false);
  });

  it("gives every role access to public research", () => {
    for (const roleId of ROLE_IDS) {
      assert.equal(
        isPermitted(publicResearch.acl_groups, grantsForRole(roleId)),
        true,
        `role ${roleId} should be able to read published research`,
      );
    }
  });

  it("treats a chunk with no acl_groups as unreachable, not public", () => {
    // fail closed. if ingestion drops the field, the chunk disappears rather
    // than becoming visible to everyone.
    assert.equal(isPermitted([], grantsForRole("admin")), false);
    assert.equal(isPermitted(undefined, grantsForRole("admin")), false);
  });

  it("refuses to resolve an unknown role instead of defaulting", () => {
    assert.throws(() => grantsForRole("ceo"), /unknown role/);
  });

  it("refuses to classify a document with an invented sensitivity", () => {
    assert.throws(
      () => grantsForDocument({ domain: "research", sensitivity: "secret", program: "*" }),
      /unknown sensitivity/,
    );
  });

  it("respects the sensitivity ceiling", () => {
    const restricted = grantsForDocument({
      domain: "clinical",
      sensitivity: "restricted",
      program: "*",
    });

    assert.equal(isPermitted(restricted, grantsForRole("physiotherapist")), true);
    assert.equal(isPermitted(restricted, grantsForRole("academy_coach")), false);
  });
});

describe("the defensive invariant", () => {
  it("throws when a forbidden chunk reaches fusion", () => {
    // this is the check that catches a future refactor dropping the pre-filter.
    // it should never fire in normal operation, which is exactly why it needs a
    // test -- an assertion nobody has ever seen fail is an assertion nobody
    // knows works.
    const filter = buildAccessFilter("analyst");

    assert.throws(
      () => assertAccessInvariant([physioChunk], filter),
      /access invariant violated/,
    );
  });

  it("passes clean when everything is permitted", () => {
    const filter = buildAccessFilter("analyst");

    assert.doesNotThrow(() => assertAccessInvariant([publicResearch], filter));
  });
});
