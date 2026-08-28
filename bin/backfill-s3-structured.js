#!/usr/bin/env node
// uploads the CSV/XLSX files behind the structured tables (STRUCTURED_SOURCE_DIRS)
// to S3, the same way bin/backfill-s3.js does for the vector index's chunks.
//
//   STORAGE_PROVIDER=s3 npm run backfill:s3:structured
//
// tableStore.service.js reads these files straight off disk for every query
// and never turns them into index chunks, so bin/backfill-s3.js -- which only
// walks the vector index's chunks -- never uploads them. Without this, a
// structured/table citation's asset.routes.js lookup resolves fine but
// objectExists() is always false, so every table citation 410s.
//
// Safe to re-run if interrupted: uploadSourceFiles skips anything already in
// the bucket.

import process from "node:process";

import { env } from "../src/config/env.js";
import { getTables } from "../src/modules/structured/tableStore.service.js";
import { uploadSourceFiles } from "../src/modules/ingestion/indexBuilder.service.js";

if (env.storage.provider !== "s3") {
  console.error("STORAGE_PROVIDER=s3 is required (plus S3_BUCKET, S3_ACCESS_KEY_ID, ASSET_SOURCE_ROOT). See .env.example.");
  process.exit(1);
}

console.log(`backfilling s3://${env.storage.s3.bucket} from structured tables (${env.structuredSourceDirs.join(", ") || "index manifest fallback"})...`);

const tables = await getTables({
  sourceDirs: env.structuredSourceDirs.length > 0 ? env.structuredSourceDirs : undefined,
});
const sourceUris = [...new Set(tables.map((table) => table.sourceUri).filter(Boolean))];

console.log(`${tables.length.toLocaleString()} table(s), ${sourceUris.length.toLocaleString()} unique source file(s)\n`);

const uploaded = new Set();
const failures = [];
const startedAt = Date.now();

for (const [index, sourceUri] of sourceUris.entries()) {
  await uploadSourceFiles([{ source_uri: sourceUri }], uploaded, failures);

  const done = index + 1;

  if (done % 10 === 0 || done === sourceUris.length) {
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
