import bcrypt from "bcryptjs";

import User from "../models/user.model.js";

const SALT_ROUNDS = 12;

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
    this.code = "INVALID_CREDENTIALS";
    this.statusCode = 401;
  }
}

/**
 * Verifies email/password and returns the account on success.
 *
 * Deliberately returns the same InvalidCredentialsError whether the email
 * doesn't exist or the password is wrong -- telling a caller "that email
 * isn't registered" is a account-enumeration leak the error message must
 * not provide.
 */
export async function authenticate(email, password) {
  if (typeof email !== "string" || typeof password !== "string") {
    throw new InvalidCredentialsError();
  }

  const user = await User.findOne({
    email: email.trim().toLowerCase(),
    isActive: true,
  });

  if (!user) {
    // Still pays bcrypt's cost even on a miss, so a timing difference
    // between "no such user" and "wrong password" cannot be measured.
    await bcrypt.compare(password, "$2a$12$" + "0".repeat(53));
    throw new InvalidCredentialsError();
  }

  const matches = await bcrypt.compare(password, user.passwordHash);

  if (!matches) {
    throw new InvalidCredentialsError();
  }

  return user;
}

/**
 * Creates one account. Used by the seed script (bin/seed-users.js) --
 * there is no public self-registration endpoint, on purpose: every role
 * this app grants is a real access boundary (accessControl.js), and open
 * signup would mean anyone could pick their own clearance.
 */
export async function createUser({ email, password, displayName, roleId }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  return User.create({
    email: email.trim().toLowerCase(),
    passwordHash,
    displayName,
    roleId,
  });
}
