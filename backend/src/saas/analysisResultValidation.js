import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";
import { stableDataHash } from "./dataPlanSchemas.js";
import { RESOLVED_CHART_GEOMETRY_SCHEMA_VERSION } from "./reusableChartGeometry.js";

const MAX_TRACES = 10_000;
const MAX_TRACE_POINTS = 1_000_000;
const MAX_RESULT_BYTES = 100 * 1024 * 1024;
const MAX_RESOLVED_GEOMETRY_BYTES = 64 * 1024;
const ALLOWED_TRACE_TYPES = new Set(["bar", "scatter"]);
const UNSAFE_STRING = /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html)/i;
const UNSAFE_KEYS = new Set(["images", "frames"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resultError(code, message, details = {}) {
  return { code, message, ...details };
}

function finiteAndSafeErrors(value, path = "result", errors = []) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    errors.push(resultError(
      "analysis_non_finite_value",
      `Analysis output ${path} contains NaN or infinity.`,
      { path },
    ));
    return errors;
  }
  if (typeof value === "string" && UNSAFE_STRING.test(value)) {
    errors.push(resultError(
      "analysis_plotly_unsafe_string",
      `Analysis output ${path} contains unsafe HTML or a script URL.`,
      { path },
    ));
    return errors;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => finiteAndSafeErrors(item, `${path}[${index}]`, errors));
  } else if (isObject(value)) {
    Object.entries(value).forEach(([key, item]) => {
      if (UNSAFE_KEYS.has(key)) {
        errors.push(resultError(
          "analysis_plotly_property_unsupported",
          `Plotly property ${path}.${key} is not allowed in reviewed analysis output.`,
          { path: `${path}.${key}` },
        ));
        return;
      }
      finiteAndSafeErrors(item, `${path}.${key}`, errors);
    });
  }
  return errors;
}

function traceId(trace, index) {
  return String(
    trace?.traceId
      || trace?.meta?.labrat?.traceId
      || `trace_${index + 1}`,
  ).trim();
}

function normalizeTrace(trace, index) {
  const id = traceId(trace, index);
  const meta = isObject(trace?.meta) ? structuredClone(trace.meta) : {};
  const labrat = isObject(meta.labrat) ? meta.labrat : {};
  return {
    ...structuredClone(trace),
    traceId: id,
    name: String(trace?.name || `Series ${index + 1}`),
    meta: {
      ...meta,
      labrat: {
        ...labrat,
        traceId: id,
      },
    },
  };
}

function plottableX(value) {
  return value == null
    || typeof value === "string"
    || (typeof value === "number" && Number.isFinite(value));
}

function plottableY(value) {
  return value == null || (typeof value === "number" && Number.isFinite(value));
}

