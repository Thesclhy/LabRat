import assert from "node:assert/strict";
import test from "node:test";
import { PostgresSaasStore } from "./postgresStore.js";

for (const method of ["publishExperimentAnalysis", "publishAnalysisResult"]) {
  test(`${method} rechecks the current revision under the transaction thread lock`, async () => {
    const queries = [];
    let released = false;
    const common = { project_id: "project", analysis_thread_id: "thread" };
    const revision = { ...common, id: "revision_1", revision: 1, status: "accepted" };
    const run = { ...common, id: "run_1", accepted_plan_revision_id: "revision_1", status: "awaiting_result_review", result_preview_hash: "hash" };
    const result = { ...common, id: "result", analysis_run_id: "run_1", status: "awaiting_review", result_preview_hash: "hash" };
    const client = { release() { released = true; }, async query(sql) {
      queries.push(sql);
      if (sql.includes("from analysis_threads")) return { rows: [{ id: "thread", project_id: "project", status: "awaiting_result_review", plan_revision_ids: ["revision_1", "revision_2"], analysis_run_ids: ["run_1", "run_2"] }] };
      if (sql.includes("from analysis_plan_revisions")) return { rows: [sql.includes("order by revision") ? { ...revision, id: "revision_2", revision: 2 } : revision] };
      if (sql.includes("from analysis_runs")) return { rows: [sql.includes("array_position") ? { ...run, id: "run_2", accepted_plan_revision_id: "revision_2" } : run] };
      if (sql.includes("from analysis_results")) return { rows: [result] };
      return { rows: [] };
    } };
    const store = new PostgresSaasStore({});
    store.pool = { connect: async () => client };
    await assert.rejects(store[method]({ projectId: "project", idempotencyKey: "offline", requestHash: "request", analysisThread: { id: "thread" }, analysisPlanRevision: { id: "revision_1" }, analysisRun: { id: "run_1" }, analysisResult: { id: "result" } }), { code: "analysis_result_stale" });
    const locked = queries.findIndex(sql => /from analysis_threads .*for update/.test(sql));
    const checked = queries.findIndex(sql => sql.includes("order by revision desc"));
    assert.ok(locked >= 0 && checked > locked);
    assert.ok(queries.some(sql => sql.includes("array_position") && sql.includes("created_at desc, id desc")));
    assert.ok(queries.includes("rollback"));
    assert.equal(queries.some(sql => /^(insert|update) /i.test(sql.trim())), false);
    assert.equal(released, true);
  });
}
