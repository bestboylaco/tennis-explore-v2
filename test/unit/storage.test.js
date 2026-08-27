import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it, mock } from "node:test";

import { S3Client } from "@aws-sdk/client-s3";

// env.js validates its required variables eagerly at import time, so this
// file sets everything storage.service.js's import chain needs -- including
// PORT/MONGODB_URI, which no other unit test has had to care about because
// this is the first unit test to import env.js at all (asset.routes.js and
// mongodb.service.js were previously only ever reached from integration
// tests, which set those in CI -- see .github/workflows/ci.yml).
process.env.PORT = "3000";
process.env.MONGODB_URI = "mongodb://unused-in-this-test/db";
process.env.STORAGE_PROVIDER = "s3";
process.env.S3_BUCKET = "test-bucket";

const { getObject, objectExists, resetS3ClientForTests } = await import(
  "../../src/infrastructure/storage/storage.service.js"
);

describe("S3 storage adapter", () => {
  it("returns false, not a thrown error, when the object is missing", async () => {
    resetS3ClientForTests();

    mock.method(S3Client.prototype, "send", async () => {
      const error = new Error("not found");

      error.name = "NotFound";
      throw error;
    });

    assert.equal(await objectExists("missing-key"), false);

    mock.reset();
  });

  it("returns true when HeadObject succeeds", async () => {
    resetS3ClientForTests();

    mock.method(S3Client.prototype, "send", async () => ({}));

    assert.equal(await objectExists("present-key"), true);

    mock.reset();
  });

  it("re-throws errors that are not a 404", async () => {
    resetS3ClientForTests();

    mock.method(S3Client.prototype, "send", async () => {
      throw new Error("network blip");
    });

    await assert.rejects(() => objectExists("some-key"), /network blip/);

    mock.reset();
  });

  it("requests a whole object as a 200 when no range is asked for", async () => {
    resetS3ClientForTests();

    let receivedCommand;

    mock.method(S3Client.prototype, "send", async (command) => {
      receivedCommand = command;

      return {
        Body: Readable.from(["file bytes"]),
        ContentType: "application/pdf",
        ContentLength: 10,
      };
    });

    const result = await getObject("doc.pdf");

    assert.equal(result.statusCode, 200);
    assert.equal(result.contentType, "application/pdf");
    assert.equal(result.contentLength, 10);
    assert.equal(result.contentRange, undefined);
    assert.equal(receivedCommand.input.Range, undefined);

    mock.reset();
  });

  it("forwards a Range header and reports 206, for video citations that seek to a timestamp", async () => {
    resetS3ClientForTests();

    let receivedCommand;

    mock.method(S3Client.prototype, "send", async (command) => {
      receivedCommand = command;

      return {
        Body: Readable.from(["partial bytes"]),
        ContentType: "video/mp4",
        ContentLength: 1024,
        ContentRange: "bytes 1000-2023/500000",
      };
    });

    const result = await getObject("clip.mp4", { range: "bytes=1000-2023" });

    assert.equal(result.statusCode, 206);
    assert.equal(result.contentRange, "bytes 1000-2023/500000");
    assert.equal(receivedCommand.input.Range, "bytes=1000-2023");

    mock.reset();
  });
});
