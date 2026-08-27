import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

// Exercises the ingestion-side S3 upload path against a real S3-compatible
// server (MinIO via docker-compose.yml, or real AWS if S3_TEST_ENDPOINT is
// pointed at it) rather than mocks -- test/unit/storage.test.js covers the
// adapter's request/response shape against a mocked S3Client; this proves
// the whole path -- key derivation, existence check, PUT, dedup within a
// build, and failure handling -- against a live server.
//
// Skips cleanly if nothing answers at S3_TEST_ENDPOINT, since this project's
// CI runner does not run MinIO (yet -- test:integration would need a service
// container added to .github/workflows/ci.yml for this to run there).

const S3_TEST_ENDPOINT = process.env.S3_TEST_ENDPOINT || "http://localhost:9000";
const S3_TEST_BUCKET = process.env.S3_TEST_BUCKET || "tennis-explore-assets";

process.env.PORT ||= "3000";
process.env.MONGODB_URI ||= "mongodb://unused-in-this-test/db";
process.env.STORAGE_PROVIDER = "s3";
process.env.S3_BUCKET = S3_TEST_BUCKET;
process.env.S3_ENDPOINT = S3_TEST_ENDPOINT;
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.S3_ACCESS_KEY_ID ||= "minioadmin";
process.env.S3_SECRET_ACCESS_KEY ||= "minioadmin";

const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "s3-upload-test-"));

process.env.ASSET_SOURCE_ROOT = temporary;

async function isS3Reachable() {
  try {
    const response = await fetch(`${S3_TEST_ENDPOINT}/minio/health/live`);

    return response.ok;
  } catch {
    return false;
  }
}

const s3Available = await isS3Reachable();
const skipReason = s3Available
  ? false
  : `no S3-compatible server reachable at ${S3_TEST_ENDPOINT}; run "docker compose up -d" to start MinIO.`;

const { uploadSourceFiles } = await import("../../src/modules/ingestion/indexBuilder.service.js");
const { objectExists } = await import("../../src/infrastructure/storage/storage.service.js");

after(() => fsp.rm(temporary, { recursive: true, force: true }));

describe("S3 upload during ingestion", { skip: skipReason }, () => {
  it("uploads the source file behind a chunk, keyed by its path under ASSET_SOURCE_ROOT", async () => {
    const filePath = path.join(temporary, `upload-${Date.now()}.txt`);

    await fsp.writeFile(filePath, "the source text a chunk was built from");

    const uploaded = new Set();
    const failures = [];

    await uploadSourceFiles([{ source_uri: filePath }], uploaded, failures);

    assert.deepEqual(failures, []);
    assert.ok(uploaded.has(filePath));
    assert.equal(await objectExists(path.basename(filePath)), true);
  });

  it("reads and uploads a source file only once, even when many chunks share it", async () => {
    const filePath = path.join(temporary, `shared-${Date.now()}.txt`);

    await fsp.writeFile(filePath, "one pdf, many chunks");

    const uploaded = new Set();
    const failures = [];
    const chunks = Array.from({ length: 5 }, () => ({ source_uri: filePath }));

    await uploadSourceFiles(chunks, uploaded, failures);

    assert.equal(uploaded.size, 1);
    assert.deepEqual(failures, []);
  });

  it("skips a file already in the bucket instead of re-reading and re-uploading it", async () => {
    const filePath = path.join(temporary, `already-there-${Date.now()}.txt`);

    await fsp.writeFile(filePath, "uploaded by a previous, now-crashed build");

    const firstRun = new Set();

    await uploadSourceFiles([{ source_uri: filePath }], firstRun, []);
    assert.ok(await objectExists(path.basename(filePath)));

    // simulates resuming in a fresh process: `uploaded` starts empty, so the
    // only thing that can prevent a redundant PUT is the objectExists check.
    await fsp.rm(filePath);

    const resumedRun = new Set();
    const failures = [];

    await uploadSourceFiles([{ source_uri: filePath }], resumedRun, failures);

    // the source file is gone, so a real re-upload attempt would have failed
    // to read it -- getting here with no failure proves objectExists short-
    // circuited before fsp.readFile was ever called.
    assert.deepEqual(failures, []);
  });

  it("records a failure instead of throwing when the source file cannot be read", async () => {
    const uploaded = new Set();
    const failures = [];

    await uploadSourceFiles(
      [{ source_uri: path.join(temporary, "does-not-exist.pdf") }],
      uploaded,
      failures,
    );

    assert.equal(failures.length, 1);
    assert.match(failures[0].reason, /ENOENT|no such file/i);
  });

  it("does nothing for a chunk with no source_uri, rather than uploading 'undefined'", async () => {
    const uploaded = new Set();
    const failures = [];

    await uploadSourceFiles([{ chunk_id: "no-source" }], uploaded, failures);

    assert.equal(uploaded.size, 0);
    assert.deepEqual(failures, []);
  });
});
