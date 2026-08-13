import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ruleBasedPlan } from "../../src/modules/query/queryPlanner.service.js";
import { ROUTE_FOR_INTENT, ROUTES } from "../../src/shared/constants/queryTaxonomy.js";

const routeOf = (question) => ROUTE_FOR_INTENT[ruleBasedPlan(question).intent];

describe("route selection", () => {
  it("keeps counting words about a paper on the document route", () => {
    // the failure this exists for: "how many strokes were coded in the PhD
    // study" contains "how many", so it was classified as an aggregation, sent
    // to the tables, found no matching column and abstained. a question we can
    // answer came back as "the knowledge base does not contain an answer".
    //
    // a number reported in a study is a fact stated in that study, not a
    // calculation over records.
    assert.equal(routeOf("How many strokes were manually coded in the PhD study?"), ROUTES.UNSTRUCTURED);
    assert.equal(
      routeOf("How many female players were recruited for the Whiteside 2013 study?"),
      ROUTES.UNSTRUCTURED,
    );
    assert.equal(
      routeOf("What percentage of a year's training is disrupted by a lumbar stress fracture?"),
      ROUTES.UNSTRUCTURED,
    );
  });

  it("still sends real calculations to the tables", () => {
    assert.equal(routeOf("how many matches were played on each surface?"), ROUTES.STRUCTURED);
    assert.equal(routeOf("what is the median singles ranking per month?"), ROUTES.STRUCTURED);
    assert.equal(routeOf("compare wins on hard versus clay"), ROUTES.STRUCTURED);
  });

  it("sends questions about authorship to the documents", () => {
    assert.equal(routeOf("Who were the authors of the first Cardio Tennis publication?"), ROUTES.UNSTRUCTURED);
  });
});
