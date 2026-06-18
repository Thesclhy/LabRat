import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAmbiguousSparseSheetWorkbook,
  createCleanStandardTableWorkbook,
  createGroupedMasterTableWorkbook,
  createReactionRateSupplementWorkbook,
  createRepeatedBlockTableWorkbook,
} from "../fixtures/workbookFixtures.js";
import { runImportScan } from "./importPipeline.js";
import { normalizeApprovedScan } from "./normalizer.js";

function assertAllSourceRefsResolve(genericImport) {
  const sourceRefs = new Set(genericImport.sources.map((source) => source.sourceRef));
  genericImport.experiments.forEach((experiment) => {
    assert.equal(sourceRefs.has(experiment.sourceRef), true);
    assert.equal(typeof experiment.sourceBlockId, "string");
    assert.equal(Array.isArray(experiment.warnings), true);
    assert.equal(typeof experiment.confidence, "number");
    experiment.metadata.forEach((metadata) => {
      assert.equal(sourceRefs.has(metadata.sourceRef), true);
      assert.equal(Array.isArray(metadata.warnings), true);
      assert.notEqual(metadata.rawValue, undefined);
      assert.notEqual(metadata.confidence, undefined);
    });
  });
  genericImport.measurements.forEach((measurement) => {
    assert.equal(sourceRefs.has(measurement.sourceRef), true);
    assert.equal(Array.isArray(measurement.warnings), true);
    assert.equal(typeof measurement.rawValue, "string");
    const source = genericImport.sources.find((item) => item.sourceRef === measurement.sourceRef);
    assert.equal(Boolean(source.fileId), true);
    assert.equal(Boolean(source.fileName), true);
    assert.equal(Boolean(source.sheet), true);
    assert.equal(Boolean(source.range), true);
    assert.equal(Boolean(source.blockId), true);
    assert.notEqual(source.rawValue, null);
  });
  genericImport.fields.forEach((field) => {
    assert.equal(sourceRefs.has(field.sourceRef), true);
    assert.equal(Array.isArray(field.warnings), true);
    assert.equal(typeof field.rawValue, "string");
    assert.equal(typeof field.role, "string");
  });
}

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
  assert.equal(genericImport.fields.length, 15);
  assert.equal(genericImport.measurements.length, 6);
  assert.equal(genericImport.sources.length, 15);
  assert.equal(genericImport.experiments[0].name, "ExpA");
  assert.equal(genericImport.experiments[0].sourceBlockId, blockId);
  assert.equal(typeof genericImport.experiments[0].confidence, "number");
  assert.deepEqual(genericImport.experiments[0].warnings, []);

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
    createdFields: 15,
    createdMeasurements: 6,
    warningCount: 0,
  });
});

test("normalizeApprovedScan preserves formatted date values for browser display", () => {
  const scanResult = {
    schemaVersion: "labrat.importScan.v1",
    file: { fileId: "upload_dates", name: "dates.xlsx", type: "xlsx" },
    sheets: [{
      sheetId: "sheet_1",
      name: "Runs",
      blocks: [{
        blockId: "sheet_1_table_1",
        type: "standard_table",
        range: "A1:B2",
        confidence: 0.9,
        table: {
          source: { fileId: "upload_dates", fileName: "dates.xlsx", sheet: "Runs", range: "A1:B2" },
          columns: [
            { columnId: "col_1", fieldId: "col_1", rawName: "Experiment", label: "Experiment", role: "identifier", confidence: 0.9 },
            { columnId: "col_2", fieldId: "col_2", rawName: "Date", label: "Date", role: "metadata", valueType: "date", confidence: 0.9 },
          ],
          rows: [{
            rowIndex: 2,
            values: [
              {
                columnId: "col_1",
                value: "Exp1",
                rawValue: "Exp1",
                formattedValue: "Exp1",
                source: { fileId: "upload_dates", fileName: "dates.xlsx", sheet: "Runs", cell: "A2", range: "A2", rawValue: "Exp1", formattedValue: "Exp1" },
              },
              {
                columnId: "col_2",
                value: 45733,
                rawValue: "45733",
                formattedValue: "3/17/2025",
                source: { fileId: "upload_dates", fileName: "dates.xlsx", sheet: "Runs", cell: "B2", range: "B2", rawValue: 45733, formattedValue: "3/17/2025" },
              },
            ],
          }],
        },
      }],
    }],
  };
  const response = normalizeApprovedScan({
    scanResult,
    approvedBlockIds: ["sheet_1_table_1"],
  });

  const genericImport = response.datasetPatch.genericImports[0];
  const dateField = genericImport.fields.find((field) => field.displayName === "Date");
  assert.equal(dateField.value, 45733);
  assert.equal(dateField.rawValue, "45733");
  assert.equal(dateField.formattedValue, "3/17/2025");
  const source = genericImport.sources.find((item) => item.sourceRef === dateField.sourceRef);
  assert.equal(source.rawValue, 45733);
  assert.equal(source.formattedValue, "3/17/2025");
  assert.equal(genericImport.experiments[0].metadata[0].formattedValue, "3/17/2025");
});