function resolvedGeometry(rawValue, adapter, errors) {
  if (!isObject(rawValue)) {
    if (adapter === "chart_template_v1") {
      errors.push(resultError(
        "analysis_resolved_geometry_required",
        "Reusable chart results require a resolved geometry summary.",
      ));
    }
    return null;
  }
  const value = structuredClone(rawValue);
  if (value.schemaVersion !== RESOLVED_CHART_GEOMETRY_SCHEMA_VERSION) {
    errors.push(resultError(
      "analysis_resolved_geometry_invalid",
      `Resolved geometry requires ${RESOLVED_CHART_GEOMETRY_SCHEMA_VERSION}.`,
    ));
  }
  const width = Number(value.figure?.widthPx);
  const height = Number(value.figure?.heightPx);
  if (!Number.isFinite(width) || width < 240 || width > 8000 || !Number.isFinite(height) || height < 180 || height > 8000) {
    errors.push(resultError(
      "analysis_resolved_geometry_invalid",
      "Resolved figure dimensions are outside the supported range.",
    ));
  }
  for (const [name, ratio] of Object.entries({
    widthRatio: value.plotArea?.widthRatio,
    heightRatio: value.plotArea?.heightRatio,
    minimumWidthRatio: value.plotArea?.minimumWidthRatio,
    minimumHeightRatio: value.plotArea?.minimumHeightRatio,
  })) {
    const number = Number(ratio);
    if (!Number.isFinite(number) || number <= 0 || number > 1) {
      errors.push(resultError(
        "analysis_resolved_geometry_invalid",
        `Resolved plot-area ${name} is outside the supported range.`,
      ));
    }
  }
  if (
    Number(value.plotArea?.widthRatio) < Number(value.plotArea?.minimumWidthRatio)
    || Number(value.plotArea?.heightRatio) < Number(value.plotArea?.minimumHeightRatio)
  ) {
    errors.push(resultError(
      "analysis_resolved_geometry_invalid",
      "Resolved geometry falls below its accepted minimum plot-area ratio.",
    ));
  }
  for (const side of ["top", "right", "bottom", "left"]) {
    const margin = Number(value.marginsPx?.[side]);
    if (!Number.isFinite(margin) || margin < 0 || margin > 1000) {
      errors.push(resultError(
        "analysis_resolved_geometry_invalid",
        `Resolved ${side} margin is outside the supported range.`,
      ));
    }
  }
  errors.push(...finiteAndSafeErrors(value, "resolvedGeometry"));
  const byteLength = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (byteLength > MAX_RESOLVED_GEOMETRY_BYTES) {
    errors.push(resultError(
      "analysis_resolved_geometry_invalid",
      "Resolved geometry exceeds the bounded summary size.",
      { byteLength, maximumBytes: MAX_RESOLVED_GEOMETRY_BYTES },
    ));
  }
  return value;
}

function invariantValidation(invariants, traces, errors) {
  return asArray(invariants).flatMap((invariant, invariantIndex) => {
    if (invariant?.type === "x_group_y_sum") {
      const requestedNames = asArray(invariant.traceNames)
        .map((name) => String(name || "").trim())
        .filter(Boolean);
      const requestedSet = new Set(requestedNames);
      const matching = traces.filter((trace) => requestedSet.has(String(trace.name || "")));
      const missingNames = requestedNames.filter((name) => (
        !matching.some((trace) => String(trace.name || "") === name)
      ));
      if (missingNames.length) {
        errors.push(resultError(
          "analysis_invariant_trace_not_found",
          `The reviewed grouped sum check could not find series: ${missingNames.join(", ")}.`,
          { invariantIndex, traceNames: requestedNames, missingTraceNames: missingNames },
        ));
        return [];
      }

      const groups = new Map();
      matching.forEach((trace) => {
        asArray(trace.x).forEach((xValue, pointIndex) => {
          const key = `${typeof xValue}:${JSON.stringify(xValue)}`;
          const group = groups.get(key) || { xValue, actual: 0, pointCount: 0 };
          const yValue = asArray(trace.y)[pointIndex];
          if (typeof yValue === "number" && Number.isFinite(yValue)) {
            group.actual += yValue;
          }
          group.pointCount += 1;
          groups.set(key, group);
        });
      });

      const target = Number(invariant.target);
      const absoluteTolerance = Number(invariant.absoluteTolerance);
      const checks = [...groups.values()].map((group, groupIndex) => {
        const passed = Math.abs(group.actual - target) <= absoluteTolerance;
        return {
          id: `x_group_y_sum_${invariantIndex + 1}_${groupIndex + 1}`,
          type: "x_group_y_sum",
          traceNames: requestedNames,
          xValue: group.xValue,
          actual: group.actual,
          target,
          absoluteTolerance,
          passed,
        };
      });
      const failed = checks.filter((check) => !check.passed);
      if (failed.length) {
        const examples = failed.slice(0, 3).map((check) => (
          `${String(check.xValue)} = ${check.actual}`
        )).join("; ");
        errors.push(resultError(
          "analysis_invariant_failed",
          `${failed.length} X groups fall outside the reviewed target ${target} +/- ${absoluteTolerance}. Examples: ${examples}.`,
          { invariantIndex, failedCount: failed.length, examples: failed.slice(0, 3) },
        ));
      }
      return checks;
    }
    if (invariant?.type !== "trace_y_sum") return [];
    const requestedName = String(invariant.traceName || "").trim();
    const matching = requestedName
      ? traces.filter((trace) => String(trace.name || "") === requestedName)
      : traces;
    if (!matching.length) {
      errors.push(resultError(
        "analysis_invariant_trace_not_found",
        `The reviewed sum check could not find series ${requestedName || "(all series)"}.`,
        { invariantIndex, traceName: requestedName || null },
      ));
      return [];
    }
    return matching.map((trace) => {
      const values = asArray(trace.y);
      const target = Number(invariant.target);
      const absoluteTolerance = Number(invariant.absoluteTolerance);
      const actual = values.reduce((sum, value) => (
        typeof value === "number" && Number.isFinite(value) ? sum + value : sum
      ), 0);
      const passed = Math.abs(actual - target) <= absoluteTolerance;
      const item = {
        id: `trace_y_sum_${trace.meta.labrat.traceId}`,
        type: "trace_y_sum",
        traceId: trace.meta.labrat.traceId,
        traceName: trace.name,
        actual,
        target,
        absoluteTolerance,
        passed,
      };
      if (!passed) {
        errors.push(resultError(
          "analysis_invariant_failed",
          `Series ${trace.name} sums to ${actual}, outside the reviewed target ${target} +/- ${absoluteTolerance}.`,
          { invariantIndex, check: item },
        ));
      }
      return item;
    });
  });
}

