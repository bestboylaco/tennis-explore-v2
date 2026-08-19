import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ruleBasedPlan } from "../../src/modules/query/queryPlanner.service.js";
import { INTENTS, ROUTE_FOR_INTENT, ROUTES } from "../../src/shared/constants/queryTaxonomy.js";

describe("rule based routing", () => {
  it("sends a calculation over records to the structured route", () => {
    // the failure that matters: an aggregation answered by retrieval returns a
    // confident, wrong number, because no chunk contains a median.
    const plan = ruleBasedPlan("what is the median change in serve speeds year on year in the mens and womens draws?");

    assert.equal(ROUTE_FOR_INTENT[plan.intent], ROUTES.STRUCTURED);
  });

  it("handles plural table vocabulary", () => {
    // regression: an earlier version matched "serve speed" but not "serve
    // speeds", which sent the partner's own example question to the documents.
    const plan = ruleBasedPlan("average serve speeds by year");

    assert.equal(ROUTE_FOR_INTENT[plan.intent], ROUTES.STRUCTURED);
  });

  it("treats a single-entity superlative as a lookup, not an aggregation", () => {
    const plan = ruleBasedPlan("what is Player X's best ranking");

    assert.equal(plan.intent, INTENTS.ANALYTICAL);
  });

  it("routes a superlative to the planner rather than deciding alone", () => {
    // "best ranking" for one player and "highest beep test result" across a
    // squad use identical words. the rules must not settle that on their own.
    const plan = ruleBasedPlan("who had the highest beep test result");

    assert.ok(plan.confidence < 0.8, "should be under the floor so the planner is consulted");
  });

  it("recognises a summary request", () => {
    assert.equal(ruleBasedPlan("summarise the recovery research for tennis players").intent, INTENTS.SUMMARISATION);
  });

  it("recognises a question spanning two documents", () => {
    assert.equal(
      ruleBasedPlan("how do the findings of the periodisation paper compare with the catapult presentation").intent,
      INTENTS.MULTI_HOP,
    );
  });

  it("sends a question about a paper to the documents", () => {
    const plan = ruleBasedPlan("who were the authors of the cardio tennis publication");

    assert.equal(ROUTE_FOR_INTENT[plan.intent], ROUTES.UNSTRUCTURED);
  });

  it("reports low confidence when it genuinely cannot tell", () => {
    const plan = ruleBasedPlan("what are the differences between a platform and a step up stance in the serve");

    assert.ok(plan.confidence < 0.5);
  });
});
