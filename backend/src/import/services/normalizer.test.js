import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAmbiguousSparseSheetWorkbook,
  createCleanStandardTableWorkbook,
  createRepeatedBlockTableWorkbook,
} from "../fixtures/workbookFixtures.js";
import { runImportScan } from "./importPipeline.js";
import { normalizeApprovedScan } from "./normalizer.js";

test("normalizeApprovedScan converts approved standard table rows to generic experiments and measurements", () => {
  const scanResult = runImportScan(createCleanStandardTableWorkbook());
  const blockId = scanResult.sheets[0].blocks[0].blockId;
  const response = normalizeApprovedScan({
    scanResult,
    approvedBlockIds: [blockId],
    userEdits: { createdAt: "2026-06-08T00:00:00.000Z" },
  });

  assert.equal(response.schemaVersion, "labrat.importNormalize.v1");
  assert.equal(response.datasetPatch.genericImports.length, 1);

  const genericImport = response.datasetPatch.genericImports[0];
  assert.equal(genericImport.schemaVersion, "labrat.genericImport.v1");
  assert.equal(genericImport.fileId, "fixture_clean_standard");
  assert.equal(genericImport.fileName, "clean-standard-table.xlsx");
  assert.deepEqual(genericImport.approvedBlockIds, [blockId]);
  assert.equal(genericImport.experiments.length, 3);
  assert.equal(genericImport.measurements.length, 15);
  assert.equal(genericImport.sources.length, 15);
  assert.equal(genericImport.experiments[0].name, "ExpA");

  const conversion = genericImport.measurements.find((measurement) => (
    measurement.displayName === "Conversion (%)" && measurement.rowIndex === 3
  ));
  assert.equal(conversion.value, 24.5);
  assert.equal(conversion.rawValue, "24.5");
  assert.equal(conversion.unit, "%");
  assert.equal(conversion.field, "conversion");

  const source = genericImport.sources.find((item) => item.sourceRef === conversion.sourceRef);
  assert.equal(source.fileId, "fixture_clean_standard");
  assert.equal(source.fileName, "clean-standard-table.xlsx");
  assert.equal(source.sheet, "Clean Standard");
  assert.equal(source.cell, "D3");
  assert.equal(source.range, "D3");
  assert.equal(source.blockId, blockId);
  assert.equal(source.rawValue, 24.5);

  assert.deepEqual(response.summary, {
    genericImportCount: 1,
    createdExperiments: 3,
    createdMeasurements: 15,
    warningCount: 0,
  });
});

test("normalizeApprovedScan applies mapping overrides without mutating HDPE experiments", () => {
  const scanResult = runImportScan(createCleanStandardTableWorkbook());
  const blockId = scanResult.sheets[0].blocks[0].blockId;
  const response = normalizeApprovedScan({
    scanResult,
    approvedBlockIds: [blockId],
    mappingOverrides: {
      "Conversion (%)": { field: "product_conversion", displayName: "Product conversion", unit: "percent" },
    },
  });

  const genericImport = response.datasetPatch.genericImports[0];
  const measurement = genericImport.measurements.find((item) => item.displayName === "Product conversion");

  assert.equal(measurement.field, "product_conversion");
  assert.equal(measurement.unit, "percent");
  assert.equal(Object.hasOwn(response.datasetPatch, "experiments"), false);
});

test("normalizeApprovedScan reports approved block ids missing from the scan result", () => {
  const response = normalizeApprovedScan({
    scanResult: {
      schemaVersion: "labrat.importScan.v1",
      file: { fileId: "upload_1", name: "missing.xlsx", type: "xlsx" },
      sheets: [],
    },
    approvedBlockIds: ["sheet_1_table_1"],
  });

  assert.equal(response.datasetPatch.genericImports.length, 1);
  assert.equal(response.datasetPatch.genericImports[0].warnings[0].code, "approved_block_not_found");
  assert.equal(response.summary.createdExperiments, 0);
  assert.equal(response.summary.createdMeasurements, 0);
  assert.equal(response.summary.warningCount, 1);
});

