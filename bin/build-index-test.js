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
process.env.INDEX_DIR ||= "data/index-test";

console.log(`(test build -- writing to ${process.env.INDEX_DIR}, not the real data/index)\n`);

await import("./build-index.js");
