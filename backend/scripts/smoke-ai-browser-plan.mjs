import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import { createBackendModelProvider } from "../src/saas/backendModelProvider.js";
import { loadSaasConfig } from "../src/saas/config.js";

const SMOKE_REVISION_ID = "smoke_browser_region_revision_1";
const SMOKE_SOURCE_ID = "smoke_browser_source_document_1";
const SMOKE_SHEET_NAME = "Synthetic Experiments";
const SMOKE_RANGE = "A1:Y63";
const FULL_RANGE = XLSX.utils.decode_range(SMOKE_RANGE);

const HEADERS = [
  "Experiment",
  "Catalyst",
  "Polymer",
  "Temperature",
  "Pressure",
  "Reaction time",
  "Solvent",
  "Catalyst loading",
  "Polymer mass",
  "Liquid yield",
  "Gas yield",
  "Solid yield",
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "C8",
  "C9",
  "C10",
  "C11",
  "C12+",
  "Notes",
];

const UNITS = [
  "",
  "",
  "",
  "degC",
  "bar",
  "h",
  "",
  "wt%",
  "g",
  "wt%",
  "wt%",
  "wt%",
  ...Array(12).fill("area%"),
  "",
];

function experimentRow(index) {
  const distribution = Array.from({ length: 12 }, (_, offset) => (
    Number((((index + offset + 1) % 17) / 10).toFixed(2))
  ));
  return [
    `Exp${index}`,
    index % 2 ? "Ru/C" : "Pt/C",
    index % 3 ? "HDPE" : "LDPE",
    240 + (index % 8) * 10,
    5 + (index % 4),
    2 + (index % 6),
    index % 2 ? "none" : "water",
    1 + (index % 5) * 0.25,
    1 + (index % 7) * 0.5,
    45 + (index % 10),
    20 + (index % 9),
    5 + (index % 6),
    ...distribution,
    `Synthetic run ${index}`,
  ];
}

const MATRIX = [
  HEADERS,
  UNITS,
  ...Array.from({ length: 61 }, (_, index) => experimentRow(index + 1)),
];

function cellAt(row, col) {
  const rawValue = MATRIX[row]?.[col] ?? null;
  return {
    address: XLSX.utils.encode_cell({ r: row, c: col }),
    row,
    col,
    rawValue,
    formattedValue: rawValue == null ? null : String(rawValue),
    type: rawValue == null ? "blank" : typeof rawValue === "number" ? "number" : "string",
    formula: null,
    merged: false,
    mergedRange: null,
  };
}

function rangeInspection(range) {
  const decoded = XLSX.utils.decode_range(String(range || ""));
  assert.ok(decoded.s.r >= FULL_RANGE.s.r && decoded.s.c >= FULL_RANGE.s.c, "inspection started outside the confirmed range");
  assert.ok(decoded.e.r <= FULL_RANGE.e.r && decoded.e.c <= FULL_RANGE.e.c, "inspection ended outside the confirmed range");
  const rowCount = decoded.e.r - decoded.s.r + 1;
  const columnCount = decoded.e.c - decoded.s.c + 1;
  const cellCount = rowCount * columnCount;
  assert.ok(cellCount <= 2500, "inspection exceeded the analysis range limit");

  const rows = [];
  const cells = [];
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    const outputRow = [];
    for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
      const cell = cellAt(row, col);
      outputRow.push(cell);
      cells.push(cell);
    }
    rows.push(outputRow);
  }

  const normalizedRange = XLSX.utils.encode_range(decoded);
  return {
    schemaVersion: "labrat.sourceRange.v1",
    sourceDocumentId: SMOKE_SOURCE_ID,
    sheetName: SMOKE_SHEET_NAME,
    range: normalizedRange,
    rowCount,
    columnCount,
    cellCount,
    cells,
    rows,
    sourceRef: {
      sourceType: "excel_range",
      sourceDocumentId: SMOKE_SOURCE_ID,
      fileObjectId: null,
      importRunId: null,
      sheet: SMOKE_SHEET_NAME,
      range: normalizedRange,
    },
    warnings: [],
  };
}

function safeProviderFailure(result) {
  const code = result?.warning?.code || "unknown_error";
  const message = result?.warning?.message || "Provider request failed.";
  const metadata = result?.metadata || {};
  throw new Error([
    `Experiment Browser planning failed (${code}): ${message}`,
    `attempts=${Number(metadata.attemptCount) || 0}`,
    `finalBudget=${Number(metadata.finalRequestedMaxTokens) || 0}`,
    `stopReason=${String(metadata.stopReason || "unknown")}`,
  ].join("; "));
}

