export const CHART_PROPOSAL_RESPONSE_VERSION = "labrat.chartProposalResponse.v1";
export const CHART_PROPOSAL_SET_VERSION = "labrat.chartProposalSet.v1";

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

export function normalizeChartGenericImports(body) {
  if (Array.isArray(body?.genericImports)) return body.genericImports;
  if (Array.isArray(body?.dataset?.genericImports)) return body.dataset.genericImports;
  return [];
}

export function validateChartProposalRequest(body) {
  const errors = [];
  if (!isObject(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."], value: null };
  }

  const genericImports = normalizeChartGenericImports(body).filter(isObject);
  if (!genericImports.length) {
    errors.push("At least one generic import is required.");
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      genericImports,
      selectedImportIds: stringArray(body.selectedImportIds),
      mappingSets: mappingSetsFromBody(body).filter(isObject),
      userGoal: typeof body.userGoal === "string" ? body.userGoal : "",
      chartConstraints: isObject(body.chartConstraints) ? body.chartConstraints : {},
      priorDecisions: asArray(body.priorDecisions).filter(isObject),
    },
  };
}

export function createChartProposalSummary(proposalSet, warnings = []) {
  const proposals = asArray(proposalSet?.proposals);
  return {
    proposalCount: proposals.length,
    acceptedCount: proposals.filter((item) => item.status === "accepted").length,
    rejectedCount: proposals.filter((item) => item.status === "rejected").length,
    warningCount: asArray(warnings).length + asArray(proposalSet?.warnings).length + proposals.reduce((total, item) => total + asArray(item.warnings).length, 0),
  };
}

export function shapeChartProposalResponse({ proposalSet, warnings = [] } = {}) {
  const safeProposalSet = proposalSet && typeof proposalSet === "object" ? proposalSet : {
    proposalSetId: "chart_proposal_set_empty",
    schemaVersion: CHART_PROPOSAL_SET_VERSION,
    sourceImportIds: [],
    proposals: [],
    warnings: [],
  };
  return {
    schemaVersion: CHART_PROPOSAL_RESPONSE_VERSION,
    proposalSet: {
      ...safeProposalSet,
      schemaVersion: CHART_PROPOSAL_SET_VERSION,
      sourceImportIds: asArray(safeProposalSet.sourceImportIds),
      proposals: asArray(safeProposalSet.proposals),
      warnings: asArray(safeProposalSet.warnings),
    },
    summary: createChartProposalSummary(safeProposalSet, warnings),
    warnings: asArray(warnings),
  };
}
