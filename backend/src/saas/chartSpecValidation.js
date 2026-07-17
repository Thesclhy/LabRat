import { normalizeChartSpecShape, SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";

const ALLOWED_CHART_TYPES = new Set(SUPPORTED_CHART_TYPES);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validationError(code, message, details = undefined) {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code,
    ...(details ? { details } : {}),
  });
}

function validateSourceSnapshotChartSpec(chartSpec, requestedChartType) {
  const chartType = requestedChartType || chartSpec.chartType || "scatter";
  if (!ALLOWED_CHART_TYPES.has(chartType)) {
    throw validationError("invalid_chart_spec", `Unsupported chart type ${chartType}.`, {
      chartType,
      allowedChartTypes: [...ALLOWED_CHART_TYPES],
    });
  }
  if (!isObject(chartSpec.sourceSnapshot)) {
    throw validationError("source_snapshot_required", "Chart specs require an immutable sourceSnapshot.");
  }
  const snapshotRows = asArray(chartSpec.sourceSnapshot.rows);
  const snapshotSeries = asArray(chartSpec.sourceSnapshot.series).filter(isObject);
  if (!snapshotRows.length && !snapshotSeries.length) {
    throw validationError("invalid_chart_spec", "Source-backed chart specs require sourceSnapshot rows or series.");
  }
  if (!isObject(chartSpec.seriesScope)) return;

  const series = asArray(chartSpec.series).filter(isObject);
  if (!series.length || !snapshotSeries.length) {
    throw validationError("invalid_chart_spec", "Source-backed series charts require series definitions and sourceSnapshot.series.");
  }
  const compatible = new Set(asArray(chartSpec.compatibleExperimentIds).map(String));
  series.forEach((item, index) => {
    if (!item.experimentId || !item.xField || !item.yField) {
      throw validationError("invalid_chart_spec", "Source-backed series definitions require experiment, x field, and y field refs.", {
        seriesIndex: index,
      });
    }
    if (compatible.size && !compatible.has(String(item.experimentId))) {
      throw validationError("invalid_chart_spec", "Source-backed series chart references an experiment outside compatibleExperimentIds.", {
        seriesIndex: index,
        experimentId: item.experimentId,
      });
    }
    const snapshot = snapshotSeries.find((candidate) => (
      candidate.seriesId === item.seriesId
      || candidate.experimentId === item.experimentId
      || candidate.experimentAlias === item.experimentLabel
    ));
    if (!snapshot || !asArray(snapshot.rows).length) {
      throw validationError("chart_source_unresolved", "Source-backed series chart is missing source snapshot rows for a series.", {
        seriesIndex: index,
        experimentId: item.experimentId,
      });
    }
  });
}

export function validateChartSpecProposal({ proposal } = {}) {
  if (!isObject(proposal)) {
    throw validationError("invalid_chart_spec", "Chart proposal must be an object.");
  }
  if (proposal.origin !== "source_extract" && !isObject(proposal.sourceSnapshot)) {
    throw validationError("source_snapshot_required", "Only source-backed chart proposals can create ChartSpecs.");
  }

  const requestedChartType = proposal.chartType || null;
  const chartSpec = normalizeChartSpecShape(proposal);
  validateSourceSnapshotChartSpec(chartSpec, requestedChartType);
  return { ok: true, chartSpec };
}