async function run() {
  const config = loadSaasConfig(process.env);
  const modelProvider = createBackendModelProvider({ config });
  const capability = modelProvider.publicConfig();
  assert.equal(capability.provider, "deepseek", "LABRAT_AI_PROVIDER must select deepseek for this smoke test");
  assert.equal(capability.model, "deepseek-v4-pro");
  assert.equal(capability.configured, true, "DEEPSEEK_API_KEY is not configured");

  const inspectedRanges = [];
  const plan = await modelProvider.draftExperimentBrowserPlan({
    project: {
      name: "Disposable A1:Y63 provider smoke",
      description: "Synthetic plastic depolymerization experiments for provider acceptance only.",
      projectProfile: {},
    },
    originalRequest: [
      "Add all 61 confirmed experiment rows and their source fields to Experiment Browser.",
      `Before drafting, call inspect_source_range exactly once for ${SMOKE_RANGE}; do not split or shorten the range.`,
      "Preserve the source fields and describe a reviewable publication plan without calculating new values.",
    ].join(" "),
    outputTarget: "experiment_browser",
    feedback: null,
    reviewContext: null,
    priorRevisions: [],
    confirmedRegions: [{
      regionUnderstandingRevisionId: SMOKE_REVISION_ID,
      regionId: "smoke_browser_region_1",
      sourceDocumentId: SMOKE_SOURCE_ID,
      workbookName: "synthetic-a1-y63.xlsx",
      sheetName: SMOKE_SHEET_NAME,
      range: SMOKE_RANGE,
      semanticType: "experiment_table",
      experimentAxis: "rows",
      experimentLabel: null,
      experimentIdColumn: "A",
      headerRow: 1,
      inclusion: { startRow: 3, endRow: 63 },
      summary: [
        "The confirmed range contains 61 synthetic experiment rows.",
        "Column A contains Exp1 through Exp61 identifiers.",
        "Columns B through Y contain source-backed conditions, outcomes, carbon distributions, and notes.",
      ],
      fields: HEADERS.slice(1).map((displayName, index) => ({
        column: XLSX.utils.encode_col(index + 1),
        semanticKey: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        displayName,
        role: index < 8 ? "condition" : "outcome",
        valueType: [0, 1, 5, 23].includes(index) ? "string" : "number",
        unit: UNITS[index + 1] || null,
        sourceRefs: [],
      })),
      series: [],
    }],
    activeExperimentCatalog: {
      schemaVersion: "labrat.activeExperimentCatalog.v1",
      experiments: [],
    },
  }, {
    inspectSourceRange: async ({ regionUnderstandingRevisionId, range }) => {
      assert.equal(regionUnderstandingRevisionId, SMOKE_REVISION_ID);
      inspectedRanges.push(XLSX.utils.encode_range(XLSX.utils.decode_range(range)));
      return rangeInspection(range);
    },
  });

  if (!plan.ok) safeProviderFailure(plan);
  assert.ok(inspectedRanges.includes(SMOKE_RANGE), `provider did not inspect the full ${SMOKE_RANGE} range`);
  assert.ok(Number(plan.metadata?.toolRounds) > 0, "provider metadata did not record a tool round");
  assert.notEqual(plan.metadata?.stopReason, "length", "provider output remained truncated");
  assert.equal(plan.metadata?.requestedMaxTokens, 16000);
  assert.ok([16000, 32000].includes(plan.metadata?.finalRequestedMaxTokens));
  assert.ok(plan.sourceSelections.some((selection) => (
    selection.regionUnderstandingRevisionId === SMOKE_REVISION_ID
      && selection.sourceDocumentId === SMOKE_SOURCE_ID
  )), "reviewed plan did not preserve the confirmed source identity");

  console.log(JSON.stringify({
    capability,
    workload: {
      range: SMOKE_RANGE,
      rowCount: MATRIX.length,
      columnCount: HEADERS.length,
      duplicatedCellObjectCount: MATRIX.length * HEADERS.length * 2,
    },
    reviewedPlan: {
      inspectionCalls: inspectedRanges.length,
      toolRounds: plan.metadata.toolRounds,
      attemptCount: plan.metadata.attemptCount,
      requestedMaxTokens: plan.metadata.requestedMaxTokens,
      finalRequestedMaxTokens: plan.metadata.finalRequestedMaxTokens,
      stopReason: plan.metadata.stopReason || null,
      usage: plan.metadata.usage,
      sourceSelectionCount: plan.sourceSelections.length,
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(`Experiment Browser AI smoke test failed: ${error?.message || "unknown error"}`);
  process.exitCode = 1;
});
