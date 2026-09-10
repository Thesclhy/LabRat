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

test("generates structured prose for an existing chart without invoking chart planning", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.match(body.system, /existing accepted LabRat chart/);
      assert.match(body.system, /Never propose, plan, or create another chart/);
      return {
        ok: true,
        async json() {
          return {
            usage: { input_tokens: 42, output_tokens: 28 },
            content: [{
              type: "text",
              text: JSON.stringify({
                answer: "Conversion increases across the displayed reaction-time range for Catalyst A.",
              }),
            }],
          };
        },
      };
    },
  });

  const result = await provider.answerChartCommentary({
    mode: "analysis",
    chart: {
      chartSpecId: "chart_spec_1",
      title: "Conversion by time",
      visibleTraceIds: ["catalyst_a"],
      traces: [{ traceId: "catalyst_a", name: "Catalyst A", x: [1, 2], y: [35, 61] }],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.answer, "Conversion increases across the displayed reaction-time range for Catalyst A.");
  assert.deepEqual(result.metadata.usage, { inputTokens: 42, outputTokens: 28 });
});

test("DeepSeek uses task-specific thinking policies through the backend provider", async () => {
  const requests = [];
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "deepseek",
      deepseekApiKey: "deepseek-secret",
      deepseekModel: "deepseek-v4-pro",
      deepseekBaseUrl: "https://api.deepseek.com",
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      requests.push(body);
      if (requests.length === 1) {
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    intent: "project_overview",
                    disposition: "direct_answer",
                    confidence: 0.9,
                    clarification: null,
                  }),
                },
              }],
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  requestSummary: "Create a chart.",
                  sourceSelections: [],
                  experimentSelections: [],
                  reviewPlan: {
                    processingSteps: ["Use accepted data."],
                    missingValueHandling: "Exclude missing values.",
                    chart: {
                      title: "Accepted data",
                      chartType: "bar",
                      xDescription: "Experiment",
                      yDescription: "Value",
                      seriesDescription: "One series",
                    },
                    invariants: [],
                  },
                  displayPlan: ["Create a bar chart."],
                  warnings: [],
                }),
              },
            }],
          };
        },
      };
    },
  });

  const intent = await provider.classifyIntent({ message: "What is this project?" });
  const plan = await provider.draftAnalysisPlan({ originalRequest: "Create a chart." }, {
    inspectSourceRange: async () => ({}),
  });

  assert.equal(intent.ok, true);
  assert.equal(plan.ok, true);
  assert.deepEqual(requests[0].thinking, { type: "disabled" });
  assert.deepEqual(requests[1].thinking, { type: "enabled" });
  assert.equal(requests[1].reasoning_effort, "high");
  assert.equal(requests[1].tools[0].function.name, "inspect_source_range");
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
                intent: "project_overview",
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

test("preserves bounded Anthropic request diagnostics", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      async json() {
        return { error: { message: "Unsupported structured output keyword." } };
      },
    }),
  });

  const result = await provider.classifyIntent({ message: "Compare these experiments." });

  assert.equal(result.ok, false);
  assert.equal(result.warning.code, "ai_request_failed");
  assert.equal(result.warning.detail, "Unsupported structured output keyword.");
});

test("preserves bounded Anthropic transport diagnostics", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async () => {
      const error = new TypeError("fetch failed");
      error.cause = { code: "ECONNRESET" };
      throw error;
    },
  });

  const result = await provider.classifyIntent({ message: "Compare these experiments." });

  assert.equal(result.ok, false);
  assert.equal(result.warning.code, "ai_request_failed");
  assert.match(result.warning.detail, /TypeError: ECONNRESET: fetch failed/);
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
      assert.match(body.tools[0].description, /2500 cells/);
      assert.equal(body.output_config.format.type, "json_schema");
      assert.deepEqual(body.output_config.format.schema.required, [
        "requestSummary",
        "sourceSelections",
        "experimentSelections",
        "reviewPlan",
        "displayPlan",
        "warnings",
      ]);
      assert.equal(body.output_config.format.schema.additionalProperties, false);
      assert.equal(
        "minimum" in body.output_config.format.schema.properties
          .experimentSelections.items.properties.columnIndexes.items,
        false,
      );
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
                experimentSelections: [],
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

