import assert from "node:assert/strict";
import test from "node:test";

import { createBackendModelProvider } from "./backendModelProvider.js";

test("reports unavailable without exposing a browser credential path", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "",
      anthropicModel: "claude-test",
    },
  });

  const result = await provider.classifyIntent({ message: "How do these compare?" });

  assert.equal(result.ok, false);
  assert.equal(result.warning.code, "ai_unavailable");
  assert.equal(provider.publicConfig().configured, false);
  assert.equal("apiKey" in provider.publicConfig(), false);
});

test("validates and returns structured intent metadata", async () => {
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.model, "claude-test");
    assert.equal(body.stream, undefined);
    return {
      ok: true,
      async json() {
        return {
          usage: { input_tokens: 31, output_tokens: 12 },
          content: [{
            type: "text",
            text: JSON.stringify({
              intent: "experiment_compare",
              disposition: "analysis_thread",
              confidence: 0.91,
              clarification: null,
            }),
          }],
        };
      },
    };
  };
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl,
    now: (() => {
      let value = 100;
      return () => {
        value += 7;
        return value;
      };
    })(),
  });

  const result = await provider.classifyIntent({
    message: "Compare these experiments.",
    projectContext: { publishedExperimentCount: 2 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.intent, "experiment_compare");
  assert.equal(result.disposition, "analysis_thread");
  assert.deepEqual(result.metadata, {
    provider: "anthropic",
    model: "claude-test",
    latencyMs: 7,
    usage: { inputTokens: 31, outputTokens: 12 },
  });
});

test("passes request cancellation through to the Anthropic fetch", async () => {
  const controller = new AbortController();
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async (_url, request) => {
      assert.equal(request.signal, controller.signal);
      return {
        ok: true,
        async json() {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                intent: "project_summary",
                disposition: "direct_answer",
                confidence: 0.95,
                clarification: null,
              }),
            }],
          };
        },
      };
    },
  });

  const result = await provider.classifyIntent(
    { message: "Summarize this project." },
    { signal: controller.signal },
  );

  assert.equal(result.ok, true);
});

test("rejects malformed provider JSON as a bounded warning", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { content: [{ type: "text", text: "not-json" }] };
      },
    }),
  });

  const result = await provider.classifyIntent({ message: "Compare these experiments." });

  assert.equal(result.ok, false);
  assert.equal(result.warning.code, "ai_invalid_response");
});

test("draftAnalysisPlan selects exact confirmed ranges without generating Python", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.match(body.system, /sourceSelections/);
      assert.match(body.system, /confirmed workbook region/i);
      assert.match(body.system, /Do not write Python/i);
      assert.match(body.system, /repairContext/);
      assert.equal(body.tools[0].name, "inspect_source_range");
      assert.equal(body.output_config.format.type, "json_schema");
      assert.deepEqual(body.output_config.format.schema.required, [
        "requestSummary",
        "sourceSelections",
        "reviewPlan",
        "displayPlan",
        "warnings",
      ]);
      assert.equal(body.output_config.format.schema.additionalProperties, false);
      assert.ok(body.max_tokens >= 6000);
      return {
        ok: true,
        async json() {
          return {
            usage: { input_tokens: 20, output_tokens: 40 },
            content: [{
              type: "text",
              text: JSON.stringify({
                requestSummary: "Compare Exp32 and Exp33.",
                sourceSelections: [{
                  regionUnderstandingRevisionId: "region_revision_1",
                  sourceDocumentId: "source_1",
                  sheetName: "Carbon",
                  range: "A2:H3",
                  label: "Carbon distributions",
                  purpose: "Create one series per experiment",
                }],
                reviewPlan: {
                  processingSteps: ["Read the selected carbon values."],
                  missingValueHandling: "Exclude a selected experiment only when its row is empty.",
                  chart: {
                    title: "Carbon distribution",
                    chartType: "bar",
                    xDescription: "Carbon number",
                    yDescription: "Distribution",
                    seriesDescription: "One series per experiment",
                  },
                  invariants: [],
                },
                displayPlan: ["Use the red range and create one curve per experiment."],
                warnings: [],
              }),
            }],
          };
        },
      };
    },
  });

  const result = await provider.draftAnalysisPlan({
    originalRequest: "Compare the experiments.",
    confirmedRegions: [{ regionUnderstandingRevisionId: "region_revision_1" }],
  }, {
    inspectSourceRange: async () => ({ cells: [] }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceSelections[0].range, "A2:H3");
  assert.equal(Object.hasOwn(result, "pythonProgram"), false);
});

