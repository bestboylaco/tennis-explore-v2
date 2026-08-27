#!/usr/bin/env node
// uploads the source files behind an ALREADY-BUILT index to S3, without
// re-running extraction/chunking/embedding.
//
//   STORAGE_PROVIDER=s3 npm run backfill:s3
//
// bin/build-index.js only uploads a file's source as it processes that file,
// so an index built before S3 mode existed -- or built while pointed at a
// different bucket -- has chunks with no matching object in the current
// bucket. Re-running the full build just to fix that would re-embed
// everything for nothing; this reuses the same uploadSourceFiles() the build
// calls per-file, over every chunk the index already has.
//
// Safe to re-run if interrupted: uploadSourceFiles skips anything already in
// the bucket (an objectExists check), so a second run only uploads what the
// first one did not get to.

import process from "node:process";

import { env } from "../src/config/env.js";
import { retrievalConfig } from "../src/config/retrieval.config.js";
import { VectorStore } from "../src/infrastructure/vector/vectorStore.service.js";
import { uploadSourceFiles } from "../src/modules/ingestion/indexBuilder.service.js";

if (env.storage.provider !== "s3") {
  console.error("STORAGE_PROVIDER=s3 is required (plus S3_BUCKET, S3_ACCESS_KEY_ID, ASSET_SOURCE_ROOT). See .env.example.");
  process.exit(1);
}

console.log(`backfilling s3://${env.storage.s3.bucket} from ${retrievalConfig.index.dir}...`);

const store = await VectorStore.load(retrievalConfig.index.dir);

const sourceUris = [...new Set(store.chunks.map((chunk) => chunk.source_uri).filter(Boolean))];

console.log(`${store.chunks.length.toLocaleString()} chunks, ${sourceUris.length.toLocaleString()} unique source file(s)\n`);

const uploaded = new Set();
const failures = [];
const startedAt = Date.now();

for (const [index, sourceUri] of sourceUris.entries()) {
  await uploadSourceFiles([{ source_uri: sourceUri }], uploaded, failures);

  const done = index + 1;

  if (done % 25 === 0 || done === sourceUris.length) {
    const elapsed = (Date.now() - startedAt) / 1000;

    process.stdout.write(
      `\r${done}/${sourceUris.length} (${uploaded.size} uploaded, ${failures.length} failed)  ` +
        `${elapsed.toFixed(0)}s elapsed`.padEnd(20),
    );
  }
}

console.log(`\n\ndone: ${uploaded.size} uploaded, ${failures.length} failed`);

if (failures.length > 0) {
  console.log("\nfailed:");

  for (const failure of failures.slice(0, 20)) {
    console.log(`  ${failure.file}: ${failure.reason}`);
  }

  if (failures.length > 20) console.log(`  ...and ${failures.length - 20} more`);

  console.log("\nre-run this script to retry -- files already in the bucket are skipped, not re-uploaded.");
  process.exitCode = 1;
}