test("draftExperimentBrowserPlan uses an Anthropic-compatible empty invariants schema", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      const invariantsSchema = body.output_config.format.schema
        .properties.reviewPlan.properties.invariants;
      assert.equal("maxItems" in invariantsSchema, false);
      assert.equal(invariantsSchema.items.type, "object");
      assert.match(body.system, /invariants as an empty array/i);
      assert.match(body.system, /count actual non-header data rows/i);
      assert.match(body.system, /distinguish creating new experiment records from appending/i);
      assert.match(body.system, /remain selected source-backed null fields/i);
      assert.match(body.system, /zero-based columnIndexes/i);
      assert.equal(Object.hasOwn(body.output_config.format.schema.properties, "fieldTargets"), false);
      assert.equal(
        "minimum" in body.output_config.format.schema.properties
          .experimentSelections.items.properties.columnIndexes.items,
        false,
      );
      assert.equal(body.tools[0].name, "inspect_source_range");
      assert.match(body.tools[0].description, /2500 cells/);
      return {
        ok: true,
        async json() {
          return {
            usage: { input_tokens: 10, output_tokens: 20 },
            content: [{
              type: "text",
              text: JSON.stringify({
                requestSummary: "Publish Exp1.",
                sourceSelections: [{
                  regionUnderstandingRevisionId: "revision_1",
                  sourceDocumentId: "source_1",
                  sheetName: "Runs",
                  range: "A1:C2",
                  label: "Exp1",
                  purpose: "Read the accepted experiment row.",
                }],
                experimentSelections: [],
                reviewPlan: {
                  processingSteps: ["Read Exp1 and publish its fields."],
                  missingValueHandling: "Exclude rows without an experiment label.",
                  experimentOutput: { summary: "Add Exp1 fields." },
                  browserView: { summary: "Show the new fields." },
                  invariants: [],
                },
                displayPlan: ["Add Exp1 and show the new fields."],
                warnings: [],
              }),
            }],
          };
        },
      };
    },
  });

  const result = await provider.draftExperimentBrowserPlan({
    originalRequest: "Publish Exp1.",
    confirmedRegions: [],
    activeExperiments: [],
  }, {
    inspectSourceRange: async () => ({}),
  });

  assert.equal(result.ok, true);
  assert.equal(result.reviewPlan.invariants.length, 0);
});

test("DeepSeek drafts Experiment Browser plans without thinking", async () => {
  let requestBody = null;
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "deepseek",
      deepseekApiKey: "deepseek-secret",
      deepseekModel: "deepseek-v4-pro",
      deepseekBaseUrl: "https://api.deepseek.com",
    },
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  requestSummary: "Publish Exp1.",
                  sourceSelections: [],
                  experimentSelections: [],
                  reviewPlan: {
                    processingSteps: ["Read Exp1."],
                    missingValueHandling: "Keep missing values as null.",
                    experimentOutput: { summary: "Add Exp1." },
                    browserView: { summary: "Show Exp1." },
                    invariants: [],
                  },
                  displayPlan: ["Add Exp1."],
                  warnings: [],
                }),
              },
            }],
          };
        },
      };
    },
  });

  const result = await provider.draftExperimentBrowserPlan({
    originalRequest: "Publish Exp1.",
    confirmedRegions: [],
    activeExperiments: [],
  }, {
    inspectSourceRange: async () => ({}),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.equal(Object.hasOwn(requestBody, "reasoning_effort"), false);
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
      assert.match(body.system, /Generated Python cannot call inspect_run_input/i);
      assert.match(body.system, /Treat null as missing scientific data/i);
      assert.match(body.system, /Never convert a missing value to zero/i);
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

test("draftExperimentBrowserProgram describes indexed columns and backend-assigned ids", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.match(body.system, /inputs\['tables'\].*always lists, never dictionaries/i);
      assert.match(body.system, /tables_by_id = \{item\['tableId'\]/);
      assert.match(body.system, /row-major lists of lists/i);
      assert.match(body.system, /columns, recordPatches, values, upsertSeries/i);
      assert.match(body.system, /do not upsert an existing field merely to preserve it/i);
      assert.match(body.system, /seriesKey.*label.*xField.*yField/i);
      assert.match(body.system, /Do not output Browser view state/i);
      assert.match(body.system, /Generated Python cannot call either inspection tool/i);
      assert.match(body.system, /value None.*formattedValue None.*missingReason/i);
      assert.match(body.system, /columnIndex.*zero-based index into the output columns list/i);
      assert.match(body.system, /backend assigns an internal random columnId/i);
      assert.match(body.system, /Duplicate display names.*allowed/i);
      assert.match(body.system, /String categories such as impeller names.*ordinary string/i);
      assert.doesNotMatch(body.system, /targetFields list is authoritative/i);
      assert.match(body.system, /Do not output zero, a placeholder string, NaN, or Infinity/i);
      assert.match(body.system, /must cite the exact missing workbook cell/i);
      assert.deepEqual(body.tools.map((tool) => tool.name), [
        "inspect_run_input",
        "inspect_experiment_input",
      ]);
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
                  source: "def analyze(inputs, labrat):\n    tables = {item['tableId']: item for item in inputs['tables']}\n    return {'columns': [], 'recordPatches': [], 'exclusions': []}",
                },
              }),
            }],
          };
        },
      };
    },
  });

  const result = await provider.draftExperimentBrowserProgram({
    acceptedPlan: { displayPlan: ["Add two series."] },
    inputManifest: {
      tables: [{ tableId: "table_1" }, { tableId: "table_2" }],
      experiments: [{ experimentId: "experiment_1" }],
    },
  }, {
    inspectRunInput: async () => ({ tableId: "table_1", values: [[1]] }),
    inspectExperimentInput: async () => ({ experimentId: "experiment_1", fields: [] }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.pythonProgram.entrypoint, "analyze");
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
