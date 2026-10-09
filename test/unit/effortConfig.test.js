import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_EFFORT_LEVELS,
  EFFORT_LEVELS,
  applyEffortToTopN,
  resolveEffortOverrides,
} from "../../src/config/effort.config.js";

describe("effort levels (TENISE-68)", () => {
  it("exposes exactly two levels", () => {
    // the ticket asks for a tradeoff between speed and thoroughness, not a
    // choice among several -- see effort.config.js's comment on why a third
    // "balanced" tier was not added.
    assert.deepEqual([...ALL_EFFORT_LEVELS].sort(), ["high", "low"]);
    assert.equal(EFFORT_LEVELS.LOW, "low");
    assert.equal(EFFORT_LEVELS.HIGH, "high");
  });
});

describe("resolveEffortOverrides", () => {
  it("low turns off every optional model-call stage", () => {
    const overrides = resolveEffortOverrides("low");

    assert.equal(overrides.decompositionEnabled, false);
    assert.equal(overrides.expansionEnabled, false);
    assert.equal(overrides.rerankEnabled, false);
    assert.ok(overrides.topNScale < 1, "low must narrow the evidence window");
  });

  it("high turns on every optional stage and widens the window", () => {
    const overrides = resolveEffortOverrides("high");

    assert.equal(overrides.decompositionEnabled, true);
    assert.equal(overrides.expansionEnabled, true);
    assert.equal(overrides.rerankEnabled, true);
    assert.ok(overrides.topNScale > 1, "high must widen the evidence window");
  });

  it("low is strictly cheaper than high on every shared knob", () => {
    const low = resolveEffortOverrides("low");
    const high = resolveEffortOverrides("high");

    assert.ok(low.topNScale < high.topNScale);
  });

  // backward compatibility (point 2 of the ticket's "done" list): omitting
  // effort, or passing something this function has never heard of, must not
  // override anything -- every call site reads a field off this object with
  // `?? retrievalConfig...`, so an empty object is what makes "no effort
  // passed" behave exactly as it did before this feature existed.
  it("returns no overrides when effort is omitted", () => {
    assert.deepEqual(resolveEffortOverrides(undefined), {});
  });

  it("returns no overrides for null", () => {
    assert.deepEqual(resolveEffortOverrides(null), {});
  });

  it("returns no overrides for an unrecognised value", () => {
    assert.deepEqual(resolveEffortOverrides("ludicrous-speed"), {});
  });

  it("is case-sensitive -- normalisation is chat.validation.js's job, not this one's", () => {
    assert.deepEqual(resolveEffortOverrides("LOW"), {});
  });
});

describe("applyEffortToTopN", () => {
  it("leaves topN untouched when there is no scale (default behaviour)", () => {
    assert.equal(applyEffortToTopN(8, {}), 8);
    assert.equal(applyEffortToTopN(20, undefined), 20);
  });

  it("narrows topN under low", () => {
    const overrides = resolveEffortOverrides("low");

    assert.ok(applyEffortToTopN(10, overrides) < 10);
  });

  it("widens topN under high", () => {
    const overrides = resolveEffortOverrides("high");

    assert.ok(applyEffortToTopN(10, overrides) > 10);
  });

  it("never scales below 1, however small the input or the scale", () => {
    assert.equal(applyEffortToTopN(1, { topNScale: 0.1 }), 1);
    assert.equal(applyEffortToTopN(0, { topNScale: 0.5 }), 1);
  });

  it("ignores a non-numeric scale rather than producing NaN", () => {
    assert.equal(applyEffortToTopN(10, { topNScale: "low" }), 10);
    assert.equal(applyEffortToTopN(10, { topNScale: Number.NaN }), 10);
  });
});
