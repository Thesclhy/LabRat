import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySheetLayout } from "./layoutClassifier.js";

test("classifySheetLayout detects standard_table", () => {
  const layout = classifySheetLayout({
    regions: [{ numericCellCount: 4 }],
    candidateHeaders: [{ columns: [{ label: "Experiment" }, { label: "Time" }] }],
    candidateMetadata: [],
  });
  assert.equal(layout.type, "standard_table");
  assert.ok(layout.confidence >= 0.6);
});

test("classifySheetLayout detects block_table", () => {
  const layout = classifySheetLayout({
    regions: [{ numericCellCount: 3 }, { numericCellCount: 3 }],
    candidateHeaders: [
      { columns: [{ label: "Time" }, { label: "Conversion" }] },
      { columns: [{ label: "Time" }, { label: "Conversion" }] },
    ],
    candidateMetadata: [{ rawKey: "Temperature" }, { rawKey: "Pressure" }],
  });
  assert.equal(layout.type, "block_table");
  assert.ok(layout.reasons.includes("repeated similar header rows detected"));
});

test("classifySheetLayout detects repeated headers using raw names", () => {
  const layout = classifySheetLayout({
    regions: [{ numericCellCount: 2 }, { numericCellCount: 2 }],
    candidateHeaders: [
      { columns: [{ rawName: "Time" }, { rawName: "Conversion" }] },
      { columns: [{ rawName: "time" }, { rawName: "conversion" }] },
    ],
    candidateMetadata: [],
  });

  assert.equal(layout.type, "block_table");
  assert.equal(layout.confidence >= 0.8, true);
});

test("classifySheetLayout falls back to unknown conservatively", () => {
  const layout = classifySheetLayout({
    regions: [{ numericCellCount: 0 }],
    candidateHeaders: [],
    candidateMetadata: [],
  });
  assert.equal(layout.type, "unknown");
});

test("classifySheetLayout does not classify weak block signals", () => {
  const layout = classifySheetLayout({
    regions: [{ numericCellCount: 0 }, { numericCellCount: 0 }],
    candidateHeaders: [],
    candidateMetadata: [{ rawKey: "Temperature" }],
  });

  assert.equal(layout.type, "unknown");
  assert.equal(layout.confidence, 0.25);
});

test("classifySheetLayout does not classify numeric sparse sheets as standard without a header", () => {
  const layout = classifySheetLayout({
    regions: [{ numericCellCount: 2 }],
    candidateHeaders: [],
    candidateMetadata: [],
  });
  assert.equal(layout.type, "unknown");
});
