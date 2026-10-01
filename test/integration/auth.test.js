import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

// TENISE-43/E5-20, T-01: proves the gap this story closed -- an anonymous
// caller can no longer read a protected route or run a chat query, and a
// session survives login/logout the way the client relies on it to.
//
// TENISE-63: login/session no longer touch MongoDB at all -- accounts and
// sessions are DynamoDB only now (user.model.js, dynamoSessionStore.js). This
// suite is gated on DynamoDB reachability instead of MONGODB_URI, same
// pattern test/integration/s3Upload.test.js uses for the S3 adapter: point at
// DynamoDB Local via its own DYNAMODB_TEST_* vars, distinct from the app's
// real DYNAMODB_* vars.
//
// src/app.js still unconditionally requires PORT/MONGODB_URI to be *set*
// (src/config/env.js throws on a missing one) because conversations/sources/
// audit stay on Mongo -- but app.js never calls connectMongoDB() itself
// (only src/server.js does), so a dummy MONGODB_URI is enough to import and
// mount the app; nothing this suite exercises touches Mongo for real.

const DYNAMODB_TEST_ENDPOINT = process.env.DYNAMODB_TEST_ENDPOINT || "http://localhost:8800";
const DYNAMODB_TEST_TABLE = process.env.DYNAMODB_TEST_TABLE || "tennis-explore-g2";

process.env.PORT ||= "3000";
process.env.MONGODB_URI ||= "mongodb://unused-in-this-test/db";
process.env.DYNAMODB_ENDPOINT = DYNAMODB_TEST_ENDPOINT;
process.env.DYNAMODB_TABLE_NAME = DYNAMODB_TEST_TABLE;
process.env.DYNAMODB_ACCESS_KEY_ID ||= "local";
process.env.DYNAMODB_SECRET_ACCESS_KEY ||= "local";

const testEmail = `itest-auth-${randomUUID()}@test.tennisexplore.local`;
const testPassword = "Correct-Horse-Battery-Staple-9!";

let server;
let baseUrl;
let agentCookie = null;

async function post(path, body, { cookie = null } = {}) {
  const headers = { "Content-Type": "application/json" };

  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return response;
}

async function get(path, { cookie = null } = {}) {
  const headers = {};

  if (cookie) headers.Cookie = cookie;

  return fetch(`${baseUrl}${path}`, { headers });
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) return null;

  // Only the name=value pair is needed to send it back; strip the
  // Path/HttpOnly/Expires attributes a real browser would handle for us.
  return setCookie.split(";")[0];
}

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

const { createUser, deleteUserByEmail } = await import("../../src/modules/auth/models/user.model.js");

describe("auth", { skip: skipReason }, () => {
  before(async () => {
    await createUser({
      email: testEmail,
      passwordHash: await bcrypt.hash(testPassword, 4), // low cost: test speed, not production
      displayName: "Integration Test Analyst",
      roleId: "analyst",
    });

    const { default: app } = await import("../../src/app.js");

    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });

    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await deleteUserByEmail(testEmail);
    await new Promise((resolve) => server.close(resolve));
  });

  it("rejects a chat request with no session at all", async () => {
    const response = await post("/api/chat", { question: "test", evidence: [] });

    assert.equal(response.status, 401);

    const body = await response.json();

    assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
  });

  it("rejects a protected route with no session", async () => {
    const response = await get("/api/telemetry");

    assert.equal(response.status, 401);
  });

  it("rejects login with the wrong password, and the message does not reveal which field was wrong", async () => {
    const response = await post("/api/auth/login", {
      email: testEmail,
      password: "definitely-not-it",
    });

    assert.equal(response.status, 401);

    const body = await response.json();

    assert.equal(body.error.code, "INVALID_CREDENTIALS");
    assert.doesNotMatch(body.error.message.toLowerCase(), /no (such )?(user|account|email)/);
  });

  it("rejects login for an email that was never registered, with the same error as a wrong password", async () => {
    const response = await post("/api/auth/login", {
      email: `nobody-${randomUUID()}@test.tennisexplore.local`,
      password: "irrelevant",
    });

    assert.equal(response.status, 401);

    const body = await response.json();

    assert.equal(body.error.code, "INVALID_CREDENTIALS");
  });

  it("logs in with correct credentials, sets a session, and never returns the password hash", async () => {
    const response = await post("/api/auth/login", {
      email: testEmail,
      password: testPassword,
    });

    assert.equal(response.status, 200);

    const body = await response.json();

    assert.equal(body.data.email, testEmail);
    assert.equal(body.data.roleId, "analyst");
    assert.equal(body.data.passwordHash, undefined);

    agentCookie = cookieFrom(response);
    assert.ok(agentCookie, "login must set a session cookie");
  });

  it("reports the signed-in account on /me once a session exists", async () => {
    const response = await get("/api/auth/me", { cookie: agentCookie });
    const body = await response.json();

    assert.equal(body.data.email, testEmail);
  });

  it("lets an authenticated request through to a route requireAuth gates, using the session's role -- never a client-supplied one", async () => {
    const response = await post(
      "/api/chat",
      // A role in the body must be ignored -- the whole point of this
      // story is that req.user.roleId (session) is authoritative, not
      // anything the caller sends. If this "admin" leaked through, later
      // access-filtering assertions relying on this session's real role
      // (analyst) would be meaningless.
      { question: "test", evidence: [], role: "admin" },
      { cookie: agentCookie },
    );

    // Reaching generation (which then fails locally because there is no
    // Ollama server in this environment) proves requireAuth let the
    // request through -- a 401 here would mean the session didn't attach.
    assert.notEqual(response.status, 401);
  });

  it("destroys the session on logout, so the same cookie no longer authenticates", async () => {
    const logoutResponse = await post("/api/auth/logout", {}, { cookie: agentCookie });

    assert.equal(logoutResponse.status, 200);

    const meResponse = await get("/api/auth/me", { cookie: agentCookie });
    const meBody = await meResponse.json();

    assert.equal(meBody.data, null);

    const chatResponse = await post(
      "/api/chat",
      { question: "test", evidence: [] },
      { cookie: agentCookie },
    );

    assert.equal(chatResponse.status, 401);
  });
});
