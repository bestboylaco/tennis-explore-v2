import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateChatQuestion } from "../../src/modules/chat/validators/chat.validation.js";

function mockReqRes(body) {
  const req = { body };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  return { req, res };
}

describe("validating the effort field", () => {
  it("accepts a request with no effort at all (older clients keep working)", () => {
    const { req, res } = mockReqRes({ question: "How fast do men serve?" });
    let nextCalled = false;

    validateChatQuestion(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });

  it("accepts \"low\" and \"high\"", () => {
    for (const effort of ["low", "high"]) {
      const { req, res } = mockReqRes({ question: "How fast do men serve?", effort });
      let nextCalled = false;

      validateChatQuestion(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, `effort "${effort}" should pass validation`);
      assert.equal(res.statusCode, null);
    }
  });

  it("rejects anything else, e.g. a client trying to name a model or route", () => {
    const { req, res } = mockReqRes({ question: "How fast do men serve?", effort: "maximum" });
    let nextCalled = false;

    validateChatQuestion(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error.details.some((detail) => detail.field === "effort"));
  });
});
