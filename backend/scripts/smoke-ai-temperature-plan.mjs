import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createBackendModelProvider } from "../src/saas/backendModelProvider.js";
import { loadSaasConfig } from "../src/saas/config.js";
import { draftAnalysisPlanRevision } from "../src/saas/analysisThreads.js";
import { temperaturePlanFixture } from "../src/saas/testing/temperaturePlanFixture.js";

const providerName = process.argv[2] || "anthropic";
assert.ok(["anthropic", "deepseek"].includes(providerName));
const provider = createBackendModelProvider({ config: loadSaasConfig({ ...process.env, LABRAT_AI_PROVIDER: providerName }) });
const results = [];
const cases = [
  { id: "scalar-not-series", seriesPoints: null, clarification: true },
  { id: "calculation-without-chart", seriesPoints: [78, 80, 82], request: "Calculate the mean of Exp17's temperature series.", clarification: true },
  { id: "confirmed-series", seriesPoints: [78, 80, 82], clarification: false },
  { id: "confirmed-one-point-series", seriesPoints: [80], clarification: false },
];
for (const testCase of cases) {
  const { store, project, thread } = await temperaturePlanFixture(testCase);
  let outcome;
  try {
    const revision = await draftAnalysisPlanRevision({ store, project, analysisThreadId: thread.id,
      actorUserId: "user_1", modelProvider: provider, signal: AbortSignal.timeout(180_000) });
    outcome = { id: testCase.id, kind: "plan", selections: revision.sourceSelections,
      reviewPlan: revision.reviewPlan || revision.plan?.reviewPlan,
      displayPlan: revision.displayPlan || revision.plan?.displayPlan };
    assert.equal(testCase.clarification, false, "Missing inputs or unspecified output must clarify, not produce a plan.");
    assert.equal(revision.status, "awaiting_review");
  } catch (error) {
    outcome ||= { id: testCase.id, kind: "clarification", code: error.code, message: error.message };
    if (!testCase.clarification || error.code !== "analysis_plan_clarification_required") outcome.failure = error.message;
  }
  assert.equal(store.analysisRuns.size, 0);
  if (testCase.clarification && store.analysisPlanRevisions.size !== 0) outcome.failure = "Unexpected plan saved.";
  results.push(outcome);
  console.log(JSON.stringify({ provider: providerName, ...outcome }));
}
await fs.mkdir(".tmp", { recursive: true });
await fs.writeFile(".tmp/temperature-plan-" + providerName + ".json", JSON.stringify({ provider: providerName, results }, null, 2));
if (results.some(result => result.failure)) process.exitCode = 1;
