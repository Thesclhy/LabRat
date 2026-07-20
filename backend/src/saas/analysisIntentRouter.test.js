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
