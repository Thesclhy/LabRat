import assert from "node:assert/strict";
import { test } from "node:test";

import { ANALYSIS_RUNTIME_VERSION } from "./analysisSchemas.js";
import { validateAnalysisResult } from "./analysisResultValidation.js";

function executorResult(result) {
  return {
    ok: true,
    adapter: "local_non_production",
    runtime: { version: ANALYSIS_RUNTIME_VERSION },
    result,
  };
}

function plotlyResult(overrides = {}) {
  return {
    plotly: {
      data: [{
        type: "bar",
        name: "Exp33",
        x: ["C1", "C2", "C3"],
        y: [20, 30, 50],
      }],
      layout: {
        title: { text: "Carbon number distribution" },
        xaxis: { title: { text: "Carbon number" } },
        yaxis: { title: { text: "Distribution (%)" } },
      },
    },
    exclusions: [],
    checks: [],
    ...overrides,
  };
}

test("accepts authoritative Plotly and deterministically assigns trace ids", () => {
  const validated = validateAnalysisResult({
    run: { id: "run_1" },
    plan: { reviewPlan: { invariants: [] } },
    executorResult: executorResult(plotlyResult()),
  });

  assert.equal(validated.ok, true);
  assert.equal(validated.result.summary.pointCount, 3);
  assert.equal(validated.result.summary.seriesCount, 1);
  assert.equal(validated.result.plotly.data[0].traceId, "trace_1");
  assert.equal(validated.result.plotly.data[0].meta.labrat.traceId, "trace_1");
  assert.match(validated.contentHash, /^sha256_/);
});

test("preserves multiple tables as independent Plotly curves and readable exclusions", () => {
  const validated = validateAnalysisResult({
    plan: { reviewPlan: { invariants: [] } },
    executorResult: executorResult(plotlyResult({
      plotly: {
        data: [{
          traceId: "exp32",
          type: "scatter",
          mode: "lines+markers",
          name: "Exp32",
          x: ["C1", "C2"],
          y: [4, 8],
        }, {
          traceId: "exp33",
          type: "scatter",
          mode: "lines+markers",
          name: "Exp33",
          x: ["C1", "C2"],
          y: [5, 9],
        }],
        layout: { title: "Comparison" },
      },
      exclusions: [{ label: "Exp31", reason: "No carbon table was selected." }],
    })),
  });

  assert.equal(validated.ok, true);
  assert.deepEqual(
    validated.result.plotly.data.map((trace) => trace.traceId),
    ["exp32", "exp33"],
  );
  assert.deepEqual(validated.result.exclusions, [{
    label: "Exp31",
    reason: "No carbon table was selected.",
  }]);
});

test("rejects empty, mismatched, non-finite, and unsupported Plotly traces", () => {
  const validated = validateAnalysisResult({
    plan: { reviewPlan: { invariants: [] } },
    executorResult: executorResult({
      plotly: {
        data: [{
          type: "pie",
          x: ["C1", "C2"],
          y: [1],
        }, {
          type: "bar",
          x: ["C1"],
          y: [Number.POSITIVE_INFINITY],
        }],
        layout: {},
      },
    }),
  });

  assert.equal(validated.ok, false);
  const codes = validated.errors.map((item) => item.code);
  assert.equal(codes.includes("analysis_plotly_trace_type_unsupported"), true);
  assert.equal(codes.includes("analysis_trace_length_mismatch"), true);
  assert.equal(codes.includes("analysis_trace_y_value_invalid"), true);
  assert.equal(codes.includes("analysis_non_finite_value"), true);
});

test("rejects unsafe Plotly properties and script-bearing strings", () => {
  const validated = validateAnalysisResult({
    plan: { reviewPlan: { invariants: [] } },
    executorResult: executorResult(plotlyResult({
      plotly: {
        data: [{
          type: "bar",
          x: ["C1"],
          y: [1],
          hovertemplate: "<script>alert(1)</script>",
        }],
        layout: { images: [{ source: "javascript:alert(1)" }] },
      },
    })),
  });

  assert.equal(validated.ok, false);
  const codes = validated.errors.map((item) => item.code);
  assert.equal(codes.includes("analysis_plotly_property_unsupported"), true);
  assert.equal(codes.includes("analysis_plotly_unsafe_string"), true);
});

test("recomputes only invariants explicitly declared by the reviewed plan", () => {
  const accepted = validateAnalysisResult({
    plan: {
      reviewPlan: {
        invariants: [{
          type: "trace_y_sum",
          traceName: "Exp33",
          target: 100,
          absoluteTolerance: 0.001,
        }],
      },
    },
    executorResult: executorResult(plotlyResult()),
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.result.checks[0].actual, 100);

  const rejected = validateAnalysisResult({
    plan: {
      reviewPlan: {
        invariants: [{
          type: "trace_y_sum",
          traceName: "Exp33",
          target: 1,
          absoluteTolerance: 0,
        }],
      },
    },
    executorResult: executorResult(plotlyResult()),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors.at(-1).code, "analysis_invariant_failed");
});

test("validates stacked components against the target at each shared X category", () => {
  const accepted = validateAnalysisResult({
    plan: {
      reviewPlan: {
        invariants: [{
          type: "x_group_y_sum",
          traceNames: ["Solid", "Liquid", "Gas"],
          target: 100,
          absoluteTolerance: 0.001,
        }],
      },
    },
    executorResult: executorResult(plotlyResult({
      plotly: {
        data: [{
          type: "bar",
          name: "Solid",
          x: ["ExpA", "ExpB"],
          y: [80, 50],
        }, {
          type: "bar",
          name: "Liquid",
          x: ["ExpA", "ExpB"],
          y: [15, 30],
        }, {
          type: "bar",
          name: "Gas",
          x: ["ExpA", "ExpB"],
          y: [5, 20],
        }],
        layout: { barmode: "stack" },
      },
    })),
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(
    accepted.result.checks.map((check) => [check.xValue, check.actual]),
    [["ExpA", 100], ["ExpB", 100]],
  );

  const rejected = validateAnalysisResult({
    plan: {
      reviewPlan: {
        invariants: [{
          type: "x_group_y_sum",
          traceNames: ["Solid", "Liquid", "Gas"],
          target: 100,
          absoluteTolerance: 0.001,
        }],
      },
    },
    executorResult: executorResult(plotlyResult({
      plotly: {
        data: [{
          type: "bar",
          name: "Solid",
          x: ["ExpA"],
          y: [80],
        }, {
          type: "bar",
          name: "Liquid",
          x: ["ExpA"],
          y: [15],
        }, {
          type: "bar",
          name: "Gas",
          x: ["ExpA"],
          y: [4],
        }],
        layout: { barmode: "stack" },
      },
    })),
  });
  assert.equal(rejected.ok, false);
  assert.match(
    rejected.errors.find((item) => item.code === "analysis_invariant_failed").message,
    /1 X groups/,
  );
});
