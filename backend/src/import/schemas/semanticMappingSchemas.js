export const SEMANTIC_MAPPING_RESPONSE_VERSION = "labrat.semanticMappingResponse.v1";
export const SEMANTIC_MAPPING_SET_VERSION = "labrat.semanticMappingSet.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value) {
  return [...new Set(asArray(value).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

export function normalizeGenericImports(body) {
  if (Array.isArray(body?.genericImports)) return body.genericImports;
  if (Array.isArray(body?.dataset?.genericImports)) return body.dataset.genericImports;
  return [];
}

export function validateSemanticMappingRequest(body) {
  const errors = [];
  if (!isObject(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."], value: null };
  }

  const genericImports = normalizeGenericImports(body).filter(isObject);
  if (!genericImports.length) {
    errors.push("At least one generic import is required.");
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      genericImports,
      selectedImportIds: stringArray(body.selectedImportIds),
      scanSummary: isObject(body.scanSummary) ? body.scanSummary : null,
      userGoal: typeof body.userGoal === "string" ? body.userGoal : "",
      priorDecisions: asArray(body.priorDecisions).filter(isObject),
    },
  };
}

export function createSemanticMappingSummary(mappingSet, warnings = []) {
  const mappings = asArray(mappingSet?.mappings);
  return {
    proposalCount: mappings.length,
    acceptedCount: mappings.filter((item) => item.status === "accepted").length,
    rejectedCount: mappings.filter((item) => item.status === "rejected").length,
    warningCount: asArray(warnings).length + asArray(mappingSet?.warnings).length + mappings.reduce((total, item) => total + asArray(item.warnings).length, 0),
  };
}

export function shapeSemanticMappingResponse({ mappingSet, warnings = [] } = {}) {
  const safeMappingSet = mappingSet && typeof mappingSet === "object" ? mappingSet : {
    mappingSetId: "mapping_set_empty",
    schemaVersion: SEMANTIC_MAPPING_SET_VERSION,
    sourceImportIds: [],
    mappings: [],
    warnings: [],
  };
  return {
    schemaVersion: SEMANTIC_MAPPING_RESPONSE_VERSION,
    mappingSet: {
      ...safeMappingSet,
      schemaVersion: SEMANTIC_MAPPING_SET_VERSION,
      sourceImportIds: asArray(safeMappingSet.sourceImportIds),
      mappings: asArray(safeMappingSet.mappings),
      warnings: asArray(safeMappingSet.warnings),
    },
    summary: createSemanticMappingSummary(safeMappingSet, warnings),
    warnings: asArray(warnings),
  };
}
