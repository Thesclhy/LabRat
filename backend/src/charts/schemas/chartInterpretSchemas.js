export const CHART_INTERPRET_RESPONSE_VERSION = "labrat.chartInterpretResponse.v1";
export const CHART_SPEC_DRAFT_VERSION = "labrat.chartSpec.v1.3";
export const CHART_SPEC_DRAFT_V14_VERSION = "labrat.chartSpec.v1.4";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function shapeChartInterpretResponse({
  chartSpecDraft = null,
  clarification = null,
  warnings = [],
  evidenceIntent = null,
  evidenceResolution = null,
  sourceExtractPreview = null,
  sourceExtractProposal = null,
} = {}) {
  return {
    schemaVersion: CHART_INTERPRET_RESPONSE_VERSION,
    chartSpecDraft: chartSpecDraft ? {
      ...chartSpecDraft,
      schemaVersion: chartSpecDraft.schemaVersion === CHART_SPEC_DRAFT_V14_VERSION
        ? CHART_SPEC_DRAFT_V14_VERSION
        : CHART_SPEC_DRAFT_VERSION,
      status: chartSpecDraft.status || "proposed",
      warnings: asArray(chartSpecDraft.warnings),
      filters: asArray(chartSpecDraft.filters),
      transforms: asArray(chartSpecDraft.transforms),
      series: asArray(chartSpecDraft.series),
      axisOptions: chartSpecDraft.axisOptions,
      renderStyle: chartSpecDraft.renderStyle,
      calculationWarnings: asArray(chartSpecDraft.calculationWarnings),
      sourceRefs: asArray(chartSpecDraft.sourceRefs),
    } : null,
    clarification,
    warnings: asArray(warnings),
    evidenceIntent,
    evidenceResolution,
    sourceExtractPreview,
    sourceExtractProposal,
  };
}
