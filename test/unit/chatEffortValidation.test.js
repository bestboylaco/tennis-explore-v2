import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateChatQuestion } from "../../src/modules/chat/validators/chat.validation.js";

/**
 * validateChatQuestion is Express middleware. These helpers let it run
 * against a plain object instead of a real request/response, the same way
 * chat.validation.js's existing fields (evidence, conversationId) would be
 * tested if there were a test file for them already.
 */
function runValidation(body) {
  const req = { body: { ...body } };
  let statusCode = null;
  let jsonBody = null;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      jsonBody = payload;
      return this;
    },
  };

  validateChatQuestion(req, res, () => {
    nextCalled = true;
  });

  return { req, statusCode, jsonBody, nextCalled };
}

describe("chat.validation.js -- effort parameter (TENISE-68)", () => {
  it("accepts a request with no effort at all, exactly as before this parameter existed", () => {
    const { nextCalled, statusCode, req } = runValidation({ question: "how many matches were played on clay?" });

    assert.equal(nextCalled, true);
    assert.equal(statusCode, null);
    assert.equal(req.body.effort, undefined);
  });

  it("accepts \"low\"", () => {
    const { nextCalled, req } = runValidation({ question: "what is the score", effort: "low" });

    assert.equal(nextCalled, true);
    assert.equal(req.body.effort, "low");
  });

  it("accepts \"high\"", () => {
    const { nextCalled, req } = runValidation({ question: "summarise the recovery research", effort: "high" });

    assert.equal(nextCalled, true);
    assert.equal(req.body.effort, "high");
  });

  it("normalises case and surrounding whitespace rather than rejecting them", () => {
    // the frontend's debug override (public/scripts/config.js) reads a raw
    // URL query parameter, so the server doing its own normalisation is what
    // keeps "?effort=Low" from becoming a confusing 400.
    const { nextCalled, req } = runValidation({ question: "what is the score", effort: "  LOW  " });

    assert.equal(nextCalled, true);
    assert.equal(req.body.effort, "low");
  });

  it("rejects an effort level that is not low or high", () => {
    const { nextCalled, statusCode, jsonBody } = runValidation({
      question: "what is the score",
      effort: "maximum",
    });

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
    assert.equal(jsonBody.success, false);
    assert.ok(jsonBody.error.details.some((detail) => detail.field === "effort"));
  });

  it("rejects a non-string effort", () => {
    const { nextCalled, statusCode, jsonBody } = runValidation({ question: "what is the score", effort: 2 });

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
    assert.ok(jsonBody.error.details.some((detail) => detail.field === "effort"));
  });

  it("rejects an empty-string effort rather than silently treating it as omitted", () => {
    const { nextCalled, statusCode } = runValidation({ question: "what is the score", effort: "" });

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
  });

  it("still enforces the existing question rule when effort is also invalid", () => {
    // both problems should be reported, not just whichever the validator
    // happens to check first -- same pattern the file already uses for
    // question + conversationId together.
    const { jsonBody } = runValidation({ question: "", effort: "maximum" });

    const fields = jsonBody.error.details.map((detail) => detail.field);

    assert.ok(fields.includes("question"));
    assert.ok(fields.includes("effort"));
  });

  it("does not require a caller to choose an effort level", () => {
    // mirrors the file's own stated rule: users must not be REQUIRED to
    // select a mode. effort is optional, same as evidence/conversationId.
    const { nextCalled } = runValidation({ question: "what is the score" });

    assert.equal(nextCalled, true);
  });
});
