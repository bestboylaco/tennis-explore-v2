import { randomBytes } from "node:crypto";

import dotenv from "dotenv";

dotenv.config();

// Same rule as telemetry.config.js and audit.config.js: read separately from
// config/env.js so a missing auth variable is never the reason the whole
// process fails to start -- CI's unit-test job never sets SESSION_SECRET,
// and it must not have to.
//
// The fallback is a per-process random secret. That is fine for a single
// Express instance in a demo: sessions just don't survive a restart, which
// only means everyone has to log in again. It is NOT fine behind a load
// balancer or across a redeploy in anything resembling production -- set
// SESSION_SECRET for real before this goes anywhere the partner can reach.
let warnedMissingSecret = false;

function readSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      "SESSION_SECRET is not set. Using a random per-process secret -- " +
        "every session is invalidated on restart. Set SESSION_SECRET before " +
        "deploying anywhere beyond a single local demo instance.",
    );
  }

  return randomBytes(32).toString("hex");
}

export const authConfig = Object.freeze({
  sessionSecret: readSessionSecret(),

  // 8 hours: long enough to cover one demo/coaching session without asking
  // for a re-login mid-question, short enough that a forgotten open tab
  // doesn't stay authenticated indefinitely.
  sessionMaxAgeMs: 8 * 60 * 60 * 1000,

  // Opt-in only, never inferred from NODE_ENV: CI and any other non-production
  // run (test, staging) also has NODE_ENV !== "production", so gating this on
  // that would silently re-authenticate every request in those environments
  // too -- which is exactly what broke the T-01 "anonymous is rejected"
  // integration tests. A developer has to set this explicitly in their own
  // .env to skip login locally.
  devAutoLoginEnabled: process.env.ENABLE_DEV_AUTO_LOGIN === "true",
});