test("normalizeApprovedScan converts approved repeated experiment blocks to generic experiments", () => {
  const scanResult = runImportScan(createRepeatedBlockTableWorkbook());
  const blockIds = scanResult.sheets[0].blocks.map((block) => block.blockId);
  const response = normalizeApprovedScan({
    scanResult,
    approvedBlockIds: blockIds,
    userEdits: { createdAt: "2026-06-08T00:00:00.000Z" },
  });

  const genericImport = response.datasetPatch.genericImports[0];
  assert.equal(genericImport.experiments.length, 2);
  assert.equal(genericImport.measurements.length, 16);
  assert.equal(genericImport.experiments[0].name, "Experiment A");
  assert.equal(genericImport.experiments[1].name, "Experiment B");

  const firstMetadata = genericImport.experiments[0].metadata[0];
  assert.equal(firstMetadata.displayName, "Temperature");
  assert.equal(firstMetadata.value, 80);
  assert.equal(firstMetadata.rawValue, "80 C");
  assert.equal(firstMetadata.unit, "C");

  const metadataSource = genericImport.sources.find((source) => source.sourceRef === firstMetadata.sourceRef);
  assert.equal(metadataSource.fileName, "repeated-block-table.xlsx");
  assert.equal(metadataSource.sheet, "Repeated Blocks");
  assert.equal(metadataSource.cell, "A2");
  assert.equal(metadataSource.blockId, blockIds[0]);

  const secondBlockConversion = genericImport.measurements.find((measurement) => (
    measurement.experimentId === genericImport.experiments[1].experimentId
    && measurement.displayName === "Conversion (%)"
    && measurement.rowIndex === 12
  ));
  assert.equal(secondBlockConversion.value, 36.2);
  assert.equal(secondBlockConversion.unit, "%");

  const measurementSource = genericImport.sources.find((source) => source.sourceRef === secondBlockConversion.sourceRef);
  assert.equal(measurementSource.cell, "B12");
  assert.equal(measurementSource.blockId, blockIds[1]);
  assert.equal(response.summary.createdExperiments, 2);
  assert.equal(response.summary.createdMeasurements, 16);
});

test("normalizeApprovedScan keeps provenance refs complete for standard and block outputs", () => {
  const standardScan = runImportScan(createCleanStandardTableWorkbook());
  const blockScan = runImportScan(createRepeatedBlockTableWorkbook());
  const standardBlockId = standardScan.sheets[0].blocks[0].blockId;
  const blockIds = blockScan.sheets[0].blocks.map((block) => block.blockId);
  const responses = [
    normalizeApprovedScan({ scanResult: standardScan, approvedBlockIds: [standardBlockId] }),
    normalizeApprovedScan({ scanResult: blockScan, approvedBlockIds: blockIds }),
  ];

  responses.forEach((response) => {
    const genericImport = response.datasetPatch.genericImports[0];
    const sourceRefs = new Set(genericImport.sources.map((source) => source.sourceRef));

    assert.equal(genericImport.files.length, 1);
    assert.equal(genericImport.files[0].fileId, genericImport.fileId);
    assert.equal(genericImport.files[0].fileName, genericImport.fileName);

    genericImport.experiments.forEach((experiment) => {
      assert.equal(sourceRefs.has(experiment.sourceRef), true);
      assert.equal(typeof experiment.sourceBlockId, "string");
      experiment.metadata.forEach((metadata) => {
        assert.equal(sourceRefs.has(metadata.sourceRef), true);
        assert.notEqual(metadata.rawValue, undefined);
      });
    });

    genericImport.measurements.forEach((measurement) => {
      assert.equal(sourceRefs.has(measurement.sourceRef), true);
      assert.equal(typeof measurement.rawValue, "string");
      const source = genericImport.sources.find((item) => item.sourceRef === measurement.sourceRef);
      assert.equal(Boolean(source.fileId), true);
      assert.equal(Boolean(source.fileName), true);
      assert.equal(Boolean(source.sheet), true);
      assert.equal(Boolean(source.range), true);
      assert.equal(Boolean(source.blockId), true);
      assert.notEqual(source.rawValue, null);
    });
  });
});

test("normalizeApprovedScan warns for approved unknown blocks without inventing data", () => {
  const scanResult = runImportScan(createAmbiguousSparseSheetWorkbook());
  const blockId = scanResult.sheets[0].blocks[0].blockId;
  const response = normalizeApprovedScan({
    scanResult,
    approvedBlockIds: [blockId],
  });

  const genericImport = response.datasetPatch.genericImports[0];
  assert.equal(genericImport.experiments.length, 0);
  assert.equal(genericImport.measurements.length, 0);
  assert.equal(genericImport.warnings[0].code, "unsupported_block_type");
  assert.equal(genericImport.warnings[0].blockType, "unknown_region");
  assert.equal(response.summary.warningCount, 1);
});
