import assert from "node:assert/strict";

import { createServer } from "../src/server.js";
import { createBackendModelProvider } from "../src/saas/backendModelProvider.js";
import { loadSaasConfig } from "../src/saas/config.js";
import { MemorySaasStore } from "../src/saas/memoryStore.js";

const SMOKE_REVISION_ID = "smoke_region_revision_1";
const SMOKE_SOURCE_ID = "smoke_source_document_1";

function safeProviderFailure(result, operation) {
  const code = result?.warning?.code || "unknown_error";
  const message = result?.warning?.message || "Provider request failed.";
  const detail = String(result?.warning?.detail || "").trim();
  throw new Error(`${operation} failed (${code}): ${message}${detail ? ` ${detail}` : ""}`);
}

async function authenticatedCapabilitySmoke({ config, modelProvider }) {
  const server = createServer({
    config,
    store: new MemorySaasStore({ seedDevAccounts: true }),
    modelProvider,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "labuser", password: "LabRatLab123!" }),
    });
    assert.equal(login.status, 200, "development login failed");
    const cookie = String(login.headers.get("set-cookie") || "").split(";", 1)[0];
    assert.ok(cookie, "development login did not return a session cookie");

    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        labId: "lab_hanqi_test",
        name: "Disposable AI provider smoke project",
      }),
    });
    assert.equal(projectResponse.status, 201, "disposable project creation failed");
    const projectBody = await projectResponse.json();
    const projectId = projectBody?.project?.id;
    assert.ok(projectId, "disposable project id was missing");

    const capabilityResponse = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/analysis-capabilities`,
      { headers: { cookie } },
    );
    assert.equal(capabilityResponse.status, 200, "authenticated capability request failed");
    const capability = await capabilityResponse.json();
    assert.deepEqual(capability.model, modelProvider.publicConfig());
    return capability.model;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  const config = loadSaasConfig(process.env);
  const modelProvider = createBackendModelProvider({ config });
  const publicConfig = modelProvider.publicConfig();
  assert.equal(publicConfig.provider, "deepseek", "LABRAT_AI_PROVIDER must select deepseek for this smoke test");
  assert.equal(publicConfig.model, "deepseek-v4-pro");
  assert.equal(publicConfig.configured, true, "DEEPSEEK_API_KEY is not configured");

  const capability = await authenticatedCapabilitySmoke({ config, modelProvider });

  const intent = await modelProvider.classifyIntent({
    message: "I want a graph of carbon number distribution.",
    selectedContextKeys: ["activeSurface"],
    selectedContext: { activeSurface: "experiment_browser" },
    projectContext: { publishedExperimentCount: 0 },
  });
  if (!intent.ok) safeProviderFailure(intent, "intent classification");
  assert.equal(intent.intent, "create_analysis_chart");
  assert.equal(intent.disposition, "analysis_thread");

  let inspectionCalls = 0;
  const plan = await modelProvider.draftAnalysisPlan({
    originalRequest: [
      "Create a bar chart of carbon number distribution from the confirmed synthetic range.",
      "Inspect the exact confirmed cells before drafting the reviewable plan.",
    ].join(" "),
    confirmedRegions: [{
      regionUnderstandingRevisionId: SMOKE_REVISION_ID,
      sourceDocumentId: SMOKE_SOURCE_ID,
      sheetName: "Synthetic Carbon",
      range: "A1:B4",
      summary: "A user-confirmed synthetic component-distribution table; exact cells require inspection.",
      semanticType: "component_distribution",
    }],
    activeExperimentCatalog: [],
  }, {
    inspectSourceRange: async ({ regionUnderstandingRevisionId, range }) => {
      inspectionCalls += 1;
      assert.equal(regionUnderstandingRevisionId, SMOKE_REVISION_ID);
      assert.equal(range, "A1:B4");
      return {
        schemaVersion: "labrat.sourceRangeInspection.v1",
        regionUnderstandingRevisionId: SMOKE_REVISION_ID,
        sourceDocumentId: SMOKE_SOURCE_ID,
        sheetName: "Synthetic Carbon",
        range: "A1:B4",
        cells: [
          { row: 0, col: 0, address: "A1", rawValue: "Carbon number", formattedValue: "Carbon number", type: "string" },
          { row: 0, col: 1, address: "B1", rawValue: "Distribution", formattedValue: "Distribution", type: "string" },
          { row: 1, col: 0, address: "A2", rawValue: "C1", formattedValue: "C1", type: "string" },
          { row: 1, col: 1, address: "B2", rawValue: 0.2, formattedValue: "0.2", type: "number" },
          { row: 2, col: 0, address: "A3", rawValue: "C2", formattedValue: "C2", type: "string" },
          { row: 2, col: 1, address: "B3", rawValue: 0.5, formattedValue: "0.5", type: "number" },
          { row: 3, col: 0, address: "A4", rawValue: "C3", formattedValue: "C3", type: "string" },
          { row: 3, col: 1, address: "B4", rawValue: 0.3, formattedValue: "0.3", type: "number" },
        ],
      };
    },
  });
  if (!plan.ok) safeProviderFailure(plan, "reviewed analysis planning");
  assert.ok(inspectionCalls > 0, "reviewed analysis planning did not use the inspection tool");
  assert.ok(Number(plan.metadata?.toolRounds) > 0, "provider metadata did not record a tool round");
  assert.ok(plan.sourceSelections.some((selection) => (
    selection.regionUnderstandingRevisionId === SMOKE_REVISION_ID
      && selection.sourceDocumentId === SMOKE_SOURCE_ID
  )), "reviewed plan did not preserve the confirmed source identity");

  console.log(JSON.stringify({
    capability,
    intent: {
      intent: intent.intent,
      disposition: intent.disposition,
    },
    reviewedPlan: {
      toolCalls: inspectionCalls,
      toolRounds: plan.metadata.toolRounds,
      sourceSelectionCount: plan.sourceSelections.length,
      chartType: plan.reviewPlan?.chart?.chartType || null,
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(`AI provider smoke test failed: ${error?.message || "unknown error"}`);
  process.exitCode = 1;
});