test("normalizeApprovedScan preserves grouped MasterTable fields with roles and experiment labels", () => {
  const scanResult = runImportScan(createGroupedMasterTableWorkbook());
  const block = scanResult.sheets[0].blocks[0];
  const response = normalizeApprovedScan({
    scanResult,
    approvedBlockIds: [block.blockId],
    userEdits: { createdAt: "2026-06-14T00:00:00.000Z" },
  });

  const genericImport = response.datasetPatch.genericImports[0];
  assert.equal(genericImport.experiments.length, 2);
  assert.equal(genericImport.experiments[0].name, "Exp1");
  assert.equal(genericImport.experiments[1].name, "Exp2");
  assert.equal(genericImport.fields.filter((field) => field.experimentId === genericImport.experiments[0].experimentId).length, 14);
  assert.equal(genericImport.measurements.filter((field) => field.experimentId === genericImport.experiments[0].experimentId).length, 3);

  const firstFields = genericImport.fields.filter((field) => field.experimentId === genericImport.experiments[0].experimentId);
  assert.equal(firstFields.find((field) => field.displayName === "Catalyst Type").role, "material");
  assert.equal(firstFields.find((field) => field.displayName === "Temperature (C)").role, "condition");
  assert.equal(firstFields.find((field) => field.displayName === "Selectivity Gas (%)").role, "measurement");
  assert.equal(firstFields.find((field) => field.displayName === "Selectivity Gas (%)").unit, "%");

  const selectivitySource = genericImport.sources.find((source) => source.sourceRef === firstFields.find((field) => field.displayName === "Selectivity Gas (%)").sourceRef);
  assert.equal(selectivitySource.sheet, "Sheet1");
  assert.equal(selectivitySource.cell, "N3");
});

test("normalizeApprovedScan converts reaction-rate supplements to observation sets", () => {
  const scanResult = runImportScan(createReactionRateSupplementWorkbook());
  const block = scanResult.sheets[0].blocks[0];
  assert.equal(block.detectedSupplementType, "reaction_rate_time_series");
  assert.equal(block.observationSetPreview.inferredExperimentLabel, "Exp30");

  const response = normalizeApprovedScan({
    scanResult,
    approvedBlockIds: [block.blockId],
    userEdits: { createdAt: "2026-06-16T00:00:00.000Z" },
  });

  const genericImport = response.datasetPatch.genericImports[0];
  assert.equal(genericImport.experiments.length, 0);
  assert.equal(genericImport.observationSets.length, 1);
  assert.equal(genericImport.observationSets[0].kind, "reaction_rate_time_series");
  assert.equal(genericImport.observationSets[0].inferredExperimentLabel, "Exp30");
  assert.equal(genericImport.observationSets[0].observations.length, 62);
  assert.equal(genericImport.observationSets[0].summary.observationCount, 62);
  assert.equal(genericImport.observationSets[0].xField, "reaction_time_min");
  assert.equal(genericImport.observationSets[0].yFields.includes("adjusted_rate_m_s"), true);

  const firstObservation = genericImport.observationSets[0].observations[0];
  assert.equal(firstObservation.rowIndex, 3);
  assert.equal(firstObservation.adjustedRateMPerS, 0.00091612);
  assert.equal(Array.isArray(firstObservation.sourceRefs), true);
  assert.equal(firstObservation.sourceRefs.length > 0, true);

  const adjustedRate = genericImport.fields.find((field) => (
    field.recordKind === "observation"
    && field.observationId === firstObservation.observationId
    && field.field === "adjusted_rate_m_s"
  ));
  assert.equal(adjustedRate.displayName, "Adjusted Rate (M/s)");
  assert.equal(adjustedRate.unit, "M/s");
  assert.equal(adjustedRate.value, 0.00091612);
  assert.equal(adjustedRate.inferredExperimentLabel, "Exp30");
  const source = genericImport.sources.find((item) => item.sourceRef === adjustedRate.sourceRef);
  assert.equal(source.sheet, "Exp30");
  assert.equal(source.cell, "H3");
  assert.equal(source.blockId, block.blockId);
  assert.equal(response.summary.createdExperiments, 0);
  assert.equal(response.summary.createdMeasurements > 0, true);
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
  assert.equal(genericImport.fields.length, 18);
  assert.equal(genericImport.measurements.length, 12);
  assert.equal(genericImport.experiments[0].name, "Experiment A");
  assert.equal(genericImport.experiments[1].name, "Experiment B");
  assert.equal(typeof genericImport.experiments[0].confidence, "number");
  assert.deepEqual(genericImport.experiments[0].warnings, []);

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
  assert.equal(response.summary.createdMeasurements, 12);
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
    assert.equal(genericImport.files.length, 1);
    assert.equal(genericImport.files[0].fileId, genericImport.fileId);
    assert.equal(genericImport.files[0].fileName, genericImport.fileName);
    assertAllSourceRefsResolve(genericImport);
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
