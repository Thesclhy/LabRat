import assert from "node:assert/strict";
import { test } from "node:test";
import { clampConfidence, confidenceFromSignals, confidenceResult } from "./confidence.js";

test("clampConfidence bounds and rounds scores", () => {
  assert.equal(clampConfidence(-1), 0);
  assert.equal(clampConfidence(1.5), 0.99);
  assert.equal(clampConfidence(0.876), 0.88);
});

test("confidenceResult normalizes reasons", () => {
  assert.deepEqual(confidenceResult(0.5, ["a", "", "b"]), {
    confidence: 0.5,
    reasons: ["a", "b"],
  });
});

test("confidenceFromSignals sums active weights and reasons", () => {
  assert.deepEqual(confidenceFromSignals([
    { active: true, weight: 0.3, reason: "header row found" },
    { active: false, weight: 0.9, reason: "ignored" },
    { active: true, weight: 0.25, reason: "numeric data below" },
  ]), {
    confidence: 0.55,
    reasons: ["header row found", "numeric data below"],
  });
});
