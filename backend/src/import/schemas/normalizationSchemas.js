export const IMPORT_SCAN_SCHEMA_VERSION = "labrat.importScan.v1";
export const GENERIC_IMPORT_SCHEMA_VERSION = "labrat.genericImport.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeApprovedBlockIds(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (isObject(value)) return uniqueStrings(Object.entries(value).filter(([, state]) => state === true || state === "approved").map(([blockId]) => blockId));
  return [];
}

export function validateNormalizeRequest(body) {
  const errors = [];
  if (!isObject(body)) {
    return {
      ok: false,
      errors: ["Request body must be a JSON object."],
      value: null,
    };
  }

  const scanResult = body.scanResult || body.scan || null;
  if (!isObject(scanResult)) {
    errors.push("scanResult is required.");
  } else if (scanResult.schemaVersion !== IMPORT_SCAN_SCHEMA_VERSION) {
    errors.push(`scanResult.schemaVersion must be ${IMPORT_SCAN_SCHEMA_VERSION}.`);
  }

  const approvedBlockIds = normalizeApprovedBlockIds(body.approvedBlockIds || body.approvedBlocks);
  if (!approvedBlockIds.length) {
    errors.push("At least one approved block id is required.");
  }

  const mappingOverrides = isObject(body.mappingOverrides) ? body.mappingOverrides : {};
  const fieldRoleOverrides = isObject(body.fieldRoleOverrides) ? body.fieldRoleOverrides : {};
  const approvedStructures = isObject(body.approvedStructures) ? body.approvedStructures : {};
  const userEdits = isObject(body.userEdits) ? body.userEdits : {};
  const templateId = typeof body.templateId === "string" && body.templateId.trim() ? body.templateId.trim() : null;

  return {
    ok: errors.length === 0,
    errors,
    value: {
      scanResult,
      approvedBlockIds,
      approvedStructures,
      fieldRoleOverrides,
      mappingOverrides,
      userEdits,
      templateId,
    },
  };
}

export function createEmptyDatasetPatch() {
  return {
    genericImports: [],
  };
}

export function createNormalizeSummary(datasetPatch, warnings = []) {
  const genericImports = asArray(datasetPatch?.genericImports);
  return {
    genericImportCount: genericImports.length,
    createdExperiments: genericImports.reduce((total, item) => total + asArray(item.experiments).length, 0),
    createdFields: genericImports.reduce((total, item) => total + asArray(item.fields).length, 0),
    createdMeasurements: genericImports.reduce((total, item) => total + asArray(item.measurements).length, 0),
    warningCount: asArray(warnings).length + genericImports.reduce((total, item) => total + asArray(item.warnings).length, 0),
  };
}

export function shapeNormalizeResponse({ datasetPatch = createEmptyDatasetPatch(), warnings = [] } = {}) {
  return {
    schemaVersion: "labrat.importNormalize.v1",
    datasetPatch: {
      genericImports: asArray(datasetPatch.genericImports),
    },
    summary: createNormalizeSummary(datasetPatch, warnings),
    warnings: asArray(warnings),
  };
}
