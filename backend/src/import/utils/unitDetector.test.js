import assert from "node:assert/strict";
import { test } from "node:test";
import { detectUnitFromLabel, detectUnitFromValue } from "./unitDetector.js";

test("detectUnitFromLabel extracts parenthetical units", () => {
  assert.deepEqual(detectUnitFromLabel("Time (min)"), {
    label: "Time",
    unit: "min",
    rawLabel: "Time (min)",
  });
});

test("detectUnitFromLabel extracts slash and percent units", () => {
  assert.equal(detectUnitFromLabel("Temperature / C").unit, "C");
  assert.deepEqual(detectUnitFromLabel("Conversion %"), {
    label: "Conversion",
    unit: "%",
    rawLabel: "Conversion %",
  });
});

test("detectUnitFromLabel extracts bracket units and preserves no-unit labels", () => {
  assert.deepEqual(detectUnitFromLabel("Pressure [bar]"), {
    label: "Pressure",
    unit: "bar",
    rawLabel: "Pressure [bar]",
  });
  assert.deepEqual(detectUnitFromLabel("  Catalyst loading  "), {
    label: "Catalyst loading",
    unit: null,
    rawLabel: "Catalyst loading",
  });
});

test("detectUnitFromValue extracts simple numeric value units", () => {
  assert.deepEqual(detectUnitFromValue("80 C"), {
    parsedValue: 80,
    unit: "C",
    rawValue: "80 C",
  });
});

test("detectUnitFromValue extracts signed decimals and rejects unsupported values", () => {
  assert.deepEqual(detectUnitFromValue("-1.5 bar"), {
    parsedValue: -1.5,
    unit: "bar",
    rawValue: "-1.5 bar",
  });
  assert.deepEqual(detectUnitFromValue("80"), {
    parsedValue: null,
    unit: null,
    rawValue: "80",
  });
  assert.deepEqual(detectUnitFromValue("1e-3 M/s"), {
    parsedValue: null,
    unit: null,
    rawValue: "1e-3 M/s",
  });
});
