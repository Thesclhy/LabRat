import { interpretServerProjectChartIntent } from "./serverApi.js";

export const CHART_INTENT_KINDS = Object.freeze({
  CLARIFICATION: "clarification",
  SOURCE_EXTRACT_PROPOSAL: "source_extract_proposal",
  SOURCE_EXTRACT_PREVIEW: "source_extract_preview",
  DATA_PLAN_REVIEW: "data_plan_review",
  CHART_PROPOSAL_SET: "chart_proposal_set",
  CHART_SPEC_VISUAL_PATCH: "chart_spec_visual_patch",
  CHART_SPEC_DRAFT: "chart_spec_draft",
  UNKNOWN: "unknown",
});

function firstPresent(...values) {
  return values.find((value) => value != null) ?? null;
}

export function classifyChartIntentResponse(response = {}) {
  if (response?.clarification) return CHART_INTENT_KINDS.CLARIFICATION;
  if (response?.chartSpecVisualPatch || response?.visualPatch) return CHART_INTENT_KINDS.CHART_SPEC_VISUAL_PATCH;
  if (response?.dataPlanReview || response?.dataPlan || response?.dataSnapshot) return CHART_INTENT_KINDS.DATA_PLAN_REVIEW;
  if (response?.sourceExtractProposal) return CHART_INTENT_KINDS.SOURCE_EXTRACT_PROPOSAL;
  if (response?.sourceExtractPreview) return CHART_INTENT_KINDS.SOURCE_EXTRACT_PREVIEW;
  if (response?.chartProposalSet) return CHART_INTENT_KINDS.CHART_PROPOSAL_SET;
  if (response?.chartSpecDraft) return CHART_INTENT_KINDS.CHART_SPEC_DRAFT;
  return CHART_INTENT_KINDS.UNKNOWN;
}

export function normalizeChartIntentResult(response = {}, metadata = {}) {
  const kind = classifyChartIntentResponse(response);
  return {
    kind,
    entrypoint: metadata.entrypoint || "unknown",
    response,
    clarification: response?.clarification || null,
    chartProposalSet: response?.chartProposalSet || null,
    sourceExtractProposal: response?.sourceExtractProposal || null,
    sourceExtractPreview: response?.sourceExtractPreview || null,
    dataPlanReview: firstPresent(response?.dataPlanReview, response?.dataPlan, response?.dataSnapshot),
    chartSpecVisualPatch: firstPresent(response?.chartSpecVisualPatch, response?.visualPatch),
    chartSpecDraft: response?.chartSpecDraft || null,
    warnings: Array.isArray(response?.warnings) ? response.warnings : [],
  };
}

export async function interpretProjectChartIntent(projectId, request = {}, options = {}) {
  const entrypoint = request.entrypoint || "unknown";
  const response = await interpretServerProjectChartIntent(projectId, {
    prompt: request.prompt,
    selectedImportIds: request.selectedImportIds || [],
    selectedExperimentIds: request.selectedExperimentIds || [],
    chartConstraints: request.chartConstraints || {},
    persistAsProposal: request.persistAsProposal !== false,
    entrypoint,
    context: request.context || {},
  }, options);
  return normalizeChartIntentResult(response, { entrypoint });
}
