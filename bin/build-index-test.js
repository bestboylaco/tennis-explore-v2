#!/usr/bin/env node
// safe wrapper around build-index.js for trying out a new source folder.
//
//   npm run build:index:test -- data/raw/whatever
//
// build-index.js writes to INDEX_DIR, which defaults to data/index -- the
// real corpus index, on purpose, so a normal build lands where the app
// actually reads from. That default is exactly wrong for a test run: it
// silently overwrote the real 99,496-chunk index with a 1-chunk test build
// on 2026-08-28, recovered only because data/index/ happens to be committed.
//
// This sets INDEX_DIR to a scratch directory before build-index.js ever
// reads it, so trying a new folder can't reach the real index no matter
// what INDEX_DIR is (or isn't) set to in .env.
import crypto from "node:crypto";

import dotenv from "dotenv";

process.env.INDEX_DIR ||= "data/index-test";

// loaded AFTER INDEX_DIR is pinned above -- dotenv never overrides a variable
// that is already set, so an INDEX_DIR=data/index line in .env cannot win --
// and BEFORE the checks below, so a DEID_SECRET kept in .env is seen.
dotenv.config();

// E2-08: test builds are de-identified unless told otherwise
// (DEID_ENABLED=false in the shell or .env). the real data/index is still built
// from raw data until its own rebuild, which is why this is on here and off by
// default everywhere else.
process.env.DEID_ENABLED ||= "true";

if (process.env.DEID_ENABLED === "true" && !process.env.DEID_SECRET) {
  // a throwaway key for a throwaway index. its pseudonyms match nothing else
  // and the key is gone when this process exits, which is the right strength
  // for a scratch build -- and still far better than writing real names into
  // it. set DEID_SECRET to get pseudonyms that are stable across builds.
  process.env.DEID_SECRET = crypto.randomBytes(32).toString("hex");
  console.log("(DEID_SECRET not set -- using a one-off random key for this test build)");
}

console.log(`(test build -- writing to ${process.env.INDEX_DIR}, not the real data/index)`);
console.log(`(de-identification: ${process.env.DEID_ENABLED === "true" ? "on" : "off"})\n`);

await import("./build-index.js");
