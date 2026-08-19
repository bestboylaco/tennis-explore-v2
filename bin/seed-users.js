#!/usr/bin/env node
// create or reset one demo login per role.
//
//   npm run seed:users
//   npm run seed:users -- --password "SomethingElse2026!"
//
// there is no public signup route on purpose (auth.service.js) -- every role
// this app grants is a real access boundary, so accounts are provisioned
// here rather than self-served. re-running this script is safe: it upserts,
// so it can be used to reset the demo password too.

import process from "node:process";

import bcrypt from "bcryptjs";

import { connectMongoDB, disconnectMongoDB } from "../src/infrastructure/database/mongodb.service.js";
import { ROLES } from "../src/shared/constants/accessControl.js";
import User from "../src/modules/auth/models/user.model.js";

const args = process.argv.slice(2);
let password = "TennisExplore2026Demo!";

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--password") {
    password = args[i + 1];
    i += 1;
  }
}

async function main() {
  await connectMongoDB();

  const passwordHash = await bcrypt.hash(password, 12);
  const results = [];

  for (const role of Object.values(ROLES)) {
    const email = `${role.roleId}@demo.tennisexplore.local`;

    const user = await User.findOneAndUpdate(
      { email },
      {
        email,
        passwordHash,
        displayName: role.displayName,
        roleId: role.roleId,
        isActive: true,
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    results.push(user.email);
  }

  console.log(`Seeded ${results.length} demo accounts, one per role, all with password: ${password}\n`);

  for (const email of results) {
    console.log(`  ${email}`);
  }

  await disconnectMongoDB();
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exitCode = 1;
});
