import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "../../src/modules/auth/models/user.model.js";
import Conversation from "../../src/modules/conversations/models/conversation.model.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const password = "Conversation-History-Test-2026!";
const emailA = `history-a-${randomUUID()}@test.tennisexplore.local`;
const emailB = `history-b-${randomUUID()}@test.tennisexplore.local`;

let server;
let baseUrl;
let userA;
let userB;

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : null;
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const headers = {};

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function login(email) {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });

  assert.equal(response.status, 200);
  return cookieFrom(response);
}

describe(
  "conversation history",
  { skip: mongoUri ? false : "MONGODB_URI is not set" },
  () => {
    before(async () => {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

      const passwordHash = await bcrypt.hash(password, 4);

      [userA, userB] = await User.create([
        {
          email: emailA,
          passwordHash,
          displayName: "History Test A",
          roleId: "academy_coach",
        },
        {
          email: emailB,
          passwordHash,
          displayName: "History Test B",
          roleId: "tour_coach",
        },
      ]);

      const { default: app } = await import("../../src/app.js");

      await new Promise((resolve) => {
        server = app.listen(0, resolve);
      });

      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
      await Conversation.deleteMany({ userId: { $in: [userA?._id, userB?._id] } });
      await User.deleteMany({ email: { $in: [emailA, emailB] } });

      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }

      await mongoose.disconnect();
    });

    it("persists history for the same account across a new login session", async () => {
      const firstCookie = await login(emailA);

      const createResponse = await request("/api/conversations", {
        method: "POST",
        cookie: firstCookie,
        body: {
          message: {
            role: "user",
            content: "How should I plan tomorrow's serve session?",
          },
        },
      });

      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()).data;

      const secondCookie = await login(emailA);
      const listResponse = await request("/api/conversations", {
        cookie: secondCookie,
      });
      const listBody = await listResponse.json();

      assert.equal(listResponse.status, 200);
      assert.ok(listBody.data.some((item) => item.id === created.id));
    });

    it("does not expose one account's conversation to another account", async () => {
      const cookieA = await login(emailA);
      const cookieB = await login(emailB);

      const createResponse = await request("/api/conversations", {
        method: "POST",
        cookie: cookieA,
        body: {
          message: {
            role: "user",
            content: "Private coaching conversation",
          },
        },
      });
      const created = (await createResponse.json()).data;

      const listB = await request("/api/conversations", { cookie: cookieB });
      const bodyB = await listB.json();

      assert.equal(bodyB.data.some((item) => item.id === created.id), false);

      const readB = await request(`/api/conversations/${created.id}`, {
        cookie: cookieB,
      });

      assert.equal(readB.status, 404);
    });

    it("reading an older conversation does not change its ordering timestamp", async () => {
      const cookie = await login(emailA);

      const createOne = await request("/api/conversations", {
        method: "POST",
        cookie,
        body: {
          message: { role: "user", content: "Older history item" },
        },
      });
      const older = (await createOne.json()).data;

      await new Promise((resolve) => setTimeout(resolve, 20));

      const createTwo = await request("/api/conversations", {
        method: "POST",
        cookie,
        body: {
          message: { role: "user", content: "Newer history item" },
        },
      });
      const newer = (await createTwo.json()).data;

      const beforeResponse = await request("/api/conversations", { cookie });
      const before = (await beforeResponse.json()).data;

      await request(`/api/conversations/${older.id}`, { cookie });

      const afterResponse = await request("/api/conversations", { cookie });
      const after = (await afterResponse.json()).data;

      assert.ok(before.findIndex((item) => item.id === newer.id) < before.findIndex((item) => item.id === older.id));
      assert.deepEqual(
        after.map((item) => item.id),
        before.map((item) => item.id),
      );
    });
  },
);
