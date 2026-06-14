import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERIC_IMPORT_SCHEMA_VERSION,
  IMPORT_SCAN_SCHEMA_VERSION,
  createEmptyDatasetPatch,
  normalizeApprovedBlockIds,
  shapeNormalizeResponse,
  validateNormalizeRequest,
} from "./normalizationSchemas.js";

test("normalization schema constants name the scan and generic import versions", () => {
  assert.equal(IMPORT_SCAN_SCHEMA_VERSION, "labrat.importScan.v1");
  assert.equal(GENERIC_IMPORT_SCHEMA_VERSION, "labrat.genericImport.v1");
});

test("normalizeApprovedBlockIds accepts arrays and approved-state maps conservatively", () => {
  assert.deepEqual(normalizeApprovedBlockIds(["a", "a", "", " b "]), ["a", "b"]);
  assert.deepEqual(normalizeApprovedBlockIds({ a: true, b: "approved", c: false, d: "ignored" }), ["a", "b"]);
  assert.deepEqual(normalizeApprovedBlockIds(null), []);
});

test("validateNormalizeRequest accepts a scan result and approved block ids", () => {
  const result = validateNormalizeRequest({
    scanResult: { schemaVersion: IMPORT_SCAN_SCHEMA_VERSION, sheets: [] },
    approvedBlockIds: ["sheet_1_block_1"],
    mappingOverrides: { col_1: { field: "time" } },
    userEdits: { sheet_1_block_1: { name: "Run 1" } },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.value.approvedBlockIds, ["sheet_1_block_1"]);
  assert.equal(result.value.mappingOverrides.col_1.field, "time");
  assert.equal(result.value.userEdits.sheet_1_block_1.name, "Run 1");
});

test("validateNormalizeRequest rejects missing scan, wrong schema, and empty approvals", () => {
  const result = validateNormalizeRequest({
    scanResult: { schemaVersion: "old" },
    approvedBlockIds: [],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "scanResult.schemaVersion must be labrat.importScan.v1.",
    "At least one approved block id is required.",
  ]);

  assert.equal(validateNormalizeRequest(null).ok, false);
});

test("shapeNormalizeResponse returns a stable generic-import patch envelope", () => {
  const response = shapeNormalizeResponse({
    datasetPatch: {
      genericImports: [{
        importId: "import_1",
        schemaVersion: GENERIC_IMPORT_SCHEMA_VERSION,
        experiments: [{ experimentId: "generic_exp_1" }],
        measurements: [{ measurementId: "measurement_1" }, { measurementId: "measurement_2" }],
        warnings: [{ code: "low_confidence" }],
      }],
    },
    warnings: [{ code: "skipped_block" }],
  });

  assert.equal(response.schemaVersion, "labrat.importNormalize.v1");
  assert.equal(response.datasetPatch.genericImports.length, 1);
  assert.deepEqual(response.summary, {
    genericImportCount: 1,
    createdExperiments: 1,
    createdMeasurements: 2,
    warningCount: 2,
  });
});

test("createEmptyDatasetPatch does not include HDPE experiment mutations", () => {
  assert.deepEqual(createEmptyDatasetPatch(), { genericImports: [] });
});
