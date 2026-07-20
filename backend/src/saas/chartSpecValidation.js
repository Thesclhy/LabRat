import { normalizeChartSpecShape, SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";
import { stableDataHash } from "./dataPlanSchemas.js";

const ALLOWED_CHART_TYPES = new Set(SUPPORTED_CHART_TYPES);
const ANALYSIS_CHART_SPEC_VERSION = "labrat.chartSpec.v2";
const MAX_ANALYSIS_TRACES = 10_000;
const MAX_ANALYSIS_TRACE_POINTS = 250_000;

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

function requiredText(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw validationError("invalid_analysis_chart_spec", `Analysis-result ChartSpec requires ${field}.`, {
      field,
    });
  }
  return normalized;
}

function uniqueTexts(values) {
  return [...new Set(asArray(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function validateAnalysisResultChartSpec(chartSpec) {
  if (chartSpec.schemaVersion !== ANALYSIS_CHART_SPEC_VERSION) {
    throw validationError(
      "invalid_analysis_chart_spec",
      `Analysis-result ChartSpecs require ${ANALYSIS_CHART_SPEC_VERSION}.`,
    );
  }
  if (chartSpec.status !== "accepted") {
    throw validationError("invalid_analysis_chart_spec", "Analysis-result ChartSpecs must be accepted.");
  }
  if (!ALLOWED_CHART_TYPES.has(chartSpec.chartType)) {
    throw validationError("invalid_chart_spec", `Unsupported chart type ${chartSpec.chartType}.`, {
      chartType: chartSpec.chartType,
      allowedChartTypes: [...ALLOWED_CHART_TYPES],
    });
  }
  [
    "analysisThreadId",
    "analysisPlanRevisionId",
    "analysisRunId",
    "analysisResultId",
    "planHash",
    "selectionHash",
    "dependencyHash",
    "inputHash",
    "programHash",
    "resultHash",
    "resultPreviewHash",
    "runtimeVersion",
  ].forEach((field) => requiredText(chartSpec[field], field));
  if (chartSpec.inputHash !== chartSpec.selectionHash) {
    throw validationError(
      "invalid_analysis_chart_spec",
      "Analysis-result ChartSpec inputHash must equal its accepted selectionHash.",
    );
  }

  const inputSnapshotRefs = asArray(chartSpec.inputSnapshotRefs);
  if (!inputSnapshotRefs.length) {
    throw validationError(
      "invalid_analysis_chart_spec",
      "Analysis-result ChartSpecs require accepted input snapshot refs.",
    );
  }
  const sourceRecordIds = new Set();
  inputSnapshotRefs.forEach((ref, index) => {
    if (!isObject(ref)) {
      throw validationError("invalid_analysis_chart_spec", "Input snapshot refs must be objects.", {
        inputSnapshotRefIndex: index,
      });
    }
    [
      "experimentId",
      "headId",
      "snapshotId",
      "sourceRecordId",
      "contentHash",
      "dependencyHash",
    ].forEach((field) => requiredText(ref[field], `inputSnapshotRefs[${index}].${field}`));
    if (!Number.isInteger(Number(ref.recordIndex)) || Number(ref.recordIndex) < 0) {
      throw validationError(
        "invalid_analysis_chart_spec",
        "Input snapshot refs require a non-negative integer recordIndex.",
        { inputSnapshotRefIndex: index },
      );
    }
    const expectedSourceRecordId = `${ref.snapshotId}:${Number(ref.recordIndex)}`;
    if (ref.sourceRecordId !== expectedSourceRecordId || sourceRecordIds.has(ref.sourceRecordId)) {
      throw validationError(
        "invalid_analysis_chart_spec",
        "Input snapshot refs require unique canonical sourceRecordIds.",
        { inputSnapshotRefIndex: index, expectedSourceRecordId },
      );
    }
    sourceRecordIds.add(ref.sourceRecordId);
  });

  const traces = asArray(chartSpec.traceCatalog);
  if (!traces.length || traces.length > MAX_ANALYSIS_TRACES) {
    throw validationError(
      "invalid_analysis_chart_spec",
      `Analysis-result ChartSpecs require 1-${MAX_ANALYSIS_TRACES} traces.`,
    );
  }
  const traceIds = new Set();
  let pointCount = 0;
  traces.forEach((trace, index) => {
    if (!isObject(trace)) {
      throw validationError("invalid_analysis_chart_spec", "Trace catalog entries must be objects.", {
        traceIndex: index,
      });
    }
    const traceId = requiredText(trace.traceId, `traceCatalog[${index}].traceId`);
    if (traceIds.has(traceId)) {
      throw validationError("invalid_analysis_chart_spec", `Duplicate analysis trace id ${traceId}.`, {
        traceIndex: index,
        traceId,
      });
    }
    traceIds.add(traceId);
    const x = asArray(trace.x);
    const y = asArray(trace.y);
    if (!x.length || x.length !== y.length) {
      throw validationError(
        "invalid_analysis_chart_spec",
        `Analysis trace ${traceId} requires equal non-empty x/y arrays.`,
        { traceIndex: index, traceId, xLength: x.length, yLength: y.length },
      );
    }
    pointCount += x.length;
    x.forEach((value, pointIndex) => {
      if (
        typeof value !== "string"
        && (typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw validationError(
          "invalid_analysis_chart_spec",
          `Analysis trace ${traceId} contains an invalid x value.`,
          { traceIndex: index, pointIndex },
        );
      }
    });
    y.forEach((value, pointIndex) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw validationError(
          "invalid_analysis_chart_spec",
          `Analysis trace ${traceId} contains a non-finite y value.`,
          { traceIndex: index, pointIndex },
        );
      }
    });
    if (!Object.hasOwn(trace, "xUnit") || !Object.hasOwn(trace, "yUnit")) {
      throw validationError(
        "invalid_analysis_chart_spec",
        `Analysis trace ${traceId} must declare xUnit and yUnit, including explicit null.`,
        { traceIndex: index, traceId },
      );
    }
    const lineage = uniqueTexts(trace.sourceRecordIds);
    if (!lineage.length) {
      throw validationError(
        "analysis_chart_lineage_required",
        `Analysis trace ${traceId} requires source-record lineage.`,
        { traceIndex: index, traceId },
      );
    }
    const unknownSourceRecordIds = lineage.filter((sourceRecordId) => !sourceRecordIds.has(sourceRecordId));
    if (unknownSourceRecordIds.length) {
      throw validationError(
        "analysis_chart_lineage_unknown",
        `Analysis trace ${traceId} references records outside accepted input snapshots.`,
        { traceIndex: index, traceId, unknownSourceRecordIds },
      );
    }
  });
  if (pointCount > MAX_ANALYSIS_TRACE_POINTS) {
    throw validationError(
      "invalid_analysis_chart_spec",
      `Analysis-result ChartSpec contains ${pointCount} points; maximum is ${MAX_ANALYSIS_TRACE_POINTS}.`,
    );
  }

  if (!isObject(chartSpec.defaultChartView)) {
    throw validationError(
      "invalid_analysis_chart_spec",
      "Analysis-result ChartSpecs require a defaultChartView.",
    );
  }
  const requestedVisibleTraceIds = asArray(chartSpec.defaultChartView.visibleTraceIds);
  const visibleTraceIds = uniqueTexts(requestedVisibleTraceIds);
  if (visibleTraceIds.length !== requestedVisibleTraceIds.length) {
    throw validationError(
      "invalid_analysis_chart_spec",
      "Default visible trace ids must be unique strings.",
    );
  }
  const unknownVisibleTraceIds = visibleTraceIds.filter((traceId) => !traceIds.has(traceId));
  if (unknownVisibleTraceIds.length) {
    throw validationError(
      "analysis_chart_trace_unknown",
      "Default chart view references traces outside the immutable catalog.",
      { unknownTraceIds: unknownVisibleTraceIds },
    );
  }
  if (chartSpec.contentHash) {
    const { contentHash, ...hashPayload } = chartSpec;
    if (contentHash !== stableDataHash(hashPayload)) {
      throw validationError(
        "invalid_analysis_chart_spec",
        "Analysis-result ChartSpec contentHash does not match its immutable payload.",
      );
    }
  }
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
  if (proposal.origin === "analysis_result") {
    const chartSpec = structuredClone(proposal);
    validateAnalysisResultChartSpec(chartSpec);
    return { ok: true, chartSpec };
  }
  if (proposal.origin !== "source_extract" && !isObject(proposal.sourceSnapshot)) {
    throw validationError(
      "source_snapshot_required",
      "Proposal-based ChartSpec creation requires source-extract evidence; analysis-result charts require accepted result publication.",
    );
  }

  const requestedChartType = proposal.chartType || null;
  const chartSpec = normalizeChartSpecShape(proposal);
  validateSourceSnapshotChartSpec(chartSpec, requestedChartType);
  return { ok: true, chartSpec };
}
