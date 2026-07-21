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

test("draftAnalysisPlan requests the backend-reviewed selection and program shape", async () => {
  const provider = createBackendModelProvider({
    config: {
      aiProvider: "anthropic",
      anthropicApiKey: "server-secret",
      anthropicModel: "claude-test",
    },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.match(body.system, /selectionRequest/);
      assert.match(body.system, /pythonProgram/);
      assert.match(body.system, /Do not return selection hashes/);
      assert.match(body.system, /experiment_traces/);
      assert.match(body.system, /excludedRecords/);
      assert.match(body.system, /sourceRecordIds/);
      return {
        ok: true,
        async json() {
          return {
            usage: { input_tokens: 20, output_tokens: 40 },
            content: [{
              type: "text",
              text: JSON.stringify({
                selectionRequest: {
                  experimentIds: [],
                  fieldIds: ["field_1"],
                  includeSeries: false,
                },
                plan: {
                  requestSummary: "Compare field 1.",
                  pythonProgram: {
                    runtime: "labrat-python-v1",
                    entrypoint: "analyze",
                    source: "def analyze(tables, labrat):\n    return {}",
                  },
                },
              }),
            }],
          };
        },
      };
    },
  });

  const result = await provider.draftAnalysisPlan({
    originalRequest: "Compare the experiments.",
    fields: [{ fieldId: "field_1" }],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.selectionRequest.fieldIds, ["field_1"]);
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
      assert.match(body.system, /structured interpretation/i);
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
                  fields: [],
                  series: [],
                  inclusion: { startRow: 2, endRow: 3, skippedRows: [] },
                  confidence: 0.9,
                  warnings: [],
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
  assert.equal(result.metadata.provider, "anthropic");
});
