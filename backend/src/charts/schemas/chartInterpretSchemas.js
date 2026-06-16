export const CHART_INTERPRET_RESPONSE_VERSION = "labrat.chartInterpretResponse.v1";
export const CHART_SPEC_DRAFT_VERSION = "labrat.chartSpec.v1.2";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value) {
  return [...new Set(asArray(value).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

function mappingSetsFromBody(body) {
  if (Array.isArray(body?.mappingSets)) return body.mappingSets;
  if (isObject(body?.mappingSet)) return [body.mappingSet];
  if (Array.isArray(body?.dataset?.genericMappingSets)) return body.dataset.genericMappingSets;
  return [];
}

function genericImportsFromBody(body) {
  if (Array.isArray(body?.genericImports)) return body.genericImports;
  if (Array.isArray(body?.dataset?.genericImports)) return body.dataset.genericImports;
  return [];
}

export function validateChartInterpretRequest(body) {
  const errors = [];
  if (!isObject(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."], value: null };
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) errors.push("A chart prompt is required.");

  const genericImports = genericImportsFromBody(body).filter(isObject);
  if (!genericImports.length) errors.push("At least one generic import is required.");

  return {
    ok: errors.length === 0,
    errors,
    value: {
      prompt,
      genericImports,
      selectedImportIds: stringArray(body.selectedImportIds),
      selectedExperimentIds: stringArray(body.selectedExperimentIds),
      mappingSets: mappingSetsFromBody(body).filter(isObject),
      chartConstraints: isObject(body.chartConstraints) ? body.chartConstraints : {},
      priorDecisions: asArray(body.priorDecisions).filter(isObject),
    },
  };
}

export function shapeChartInterpretResponse({ chartSpecDraft = null, clarification = null, warnings = [] } = {}) {
  return {
    schemaVersion: CHART_INTERPRET_RESPONSE_VERSION,
    chartSpecDraft: chartSpecDraft ? {
      ...chartSpecDraft,
      schemaVersion: CHART_SPEC_DRAFT_VERSION,
      status: chartSpecDraft.status || "proposed",
      warnings: asArray(chartSpecDraft.warnings),
      filters: asArray(chartSpecDraft.filters),
      transforms: asArray(chartSpecDraft.transforms),
      series: asArray(chartSpecDraft.series),
      calculationWarnings: asArray(chartSpecDraft.calculationWarnings),
      sourceImportIds: asArray(chartSpecDraft.sourceImportIds),
      sourceRefs: asArray(chartSpecDraft.sourceRefs),
    } : null,
    clarification,
    warnings: asArray(warnings),
  };
}
