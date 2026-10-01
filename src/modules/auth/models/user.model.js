import { Types } from "mongoose";

import {
    ROLE_IDS,
} from "../../../shared/constants/accessControl.js";
import {
    buildKey,
    deleteItem,
    getItem,
    pkName,
    putItem,
    scanAll,
    stripInternalFields,
} from "../../../infrastructure/dynamodb/dynamoTable.service.js";

/*
 * TENISE-63: the account behind a role, now stored in the one DynamoDB table
 * this project has rather than its own MongoDB collection.
 *
 * Single-table design: PK = `USER#<email>`, SK = `PROFILE`. Email is the
 * natural unique key for an account, so it is the partition key directly --
 * there is no separate uniqueness index to maintain, the key IS the
 * constraint (a conditional PutItem on `attribute_not_exists(PK)` is what
 * createUser() uses to enforce it, the DynamoDB equivalent of Mongoose's
 * `unique: true`).
 *
 * `id` is deliberately minted as a Mongo ObjectId-shaped string
 * (new Types.ObjectId().toString()), NOT re-derived from DynamoDB. Importing
 * `Types` from mongoose here does not reconnect this module to MongoDB --
 * it is used purely as an id generator. This exists because
 * src/modules/conversations/models/conversation.model.js (left on MongoDB,
 * out of scope for this migration) stores `userId` as a real Mongo
 * ObjectId and validates it with `mongoose.isValidObjectId()`
 * (conversation.service.js's normaliseUserId). A role is resolved from the
 * authenticated account rather than accepted from request input, same as
 * before -- this just keeps the id shape that the rest of the app, and the
 * database conversations/sources/audit still live on, already expects.
 */

const ENTITY_TYPE = "USER";
const PROFILE_SK = "PROFILE";

export class DuplicateEmailError extends Error {
    constructor(email) {
        super(`An account already exists for ${email}.`);
        this.name = "DuplicateEmailError";
        this.code = "DUPLICATE_EMAIL";
        this.statusCode = 409;
    }
}

export class InvalidRoleIdError extends Error {
    constructor(roleId) {
        super(`roleId ${JSON.stringify(roleId)} is not one of: ${ROLE_IDS.join(", ")}`);
        this.name = "InvalidRoleIdError";
        this.code = "INVALID_ROLE_ID";
        this.statusCode = 400;
    }
}

function normaliseEmail(email) {
    return String(email).trim().toLowerCase();
}

function userPk(email) {
    return `USER#${normaliseEmail(email)}`;
}

function validateRoleId(roleId) {
    if (!ROLE_IDS.includes(roleId)) {
        throw new InvalidRoleIdError(roleId);
    }
}

/*
 * Safe account representation returned after login/session validation.
 *
 * passwordHash is deliberately omitted. Kept as a method on the returned
 * record (not a standalone exported function) so existing call sites --
 * auth.controller.js's `user.toSafeJSON()`, app.js's `admin.toSafeJSON()` --
 * needed no change at all.
 */
function toSafeJSON() {
    return {
        id: this.id,
        email: this.email,
        displayName: this.displayName,
        roleId: this.roleId,
    };
}

function attachSafeJSON(record) {
    if (!record) return null;

    return Object.assign(Object.create({ toSafeJSON }), record);
}

function fromItem(item) {
    return stripInternalFields(item);
}

export async function findUserByEmail(email) {
    if (!email) return null;

    // Strongly consistent: this is the read half of the login path, and a
    // user record read moments after it was written (seed script, signup in
    // the future) must never look "not found" the way Atlas M0 occasionally
    // did -- see docs/DYNAMODB-MIGRATION.md for why ConsistentRead removes the
    // need for the retry wrapper app.js used to carry.
    const item = await getItem(userPk(email), PROFILE_SK, { consistentRead: true });

    return attachSafeJSON(fromItem(item));
}

/*
 * Used only by the local-dev auto-login path (app.js, ENABLE_DEV_AUTO_LOGIN).
 * A Scan, not a Query: this project defines no secondary index for role
 * lookups, on purpose -- the real partner table's indexes (if any) are
 * unknown, and this path only ever runs against a handful of seeded demo
 * accounts, where a full scan costs nothing.
 */
export async function findActiveAdminUser() {
    const items = await scanAll({
        filterExpression: "entityType = :entityType AND roleId = :roleId AND isActive = :isActive",
        expressionAttributeValues: {
            ":entityType": ENTITY_TYPE,
            ":roleId": "admin",
            ":isActive": true,
        },
    });

    return attachSafeJSON(fromItem(items[0]));
}

function buildUserItem({ email, passwordHash, displayName, roleId, isActive, id, createdAt, updatedAt }) {
    const normalisedEmail = normaliseEmail(email);

    return {
        ...buildKey(userPk(normalisedEmail), PROFILE_SK),
        entityType: ENTITY_TYPE,
        id,
        email: normalisedEmail,
        passwordHash,
        displayName,
        roleId,
        isActive,
        createdAt,
        updatedAt,
    };
}

/*
 * Creates one account. Fails if the email already exists -- the conditional
 * expression is the DynamoDB equivalent of the unique index Mongoose's
 * `unique: true` created, since there is no public signup route and every
 * account is provisioned deliberately (auth.service.js / bin/seed-users.js).
 */
export async function createUser({ email, passwordHash, displayName, roleId, isActive = true }) {
    validateRoleId(roleId);

    const normalisedEmail = normaliseEmail(email);
    const now = new Date().toISOString();

    const item = buildUserItem({
        email: normalisedEmail,
        passwordHash,
        displayName,
        roleId,
        isActive,
        id: new Types.ObjectId().toString(),
        createdAt: now,
        updatedAt: now,
    });

    try {
        await putItem(item, {
            conditionExpression: "attribute_not_exists(#pk)",
            expressionAttributeNames: { "#pk": pkName() },
        });
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            throw new DuplicateEmailError(normalisedEmail);
        }

        throw error;
    }

    return attachSafeJSON(fromItem(item));
}

/*
 * Upsert used only by bin/seed-users.js (re-running the seed script resets
 * the demo password). Unlike createUser(), this is allowed to overwrite an
 * existing account -- that is the whole point of a reset script -- so it
 * carries no uniqueness condition and preserves the original id/createdAt
 * when updating rather than minting a new identity on every reset.
 */
export async function upsertUserByEmail({ email, passwordHash, displayName, roleId, isActive = true }) {
    validateRoleId(roleId);

    const normalisedEmail = normaliseEmail(email);
    const existing = await findUserByEmail(normalisedEmail);
    const now = new Date().toISOString();

    const item = buildUserItem({
        email: normalisedEmail,
        passwordHash,
        displayName,
        roleId,
        isActive,
        id: existing?.id ?? new Types.ObjectId().toString(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });

    await putItem(item);

    return attachSafeJSON(fromItem(item));
}

// Test/seed teardown helper. No production call site removes an account.
export async function deleteUserByEmail(email) {
    if (!email) return;

    await deleteItem(userPk(email), PROFILE_SK);
}
