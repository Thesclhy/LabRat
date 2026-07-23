import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANALYSIS_PLAN_REVISION_VERSION,
  frozenPlanHash,
  validateAnalysisPlanRevision,
} from "./analysisSchemas.js";

function validPlan() {
  return {
    schemaVersion: ANALYSIS_PLAN_REVISION_VERSION,
    status: "awaiting_review",
    requestSummary: "Compare carbon-number distributions for Exp32 and Exp33.",
    sourceSelections: [{
      sourceSelectionId: "selection_exp32",
      regionUnderstandingRevisionId: "revision_exp32",
      sourceDocumentId: "source_exp32",
      workbookName: "Exp32.xlsx",
      sheetName: "Carbon",
      range: "B4:H5",
    }, {
      sourceSelectionId: "selection_exp33",
      regionUnderstandingRevisionId: "revision_exp33",
      sourceDocumentId: "source_exp33",
      workbookName: "Exp33.xlsx",
      sheetName: "Carbon",
      range: "Q69:AI69",
    }],
    reviewPlan: {
      processingSteps: [
        "Read carbon labels and values from both selected ranges.",
        "Create one bar series per experiment.",
      ],
      chart: {
        title: "Carbon number distribution",
        chartType: "bar",
        xDescription: "Carbon number",
        yDescription: "Distribution",
        seriesDescription: "One series per selected experiment",
      },
      invariants: [],
    },
    displayPlan: [
      "Use the two red source ranges.",
      "Plot carbon number on X and distribution on Y.",
    ],
    warnings: [],
  };
}

test("accepts source selections and a readable review plan without Python", () => {
  const plan = validPlan();
  const result = validateAnalysisPlanRevision(plan);

  assert.equal(result.ok, true);
  assert.equal(result.planHash, frozenPlanHash(plan));
  assert.equal(Object.hasOwn(plan, "pythonProgram"), false);
});

test("rejects plans without exact source selections or readable chart semantics", () => {
  const plan = validPlan();
  plan.sourceSelections = [];
  plan.reviewPlan.chart.xDescription = "";

  const result = validateAnalysisPlanRevision(plan);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map((item) => item.code),
    ["analysis_source_selection_required", "analysis_chart_plan_required"],
  );
});

test("rejects Python, result values, and traces inside a reviewable plan", () => {
  const plan = validPlan();
  plan.pythonProgram = { source: "def analyze(inputs, labrat): pass" };
  plan.reviewPlan.values = [1, 2, 3];

  const result = validateAnalysisPlanRevision(plan);

  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((item) => item.code === "analysis_plan_execution_payload_forbidden"),
    true,
  );
});

test("accepts only explicit supported result invariants", () => {
  const plan = validPlan();
  plan.reviewPlan.invariants = [{
    type: "trace_y_sum",
    traceName: "Exp33",
    target: 100,
    absoluteTolerance: 0.01,
  }];
  assert.equal(validateAnalysisPlanRevision(plan).ok, true);

  plan.reviewPlan.invariants = [{
    type: "x_group_y_sum",
    traceNames: ["Solid", "Liquid", "Gas"],
    target: 100,
    absoluteTolerance: 0.01,
  }];
  assert.equal(validateAnalysisPlanRevision(plan).ok, true);

  plan.reviewPlan.invariants = [{
    type: "x_group_y_sum",
    traceNames: [],
    target: 100,
    absoluteTolerance: 0.01,
  }];
  assert.equal(validateAnalysisPlanRevision(plan).ok, false);

  plan.reviewPlan.invariants = [{ type: "row_count" }];
  const result = validateAnalysisPlanRevision(plan);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "analysis_invariant_unsupported");
});
