import assert from "node:assert/strict";
import test from "node:test";

import { createAnalysisToolRegistry } from "./analysisToolRegistry.js";

function registryFixture() {
  const calls = [];
  const registry = createAnalysisToolRegistry({
    handlers: {
      async getProjectAnalysisContext(args) {
        calls.push(["context", args]);
        return { projectId: args.projectId, publishedExperimentCount: 2 };
      },
      async listAnalysisFields(args) {
        calls.push(["fields", args]);
        return { projectId: args.projectId, fields: [{ fieldId: "field_1" }] };
      },
      async resolveExperimentScope(args) {
        calls.push(["scope", args]);
        return { projectId: args.projectId, experimentIds: ["experiment_1"] };
      },
      async previewAnalysisSelection(args) {
        calls.push(["preview", args]);
        return {
          projectId: args.projectId,
          selectionId: "selection_1",
          records: Array.from({ length: 250 }, (_, index) => ({ index })),
        };
      },
      async inspectAnalysisSelection(args) {
        calls.push(["inspect", args]);
        return {
          projectId: args.projectId,
          rows: Array.from({ length: args.limit }, (_, index) => ({ index })),
        };
      },
      async validateAnalysisPlan(args) {
        calls.push(["validate", args]);
        return { projectId: args.projectId, ok: true, errors: [] };
      },
    },
  });
  return { registry, calls };
}

test("exposes planning tools and no execution tool", () => {
  const { registry } = registryFixture();
  const names = registry.list().map((item) => item.name);

  assert.deepEqual(names, [
    "get_project_analysis_context",
    "inspect_analysis_selection",
    "list_analysis_fields",
    "preview_analysis_selection",
    "resolve_experiment_scope",
    "validate_analysis_plan",
  ]);
  assert.equal(names.some((name) => name.includes("execute")), false);
});

test("rejects cross-project tool calls before handlers", async () => {
  const { registry, calls } = registryFixture();

  await assert.rejects(
    registry.call("list_analysis_fields", { projectId: "project_2" }, { projectId: "project_1" }),
    (error) => error.code === "analysis_tool_project_forbidden",
  );
  assert.deepEqual(calls, []);
});

test("bounds selection previews and inspection limits", async () => {
  const { registry, calls } = registryFixture();
  const preview = await registry.call(
    "preview_analysis_selection",
    { projectId: "project_1", selectionRequest: {} },
    { projectId: "project_1" },
  );
  const inspected = await registry.call(
    "inspect_analysis_selection",
    { projectId: "project_1", selectionId: "selection_1", limit: 1000 },
    { projectId: "project_1" },
  );

  assert.equal(preview.records.length, 50);
  assert.equal(preview.truncated, true);
  assert.equal(inspected.rows.length, 200);
  assert.equal(calls.find(([name]) => name === "inspect")[1].limit, 200);
});

test("rejects unknown tools and missing project ids", async () => {
  const { registry } = registryFixture();

  await assert.rejects(
    registry.call("execute_python", { projectId: "project_1" }, { projectId: "project_1" }),
    (error) => error.code === "analysis_tool_not_found",
  );
  await assert.rejects(
    registry.call("list_analysis_fields", {}, { projectId: "project_1" }),
    (error) => error.code === "analysis_tool_project_required",
  );
});
