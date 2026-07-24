import assert from "node:assert/strict";
import test from "node:test";

import { routeAnalysisIntent } from "./analysisIntentRouter.js";

const projectContext = {
  projectId: "project_1",
  publishedExperimentCount: 60,
  sourceDocumentCount: 1,
};

test("routes derived experiment overview requests into reviewed analysis", async () => {
  const result = await routeAnalysisIntent({
    message: "Give me a one-paragraph overview of the trends across all experiments.",
    projectContext,
  });

  assert.equal(result.intent, "experiment_overview");
  assert.equal(result.disposition, "analysis_thread");
  assert.equal(result.actionType, null);
  assert.equal(result.metadata.provider, "deterministic");
});

test("routes experiment-purpose questions to a direct answer", async () => {
  const result = await routeAnalysisIntent({
    message: "What is this experiment for?",
    projectContext,
  });

  assert.equal(result.intent, "project_purpose");
  assert.equal(result.disposition, "direct_answer");
});

test("keeps explicit Browser navigation deterministic", async () => {
  const result = await routeAnalysisIntent({
    message: "Open Experiment Browser and filter Exp12.",
    projectContext,
  });

  assert.equal(result.intent, "open_or_filter_browser");
  assert.equal(result.disposition, "action");
  assert.equal(result.actionType, "open_experiment_browser");
});

test("forces Browser data changes into an Experiment Browser analysis thread", async () => {
  const result = await routeAnalysisIntent({
    message: "Add normalized selectivity and keep the existing columns.",
    selectedContext: {
      tab: "experiment_browser",
      analysisOutputTarget: "experiment_browser",
    },
    projectContext,
  });

  assert.equal(result.intent, "publish_experiment_data");
  assert.equal(result.disposition, "analysis_thread");
  assert.equal(result.actionType, null);
});

test("routes series additions to a Browser view without requiring exact product wording", async () => {
  const result = await routeAnalysisIntent({
    message: "Add the two confirmed Exp1 reaction-rate series to the existing Exp1 record. Preserve every existing scalar field and show the updated experiment in a new Browser view.",
    projectContext,
  });

  assert.equal(result.intent, "publish_experiment_data");
  assert.equal(result.disposition, "analysis_thread");
  assert.equal(result.actionType, null);
  assert.equal(result.metadata.provider, "deterministic");
});

test("routes data from an already uploaded workbook into Browser publication", async () => {
  const result = await routeAnalysisIntent({
    message: "Add the selectivity columns from MasterTable_updated.xlsx to Experiment Browser.",
    projectContext,
  });

  assert.equal(result.intent, "publish_experiment_data");
  assert.equal(result.disposition, "analysis_thread");
  assert.equal(result.actionType, null);
});

test("uses the active Browser surface to route concise data changes", async () => {
  const result = await routeAnalysisIntent({
    message: "Add normalized selectivity to Exp31.",
    selectedContext: {
      tab: "browser",
      activeSurface: "browser",
    },
    projectContext,
  });

  assert.equal(result.intent, "publish_experiment_data");
  assert.equal(result.disposition, "analysis_thread");
});

test("keeps a substantive Browser data change when the user also asks to show it", async () => {
  const result = await routeAnalysisIntent({
    message: "Add normalized selectivity to Exp31 and show it in the new view.",
    selectedContext: { activeSurface: "browser" },
    projectContext,
  });

  assert.equal(result.intent, "publish_experiment_data");
});

test("does not turn Browser display or chart requests into data publication", async () => {
  const displayResult = await routeAnalysisIntent({
    message: "Show Exp31.",
    selectedContext: { activeSurface: "browser" },
    projectContext,
  });
  const chartResult = await routeAnalysisIntent({
    message: "Draw a chart for Exp31.",
    selectedContext: { activeSurface: "browser" },
    projectContext,
  });

  assert.notEqual(displayResult.intent, "publish_experiment_data");
  assert.equal(chartResult.intent, "create_analysis_chart");
});

test("keeps explicit upload commands ahead of model classification", async () => {
  let modelCalled = false;
  const result = await routeAnalysisIntent({
    message: "Upload this Excel workbook.",
    projectContext,
    modelProvider: {
      async classifyIntent() {
        modelCalled = true;
        return { intent: "experiment_overview", disposition: "analysis_thread" };
      },
    },
  });

  assert.equal(result.intent, "upload_workbook");
  assert.equal(result.actionType, "upload_workbook_for_review");
  assert.equal(modelCalled, false);
});

test("uses bounded provider classification for ambiguous questions", async () => {
  const result = await routeAnalysisIntent({
    message: "How do these relate?",
    selectedContext: { selectedExperimentIds: ["experiment_1", "experiment_2"] },
    projectContext,
    modelProvider: {
      async classifyIntent(input) {
        assert.deepEqual(input.selectedContextKeys, ["selectedExperimentIds"]);
        assert.deepEqual(input.selectedContext, {
          tab: "",
          activeSurface: "",
          analysisOutputTarget: "",
          requestedWorkflow: "",
          hasSelectedExperiment: false,
          hasSelectedChart: false,
        });
        assert.equal("records" in input, false);
        return {
          intent: "experiment_compare",
          disposition: "analysis_thread",
          confidence: 0.82,
          clarification: null,
          metadata: {
            provider: "anthropic",
            model: "test-model",
            latencyMs: 14,
            usage: { inputTokens: 20, outputTokens: 6 },
          },
        };
      },
    },
  });

  assert.equal(result.intent, "experiment_compare");
  assert.equal(result.disposition, "analysis_thread");
  assert.equal(result.metadata.provider, "anthropic");
});

test("invalid provider output becomes clarification instead of a Browser action", async () => {
  const result = await routeAnalysisIntent({
    message: "Please investigate this.",
    projectContext,
    modelProvider: {
      async classifyIntent() {
        return {
          intent: "invent_values",
          disposition: "open_experiment_browser",
        };
      },
    },
  });

  assert.equal(result.intent, "clarification");
  assert.equal(result.disposition, "clarification");
  assert.equal(result.actionType, null);
});
