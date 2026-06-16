import { chartIntentInternals } from "../charts/services/chartIntent.js";

export const PROJECT_AI_CONTEXT_VERSION = "labrat.projectAiContext.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function genericImportsFromCommit(commit) {
  const payload = isObject(commit?.datasetPayload) ? commit.datasetPayload : {};
  return asArray(payload.genericImports).filter(isObject);
}

export function serviceMappingSets(mappingSets) {
  return asArray(mappingSets)
    .filter(isObject)
    .map((set) => {
      const payload = isObject(set.payload) ? set.payload : {};
      return {
        ...payload,
        mappingSetId: set.id,
        status: set.status,
        mappings: asArray(payload.mappings),
        decisions: asArray(payload.decisions),
        decisionSummary: isObject(set.decisionSummary) ? set.decisionSummary : {},
      };
    });
}

export function priorChartDecisions(chartProposalSets) {
  const decisions = [];
  asArray(chartProposalSets).forEach((set) => {
    const payload = isObject(set.payload) ? set.payload : {};
    asArray(payload.proposals).forEach((proposal) => {
      if (proposal?.status === "accepted" || proposal?.status === "rejected") {
        decisions.push({
          proposalId: proposal.proposalId,
          status: proposal.status,
          sourceChartProposalSetId: set.id,
        });
      }
    });
    const summary = isObject(set.decisionSummary) ? set.decisionSummary : {};
    asArray(summary.decisions).forEach((decision) => {
      if (decision?.proposalId && (decision.status === "accepted" || decision.status === "rejected")) {
        decisions.push({
          proposalId: decision.proposalId,
          status: decision.status,
          sourceChartProposalSetId: set.id,
        });
      }
    });
    asArray(summary.acceptedProposalIds).forEach((proposalId) => {
      decisions.push({ proposalId, status: "accepted", sourceChartProposalSetId: set.id });
    });
    asArray(summary.rejectedProposalIds).forEach((proposalId) => {
      decisions.push({ proposalId, status: "rejected", sourceChartProposalSetId: set.id });
    });
  });
  return uniqueBy(decisions, (decision) => `${decision.proposalId}:${decision.status}`);
}

function compactField(field) {
  return {
    fieldId: field.fieldId,
    field: field.field,
    displayName: field.displayName,
    canonicalField: field.canonicalField,
    role: field.role || field.fieldRole || field.semanticRole,
    semanticRole: field.semanticRole,
    measurementFamily: field.measurementFamily || null,
    measurementComponent: field.measurementComponent || null,
    aliases: asArray(field.aliases),
    valueType: field.valueType,
    unit: field.unit || null,
    sourceIds: asArray(field.sourceIds),
    sourceRefs: asArray(field.sourceRefs),
    numericCount: field.numericCount || 0,
    coverageCount: field.coverageCount || 0,
    examples: asArray(field.examples).slice(0, 4),
    confidence: field.confidence || null,
  };
}

function compactChartSpec(chartSpec) {
  return {
    id: chartSpec.id,
    title: chartSpec.title,
    chartType: chartSpec.chartType,
    datasetCommitId: chartSpec.datasetCommitId || null,
    sourceChartProposalSetId: chartSpec.sourceChartProposalSetId || null,
    sourceProposalId: chartSpec.sourceProposalId || null,
    createdAt: chartSpec.createdAt,
    updatedAt: chartSpec.updatedAt,
  };
}

function compactManuscript(manuscript) {
  return {
    id: manuscript.id,
    title: manuscript.title,
    status: manuscript.status,
    blockCount: asArray(manuscript.blocks).length,
    pageCount: asArray(manuscript.pages).length,
    updatedAt: manuscript.updatedAt,
  };
}

export function buildProjectAiContext({
  project,
  projectProfile,
  currentDatasetCommit,
  mappingSets = [],
  chartProposalSets = [],
  chartSpecs = [],
  manuscripts = [],
  selectedImportIds = [],
  selectedExperimentIds = [],
} = {}) {
  const genericImports = genericImportsFromCommit(currentDatasetCommit);
  const serviceMappings = serviceMappingSets(mappingSets);
  const inventory = chartIntentInternals.buildChartFieldInventory({
    genericImports,
    mappingSets: serviceMappings,
    selectedImportIds,
    selectedExperimentIds,
  });
  const fieldInventory = inventory.fields.map(compactField);
  const acceptedMappings = serviceMappings
    .flatMap((set) => asArray(set.mappings))
    .filter((mapping) => mapping?.status === "accepted" || mapping?.status === "accepted_draft");
  const priorDecisions = priorChartDecisions(chartProposalSets);
  const warnings = [
    ...asArray(inventory.warnings),
    ...(!currentDatasetCommit ? [{
      code: "dataset_commit_required",
      message: "Project does not have a current dataset commit.",
      severity: "warning",
    }] : []),
  ];

  return {
    schemaVersion: PROJECT_AI_CONTEXT_VERSION,
    project: {
      id: project?.id,
      labId: project?.labId,
      name: project?.name,
      description: project?.description || "",
      currentDatasetCommitId: project?.currentDatasetCommitId || null,
    },
    projectProfile: projectProfile || {},
    currentDatasetCommitId: currentDatasetCommit?.id || null,
    sourceImportIds: inventory.sourceImportIds,
    fieldInventory,
    acceptedMappings,
    priorChartDecisions: priorDecisions,
    existingCharts: asArray(chartSpecs).map(compactChartSpec),
    manuscripts: asArray(manuscripts).map(compactManuscript),
    warnings,
    serviceInput: {
      genericImports,
      mappingSets: serviceMappings,
      priorDecisions,
    },
  };
}
