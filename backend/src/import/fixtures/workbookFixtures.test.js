import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { runImportScan } from "../services/importPipeline.js";
import {
  ambiguousSparseSheetFixture,
  ambiguousSourceRangeFixture,
  cleanStandardTableFixture,
  createAmbiguousSourceRangeWorkbook,
  createAmbiguousSparseSheetWorkbook,
  createCleanStandardTableWorkbook,
  createHighConfidenceAutoBoxWorkbook,
  createLowConfidenceManualBoxWorkbook,
  createMultiSheetOneValidSourceRangeWorkbook,
  createReactionRateSupplementWorkbookForExperiment,
  createRepeatedBlockTableWorkbook,
  highConfidenceAutoBoxFixture,
  lowConfidenceManualBoxFixture,
  multiSheetOneValidSourceRangeFixture,
  repeatedBlockTableFixture,
} from "./workbookFixtures.js";
import {
  chartLocalAcceptedSourceExtractScenario,
  importCorrectionExamples,
  missingExperimentPromptScenario,
  syntheticWorkflowScenarios,
} from "./workflowScenarioFixtures.js";

test("clean standard table fixture scans as one standard table block", () => {
  const result = runImportScan(createCleanStandardTableWorkbook());
  const sheet = result.sheets[0];
  const block = sheet.blocks[0];

  assert.equal(result.file.name, cleanStandardTableFixture.filename);
  assert.equal(result.summary.sheetCount, 1);
  assert.equal(result.summary.blockCount, 1);
  assert.equal(sheet.name, cleanStandardTableFixture.sheetName);
  assert.equal(sheet.usedRange, "A1:E4");
  assert.equal(sheet.layout.type, "standard_table");
  assert.equal(sheet.layout.confidence >= 0.85, true);
  assert.equal(sheet.candidateHeaders.length, 1);
  assert.equal(sheet.candidateHeaders[0].range, "A1:E1");
  assert.equal(sheet.candidateHeaders[0].columns[1].unit, "C");
  assert.equal(sheet.candidateHeaders[0].columns[2].unit, "min");
  assert.equal(sheet.candidateHeaders[0].columns[3].unit, "%");
  assert.equal(block.type, "standard_table");
  assert.equal(block.range, "A1:E4");
  assert.equal(block.table.columns.length, 5);
  assert.equal(block.table.rows.length, 3);
  assert.equal(block.table.rows[2].values[3].value, 41.2);
  assert.equal(block.table.rows[2].values[3].source.sheet, cleanStandardTableFixture.sheetName);
  assert.equal(block.table.rows[2].values[3].source.cell, "D4");
  assert.deepEqual(sheet.warnings, []);
});

test("repeated block table fixture scans as two experiment blocks", () => {
  const result = runImportScan(createRepeatedBlockTableWorkbook());
  const sheet = result.sheets[0];

  assert.equal(result.file.name, repeatedBlockTableFixture.filename);
  assert.equal(result.summary.sheetCount, 1);
  assert.equal(result.summary.blockCount, 2);
  assert.equal(sheet.name, repeatedBlockTableFixture.sheetName);
  assert.equal(sheet.usedRange, "A1:D12");
  assert.equal(sheet.layout.type, "block_table");
  assert.equal(sheet.regions.length, 2);
  assert.equal(sheet.candidateHeaders.length, 2);
  assert.equal(sheet.candidateMetadata.length, 2);

  assert.equal(sheet.blocks[0].type, "experiment_block");
  assert.equal(sheet.blocks[0].range, "A1:D5");
  assert.equal(sheet.blocks[0].title.value, "Experiment A");
  assert.equal(sheet.blocks[0].metadata[0].rawKey, "Temperature");
  assert.equal(sheet.blocks[0].metadata[0].parsedValue, 80);
  assert.equal(sheet.blocks[0].metadata[0].unit, "C");
  assert.equal(sheet.blocks[0].table.rows.length, 2);
  assert.equal(sheet.blocks[0].table.rows[1].values[1].value, 24.5);
  assert.equal(sheet.blocks[0].table.rows[1].values[1].source.blockId, "sheet_1_block_1");

  assert.equal(sheet.blocks[1].range, "A8:D12");
  assert.equal(sheet.blocks[1].title.value, "Experiment B");
  assert.equal(sheet.blocks[1].metadata[0].parsedValue, 90);
  assert.equal(sheet.blocks[1].table.rows[1].values[1].value, 36.2);
  assert.equal(sheet.blocks[1].table.rows[1].values[1].source.cell, "B12");
  assert.deepEqual(sheet.warnings, []);
});

