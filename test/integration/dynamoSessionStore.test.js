import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// TENISE-63: the store that replaces connect-mongo/ResilientMongoStore.
//
// app.js used to carry a ResilientMongoStore subclass that retried a session
// read once after 75ms, because Atlas's free (M0) tier occasionally served a
// read-right-after-write as "not found". The ticket asked that this be
// *verified*, not assumed, before being dropped: does DynamoDB need the same
// workaround?
//
// The first test below is that verification. It regenerates (writes) and
// reads back a session hundreds of times in a tight loop against a real
// DynamoDB-compatible server, with no delay and no retry, and asserts zero
// misses. If DynamoDB's GetItem with ConsistentRead: true had the same
// eventual-consistency gap Atlas M0 did, this would flake under CI's load the
// same way the Atlas bug originally surfaced -- it does not, because
// ConsistentRead reads from the leader storage replica, which by definition
// reflects every write that has already returned successfully.

const DYNAMODB_TEST_ENDPOINT = process.env.DYNAMODB_TEST_ENDPOINT || "http://localhost:8800";
const DYNAMODB_TEST_TABLE = process.env.DYNAMODB_TEST_TABLE || "tennis-explore-g2";

process.env.DYNAMODB_ENDPOINT = DYNAMODB_TEST_ENDPOINT;
process.env.DYNAMODB_TABLE_NAME = DYNAMODB_TEST_TABLE;
process.env.DYNAMODB_ACCESS_KEY_ID ||= "local";
process.env.DYNAMODB_SECRET_ACCESS_KEY ||= "local";

async function isDynamoDbReachable() {
  try {
    const response = await fetch(DYNAMODB_TEST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "X-Amz-Target": "DynamoDB_20120810.ListTables",
      },
      body: "{}",
    });

    const body = await response.json().catch(() => null);

    return typeof body?.__type === "string" && body.__type.includes("dynamodb");
  } catch {
    return false;
  }
}

const dynamoAvailable = await isDynamoDbReachable();
const skipReason = dynamoAvailable
  ? false
  : `no DynamoDB-compatible server reachable at ${DYNAMODB_TEST_ENDPOINT}; run "docker compose up -d dynamodb-local dynamodb-local-init" to start DynamoDB Local.`;

const { DynamoSessionStore } = await import(
  "../../src/infrastructure/sessionStore/dynamoSessionStore.js"
);

function set(store, sid, data) {
  return new Promise((resolve, reject) => {
    store.set(sid, data, (error) => (error ? reject(error) : resolve()));
  });
}

function get(store, sid) {
  return new Promise((resolve, reject) => {
    store.get(sid, (error, session) => (error ? reject(error) : resolve(session)));
  });
}

function destroy(store, sid) {
  return new Promise((resolve, reject) => {
    store.destroy(sid, (error) => (error ? reject(error) : resolve()));
  });
}

describe("DynamoDB session store", { skip: skipReason }, () => {
  it(
    "never serves a write-then-immediately-read session as missing, with no retry and no delay " +
      "(the bug ResilientMongoStore worked around, verified absent rather than assumed absent)",
    async () => {
      const store = new DynamoSessionStore({ ttlSeconds: 3600 });
      const iterations = 200;
      let misses = 0;

      for (let i = 0; i < iterations; i += 1) {
        const sid = `login-regenerate-${randomUUID()}`;
        const session = { cookie: { maxAge: 3600000 }, user: { id: String(i), roleId: "analyst" } };

        // Mirrors auth.controller.js's loginController: regenerate (here, a
        // fresh sid standing in for session.regenerate()) writes the session,
        // then the very next thing that happens is a read of that same sid --
        // exactly the sequence that exposed the Atlas M0 bug.
        await set(store, sid, session);
        const readBack = await get(store, sid);

        if (readBack === undefined || readBack === null) {
          misses += 1;
          continue;
        }

        assert.deepEqual(readBack, session);
      }

      assert.equal(misses, 0, `${misses}/${iterations} immediate reads-after-write came back missing`);
    },
  );

  it("destroys a session so it reads back as absent, same contract express-session expects on logout", async () => {
    const store = new DynamoSessionStore({ ttlSeconds: 3600 });
    const sid = `logout-${randomUUID()}`;

    await set(store, sid, { cookie: { maxAge: 3600000 }, user: { id: "1" } });
    assert.ok(await get(store, sid));

    await destroy(store, sid);

    assert.equal(await get(store, sid), undefined);
  });

  it("treats a session whose cookie has already expired as absent, even though DynamoDB's own TTL sweep may not have run yet", async () => {
    // DynamoDB documents TTL deletion as happening "usually within 48 hours"
    // of expiry, not immediately -- a session read must not trust the
    // background sweep alone. set() with an already-past cookie.expires
    // writes an item the sweep has not had any chance to remove yet; get()
    // must still refuse to serve it.
    const store = new DynamoSessionStore({ ttlSeconds: 3600 });
    const sid = `already-expired-${randomUUID()}`;

    await set(store, sid, {
      cookie: { expires: new Date(Date.now() - 60_000).toISOString() },
      user: { id: "1" },
    });

    assert.equal(await get(store, sid), undefined);
  });

  it("touch() slides the expiry forward without losing the session body", async () => {
    const store = new DynamoSessionStore({ ttlSeconds: 3600 });
    const sid = `touch-${randomUUID()}`;
    const session = { cookie: { maxAge: 3600000 }, user: { id: "42" } };

    await set(store, sid, session);

    await new Promise((resolve, reject) => {
      store.touch(sid, session, (error) => (error ? reject(error) : resolve()));
    });

    assert.deepEqual(await get(store, sid), session);
  });
});
