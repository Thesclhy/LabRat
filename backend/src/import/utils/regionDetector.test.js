import assert from "node:assert/strict";
import { test } from "node:test";
import { detectRegions } from "./regionDetector.js";

function cell(row, col, rawValue, type = "string") {
  return { row, col, rawValue, type };
}

test("detectRegions summarizes a contiguous table", () => {
  const regions = detectRegions({
    cells: [
      cell(1, 1, "Experiment"),
      cell(1, 2, "Time"),
      cell(2, 1, "Exp1"),
      cell(2, 2, 10, "number"),
    ],
  });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].range, "A1:B2");
  assert.equal(regions[0].nonEmptyCellCount, 4);
  assert.equal(regions[0].textCellCount, 3);
  assert.equal(regions[0].numericCellCount, 1);
});

test("detectRegions allows a small blank row gap", () => {
  const regions = detectRegions({
    cells: [
      cell(1, 1, "Experiment 1"),
      cell(3, 1, "Time"),
      cell(3, 2, "Conversion"),
    ],
  }, { maxBlankGap: 1 });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].range, "A1:B3");
});

test("detectRegions separates distant blocks", () => {
  const regions = detectRegions({
    cells: [
      cell(1, 1, "Experiment 1"),
      cell(2, 1, "Time"),
      cell(8, 1, "Experiment 2"),
      cell(9, 1, "Time"),
    ],
  }, { maxBlankGap: 1 });
  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map((region) => region.range), ["A1:A2", "A8:A9"]);
});

test("detectRegions returns no regions for empty input", () => {
  assert.deepEqual(detectRegions({ cells: [] }), []);
  assert.deepEqual(detectRegions(null), []);
});

test("detectRegions sorts regions and assigns stable region ids", () => {
  const regions = detectRegions({
    cells: [
      cell(8, 3, "late"),
      cell(1, 2, "early"),
      cell(8, 4, 3, "number"),
      cell(1, 1, "first"),
    ],
  }, { maxBlankGap: 0 });

  assert.deepEqual(regions.map((region) => region.regionId), ["region_1", "region_2"]);
  assert.deepEqual(regions.map((region) => region.range), ["A1:B1", "C8:D8"]);
  assert.equal(regions[1].numericCellCount, 1);
});

test("detectRegions respects strict maxBlankGap", () => {
  const regions = detectRegions({
    cells: [
      cell(1, 1, "Experiment 1"),
      cell(3, 1, "Time"),
    ],
  }, { maxBlankGap: 0 });

  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map((region) => region.range), ["A1", "A3"]);
});