export function validateAnalysisResult({
  run,
  plan,
  executorResult,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!executorResult?.ok) {
    errors.push(resultError(
      "analysis_executor_failed",
      executorResult?.error?.message || "Analysis executor did not complete successfully.",
      { executorError: executorResult?.error || null },
    ));
  }
  if (
    executorResult?.runtime?.version
    && executorResult.runtime.version !== ANALYSIS_RUNTIME_VERSION
  ) {
    errors.push(resultError(
      "analysis_runtime_mismatch",
      "Analysis output came from an unsupported runtime.",
    ));
  }
  const rawResult = isObject(executorResult?.result) ? executorResult.result : {};
  const rawPlotly = isObject(rawResult.plotly) ? rawResult.plotly : {};
  const rawData = asArray(rawPlotly.data);
  const rawLayout = isObject(rawPlotly.layout) ? rawPlotly.layout : {};
  if (!isObject(rawResult.plotly) || !Array.isArray(rawPlotly.data) || !isObject(rawPlotly.layout)) {
    errors.push(resultError(
      "analysis_plotly_result_required",
      "Python must return plotly.data and plotly.layout.",
    ));
  }
  if (!rawData.length) {
    errors.push(resultError(
      "analysis_plotly_traces_required",
      "Python returned no Plotly chart series.",
    ));
  }
  if (rawData.length > MAX_TRACES) {
    errors.push(resultError(
      "analysis_trace_limit_exceeded",
      `Analysis result contains more than ${MAX_TRACES} traces.`,
    ));
  }

  const traces = rawData.map(normalizeTrace);
  const seenTraceIds = new Set();
  let pointCount = 0;
  traces.forEach((trace, index) => {
    const id = trace.meta.labrat.traceId;
    if (!id || seenTraceIds.has(id)) {
      errors.push(resultError(
        "analysis_trace_id_invalid",
        id ? `Duplicate analysis trace id ${id}.` : "A Plotly trace id could not be assigned.",
        { traceIndex: index, traceId: id || null },
      ));
    }
    seenTraceIds.add(id);
    const type = String(trace.type || "scatter").trim();
    if (!ALLOWED_TRACE_TYPES.has(type)) {
      errors.push(resultError(
        "analysis_plotly_trace_type_unsupported",
        `Plotly trace ${id} uses unsupported type ${type}.`,
        { traceIndex: index, traceId: id, type },
      ));
    }
    const x = asArray(trace.x);
    const y = asArray(trace.y);
    pointCount += Math.max(x.length, y.length);
    if (!x.length || x.length !== y.length) {
      errors.push(resultError(
        "analysis_trace_length_mismatch",
        `Plotly trace ${id} requires equal non-empty x and y arrays.`,
        { traceIndex: index, traceId: id, xLength: x.length, yLength: y.length },
      ));
    }
    x.forEach((value, pointIndex) => {
      if (!plottableX(value)) {
        errors.push(resultError(
          "analysis_trace_x_value_invalid",
          `Plotly trace ${id} contains an invalid x value.`,
          { traceIndex: index, traceId: id, pointIndex },
        ));
      }
    });
    y.forEach((value, pointIndex) => {
      if (!plottableY(value)) {
        errors.push(resultError(
          "analysis_trace_y_value_invalid",
          `Plotly trace ${id} contains an invalid y value.`,
          { traceIndex: index, traceId: id, pointIndex },
        ));
      }
    });
  });
  if (pointCount > MAX_TRACE_POINTS) {
    errors.push(resultError(
      "analysis_trace_point_limit_exceeded",
      `Analysis result contains ${pointCount} points; maximum is ${MAX_TRACE_POINTS}.`,
      { pointCount, maxTracePoints: MAX_TRACE_POINTS },
    ));
  }

  errors.push(...finiteAndSafeErrors(traces, "plotly.data"));
  errors.push(...finiteAndSafeErrors(rawLayout, "plotly.layout"));
  const exclusions = asArray(rawResult.exclusions).map((item, index) => ({
    label: String(item?.label || `Excluded input ${index + 1}`),
    reason: String(item?.reason || "Excluded by the accepted analysis plan."),
  }));
  const checks = invariantValidation(plan?.reviewPlan?.invariants, traces, errors);
  const geometry = resolvedGeometry(rawResult.resolvedGeometry, executorResult?.adapter, errors);
  const result = {
    plotly: {
      data: traces,
      layout: structuredClone(rawLayout),
    },
    exclusions,
    checks,
    ...(geometry ? { resolvedGeometry: geometry } : {}),
    summary: {
      pointCount,
      seriesCount: traces.length,
      excludedCount: exclusions.length,
    },
    execution: {
      adapter: executorResult?.adapter || "unknown",
      runtime: executorResult?.runtime || {},
      stdout: String(executorResult?.stdout || "").slice(-4000),
      stderr: String(executorResult?.stderr || "").slice(-4000),
    },
  };
  const resultBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (resultBytes > MAX_RESULT_BYTES) {
    errors.push(resultError(
      "analysis_result_too_large",
      `Analysis result is ${resultBytes} bytes; maximum is ${MAX_RESULT_BYTES}.`,
      { resultBytes, maxBytes: MAX_RESULT_BYTES },
    ));
  }
  const validation = {
    ok: errors.length === 0,
    errors,
    warnings,
    runtimeVersion: ANALYSIS_RUNTIME_VERSION,
    traceCount: traces.length,
    pointCount,
    excludedCount: exclusions.length,
    checks,
  };
  const contentHash = stableDataHash(result);
  return {
    ok: validation.ok,
    result,
    validation,
    errors,
    warnings,
    contentHash,
    resultPreviewHash: stableDataHash({
      plotly: result.plotly,
      resolvedGeometry: geometry,
      exclusions,
      checks,
      validation,
    }),
  };
}

export const analysisResultLimits = Object.freeze({
  maxTraces: MAX_TRACES,
  maxTracePoints: MAX_TRACE_POINTS,
  maxResultBytes: MAX_RESULT_BYTES,
});
