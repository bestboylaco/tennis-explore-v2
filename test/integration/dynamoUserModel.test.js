import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// TENISE-63: exercises the user model against a real DynamoDB-compatible
// server (DynamoDB Local via docker-compose.yml), the same pattern
// test/integration/s3Upload.test.js uses for the S3 adapter -- proves
// CreateUser/findUserByEmail/findActiveAdminUser/upsert/delete against a live
// table rather than mocking the SDK.
//
// Uses its own DYNAMODB_TEST_* vars, distinct from the app's real DYNAMODB_*
// vars, so a developer's real partner credentials (once granted) are never at
// risk of being exercised by this suite.

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

const {
  createUser,
  deleteUserByEmail,
  DuplicateEmailError,
  findActiveAdminUser,
  findUserByEmail,
  InvalidRoleIdError,
  upsertUserByEmail,
} = await import("../../src/modules/auth/models/user.model.js");

describe("DynamoDB user model", { skip: skipReason }, () => {
  const createdEmails = [];

  after(async () => {
    await Promise.all(createdEmails.map((email) => deleteUserByEmail(email)));
  });

  it("creates an account and finds it by email, without the password hash leaking through toSafeJSON", async () => {
    const email = `itest-user-${randomUUID()}@test.tennisexplore.local`;

    createdEmails.push(email);

    const created = await createUser({
      email,
      passwordHash: "bcrypt-hash-placeholder",
      displayName: "DynamoDB Test User",
      roleId: "analyst",
    });

    assert.ok(created.id, "a Mongo-ObjectId-shaped id is minted");
    assert.equal(created.passwordHash, "bcrypt-hash-placeholder");
    assert.equal(created.toSafeJSON().passwordHash, undefined);

    const found = await findUserByEmail(email);

    assert.equal(found.email, email);
    assert.equal(found.id, created.id);
    assert.equal(found.roleId, "analyst");
    assert.deepEqual(found.toSafeJSON(), {
      id: created.id,
      email,
      displayName: "DynamoDB Test User",
      roleId: "analyst",
    });
  });

  it("is case-insensitive on email, same as the Mongoose schema's lowercase:true used to be", async () => {
    const email = `itest-user-${randomUUID()}@test.tennisexplore.local`;

    createdEmails.push(email);

    await createUser({
      email: email.toUpperCase(),
      passwordHash: "x",
      displayName: "Case Test",
      roleId: "analyst",
    });

    const found = await findUserByEmail(email);

    assert.ok(found, "the lowercased email finds the account created with an uppercase one");
  });

  it("rejects a second account at the same email, the DynamoDB equivalent of a unique index", async () => {
    const email = `itest-user-${randomUUID()}@test.tennisexplore.local`;

    createdEmails.push(email);

    await createUser({ email, passwordHash: "x", displayName: "First", roleId: "analyst" });

    await assert.rejects(
      createUser({ email, passwordHash: "y", displayName: "Second", roleId: "analyst" }),
      DuplicateEmailError,
    );
  });

  it("rejects a roleId that is not one of accessControl.js's ROLE_IDS", async () => {
    await assert.rejects(
      createUser({
        email: `itest-user-${randomUUID()}@test.tennisexplore.local`,
        passwordHash: "x",
        displayName: "Bad Role",
        roleId: "super_admin_definitely_not_real",
      }),
      InvalidRoleIdError,
    );
  });

  it("finds an active admin for the dev auto-login path, and ignores an inactive one", async () => {
    const inactiveEmail = `itest-admin-inactive-${randomUUID()}@test.tennisexplore.local`;
    const activeEmail = `itest-admin-active-${randomUUID()}@test.tennisexplore.local`;

    createdEmails.push(inactiveEmail, activeEmail);

    await createUser({
      email: inactiveEmail,
      passwordHash: "x",
      displayName: "Inactive Admin",
      roleId: "admin",
      isActive: false,
    });

    await createUser({
      email: activeEmail,
      passwordHash: "x",
      displayName: "Active Admin",
      roleId: "admin",
    });

    const admin = await findActiveAdminUser();

    assert.ok(admin, "at least one active admin is found");
    assert.equal(admin.roleId, "admin");
    assert.equal(admin.isActive, true);
  });

  it("upserts without minting a new id, the way bin/seed-users.js resetting the demo password relies on", async () => {
    const email = `itest-seed-${randomUUID()}@test.tennisexplore.local`;

    createdEmails.push(email);

    const first = await upsertUserByEmail({
      email,
      passwordHash: "hash-v1",
      displayName: "Seed Demo",
      roleId: "athlete",
    });

    const second = await upsertUserByEmail({
      email,
      passwordHash: "hash-v2",
      displayName: "Seed Demo",
      roleId: "athlete",
    });

    assert.equal(second.id, first.id, "re-running the seed script keeps the same identity");
    assert.equal(second.passwordHash, "hash-v2", "the password was actually reset");

    const found = await findUserByEmail(email);

    assert.equal(found.passwordHash, "hash-v2");
  });

  it("deleteUserByEmail removes the account", async () => {
    const email = `itest-delete-${randomUUID()}@test.tennisexplore.local`;

    await createUser({ email, passwordHash: "x", displayName: "To Delete", roleId: "analyst" });
    assert.ok(await findUserByEmail(email));

    await deleteUserByEmail(email);

    assert.equal(await findUserByEmail(email), null);
  });

  it("returns null, not a throw, for an email that was never registered", async () => {
    const result = await findUserByEmail(`nobody-${randomUUID()}@test.tennisexplore.local`);

    assert.equal(result, null);
  });
});