test("draftAnalysisProgram sees exact inputs and returns Python only after plan acceptance", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.match(body.system, /analyze\(inputs, labrat\)/);
      assert.match(body.system, /inputs\['tables'\]/);
      assert.match(body.system, /Plotly data is authoritative/i);
      assert.equal(body.tools[0].name, "inspect_run_input");
      return {
        ok: true,
        async json() {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                pythonProgram: {
                  runtime: "labrat-python-v2",
                  entrypoint: "analyze",
                  source: "def analyze(inputs, labrat):\n    return {'plotly': {'data': [{'type': 'bar', 'x': ['C1'], 'y': [1]}], 'layout': {}}, 'exclusions': [], 'checks': []}",
                },
              }),
            }],
          };
        },
      };
    },
  });

  const result = await provider.draftAnalysisProgram({
    acceptedPlan: { displayPlan: ["Draw one bar."] },
    inputManifest: { tables: [{ tableId: "table_1" }] },
  }, {
    inspectRunInput: async () => ({ tableId: "table_1", values: [[1]] }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.pythonProgram.runtime, "labrat-python-v2");
});

test("interpretWorkbookRegion requests a concise structured region explanation", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      const payload = JSON.parse(body.messages[0].content);
      assert.match(body.system, /two to four short sentences/i);
      assert.match(body.system, /sparse correction patch/i);
      assert.match(body.system, /do not infer experiment counts.*bounded inspection/i);
      assert.equal(body.output_config.format.type, "json_schema");
      assert.deepEqual(body.output_config.format.schema.required, ["summary", "interpretation"]);
      assert.equal(body.output_config.format.schema.additionalProperties, false);
      const interpretationSchema = body.output_config.format.schema.properties.interpretation;
      assert.deepEqual(interpretationSchema.required, Object.keys(interpretationSchema.properties));
      assert.deepEqual(
        interpretationSchema.properties.fieldPatches.items.required,
        Object.keys(interpretationSchema.properties.fieldPatches.items.properties),
      );
      const roleSchema = interpretationSchema.properties.fieldPatches.items.properties.role;
      assert.ok(roleSchema.enum.includes(""));
      assert.ok(roleSchema.enum.includes("outcome"));
      assert.equal(roleSchema.enum.includes("measurement"), false);
      assert.ok(body.max_tokens >= 3000);
      assert.equal(payload.region.sheetName, "Runs");
      assert.equal(payload.region.inspection.cells.length, 4);
      assert.equal("completeWorkbook" in payload, false);
      return {
        ok: true,
        async json() {
          return {
            usage: { input_tokens: 50, output_tokens: 30 },
            content: [{
              type: "text",
              text: JSON.stringify({
                summary: [
                  "Each row represents one experiment.",
                  "The first row contains field labels.",
                ],
                interpretation: {
                  semanticType: "experiment_table",
                  experimentAxis: "rows",
                  headerRow: 1,
                  experimentIdColumn: "A",
                  experimentLabel: "",
                  fieldPatches: [{
                    column: "B",
                    semanticKey: "temperature",
                    displayName: "",
                    role: "condition",
                    valueType: "number",
                    unit: "",
                  }],
                  confidence: 0.9,
                },
              }),
            }],
          };
        },
      };
    },
  });

  const result = await provider.interpretWorkbookRegion({
    workbook: { workbookName: "Master.xlsx", sheets: [{ name: "Runs", usedRange: "A1:D3" }] },
    region: {
      sheetName: "Runs",
      range: "A1:D3",
      inspection: { cells: [{ cell: "A1" }, { cell: "B1" }, { cell: "A2" }, { cell: "B2" }] },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.length, 2);
  assert.equal(result.interpretation.experimentAxis, "rows");
  assert.equal("experimentLabel" in result.interpretation, false);
  assert.deepEqual(result.interpretation.fieldPatches, [{
    column: "B",
    semanticKey: "temperature",
    role: "condition",
    valueType: "number",
  }]);
  assert.equal(result.metadata.provider, "anthropic");
});

test("reports truncated workbook-region output separately from malformed JSON", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "{\"summary\":[" }],
        };
      },
    }),
  });

  const result = await provider.interpretWorkbookRegion({
    workbook: { workbookName: "Master.xlsx", sheets: [{ name: "Runs", usedRange: "A1:Y63" }] },
    region: {
      sheetName: "Runs",
      range: "A1:Y63",
      inspection: { cells: [{ cell: "A1" }] },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.warning.code, "ai_output_truncated");
});
