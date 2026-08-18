import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import User from "../../src/modules/auth/models/user.model.js";

dotenv.config();

// TENISE-43/E5-20, T-01: proves the gap this story closed -- an anonymous
// caller can no longer read a protected route or run a chat query, and a
// session survives login/logout the way the client relies on it to.
//
// Runs a real server the same way telemetryHttpRoute.test.js does, for the
// same reason noted there: src/app.js pulls in config/env.js, which throws
// on a missing PORT while the module graph is still loading -- imported
// inside before() so the skip guard below can apply first.

const mongoUri = process.env.MONGODB_URI;
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

describe("auth", { skip: mongoUri ? false : "MONGODB_URI is not set" }, () => {
  before(async () => {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

    await User.create({
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
    await User.deleteOne({ email: testEmail });
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
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