test("ambiguous sparse sheet fixture scans as unknown without invented table rows", () => {
  const result = runImportScan(createAmbiguousSparseSheetWorkbook());
  const sheet = result.sheets[0];
  const block = sheet.blocks[0];

  assert.equal(result.file.name, ambiguousSparseSheetFixture.filename);
  assert.equal(result.summary.sheetCount, 1);
  assert.equal(result.summary.blockCount, 1);
  assert.equal(sheet.name, ambiguousSparseSheetFixture.sheetName);
  assert.equal(sheet.usedRange, "A1:A4");
  assert.equal(sheet.layout.type, "unknown");
  assert.equal(sheet.candidateHeaders.length, 0);
  assert.equal(sheet.candidateMetadata.length, 0);
  assert.equal(block.type, "unknown_region");
  assert.equal(block.range, "A1:A4");
  assert.equal(block.table, null);
  assert.equal(block.candidateHeaders.length, 0);
  assert.equal(block.candidateMetadata.length, 0);
  assert.equal(sheet.warnings[0].code, "unknown_layout");
  assert.equal(block.warnings[0].code, "unknown_layout");
});

test("multi-sheet source range fixture has exactly one valid carbon distribution sheet", () => {
  const workbook = XLSX.read(createMultiSheetOneValidSourceRangeWorkbook().buffer, { type: "buffer" });
  const validSheet = workbook.Sheets[multiSheetOneValidSourceRangeFixture.validSheetName];
  const invalidSheet = workbook.Sheets[multiSheetOneValidSourceRangeFixture.invalidSheetName];

  assert.equal(workbook.SheetNames.includes(multiSheetOneValidSourceRangeFixture.validSheetName), true);
  assert.equal(validSheet.Q31.v, "C1");
  assert.equal(validSheet.Q32.v, multiSheetOneValidSourceRangeFixture.expectedValues[0]);
  assert.notEqual(invalidSheet.Q31.v, "C1");
});

test("ambiguous source range fixture has two valid candidate sheets", () => {
  const workbook = XLSX.read(createAmbiguousSourceRangeWorkbook().buffer, { type: "buffer" });

  assert.deepEqual(workbook.SheetNames, ambiguousSourceRangeFixture.validSheetNames);
  ambiguousSourceRangeFixture.validSheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    assert.equal(sheet.Q31.v, "C1");
    assert.equal(typeof sheet.Q32.v, "number");
  });
});

test("high-confidence auto-box fixture scans as a regular table candidate", () => {
  const result = runImportScan(createHighConfidenceAutoBoxWorkbook());
  const sheet = result.sheets[0];

  assert.equal(result.file.name, highConfidenceAutoBoxFixture.filename);
  assert.equal(sheet.layout.type, "standard_table");
  assert.equal(sheet.layout.confidence >= highConfidenceAutoBoxFixture.expectedDraftRegions[0].confidenceAtLeast, true);
  assert.equal(sheet.blocks[0].range, highConfidenceAutoBoxFixture.expectedDraftRegions[0].range);
});

test("low-confidence manual-box fixture keeps user-selected source ranges available", () => {
  const workbook = XLSX.read(createLowConfidenceManualBoxWorkbook().buffer, { type: "buffer" });
  const sheet = workbook.Sheets[lowConfidenceManualBoxFixture.sheetName];

  assert.equal(sheet.Q31.v, "C1?");
  assert.equal(sheet.Q32.v, 0.1);
  assert.equal(lowConfidenceManualBoxFixture.manualSelections.length, 2);
  assert.equal(lowConfidenceManualBoxFixture.manualSelections[0].range, "P31:BA32");
  assert.equal(lowConfidenceManualBoxFixture.manualSelections[1].expectedClarification, "region_description_required");
});

test("reaction-rate supplement fixtures can be generated for multiple experiments", () => {
  const exp33 = createReactionRateSupplementWorkbookForExperiment({ expNumber: 33, rateScale: 1 });
  const exp34 = createReactionRateSupplementWorkbookForExperiment({ expNumber: 34, rateScale: 1.2 });
  const exp35 = createReactionRateSupplementWorkbookForExperiment({ expNumber: 35, rateScale: 1.4 });

  assert.equal(exp33.filename, "Reaction_Rate_Exp33.xlsx");
  assert.equal(exp34.filename, "Reaction_Rate_Exp34.xlsx");
  assert.equal(exp35.filename, "Reaction_Rate_Exp35.xlsx");
  assert.equal(XLSX.read(exp35.buffer, { type: "buffer" }).SheetNames[0], "Exp35");
});

test("synthetic workflow scenarios cover source-backed charts and missing experiment expectations", () => {
  assert.equal(chartLocalAcceptedSourceExtractScenario.expectedNext.dataPlanInputType, "accepted_source_extract");
  assert.equal(missingExperimentPromptScenario.expected.mustNotUseExperimentAliases.includes("Exp33"), true);
  assert.equal(importCorrectionExamples.some((example) => example.expectedPatchType === "experiment_binding"), true);
  assert.equal(JSON.stringify(syntheticWorkflowScenarios).includes("DatasetCommit"), false);
  assert.equal(syntheticWorkflowScenarios.length >= 6, true);
});
