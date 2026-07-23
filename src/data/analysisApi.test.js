import { describe, expect, it, vi } from "vitest";

import {
  acceptAnalysisPlanRevision,
  createAnalysisPlanRevision,
  executeAnalysisRun,
  getAnalysisPlanSelection,
  getAnalysisResultPreview,
  getAnalysisRun,
  getAnalysisThread,
  getProjectAnalysisCapabilities,
  listAnalysisThreads,
  publishAcceptedAnalysisChart,
  retryAnalysisThread,
  reviseAnalysisRun,
} from "./analysisApi.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}

describe("analysisApi", () => {
  it("uses bounded analysis thread and selection routes", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ analysisThreads: [] }))
      .mockResolvedValueOnce(jsonResponse({ analysisThread: { id: "analysis_thread_1" } }))
      .mockResolvedValueOnce(jsonResponse({ records: [] }));

    await listAnalysisThreads("project 1", { offset: 10, limit: 25, fetch: fetchImpl });
    await getAnalysisThread("analysis/thread 1", { fetch: fetchImpl });
    await getAnalysisPlanSelection("revision 1", { offset: 50, limit: 100, fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project%201/analysis-threads?offset=10&limit=25");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/analysis-threads/analysis%2Fthread%201");
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/analysis-plan-revisions/revision%201/selection?offset=50&limit=100");
  });

  it("reads public project analysis capabilities and retries with an idempotency key", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        model: { provider: "anthropic", model: "claude-test", configured: true },
        executor: { mode: "development", adapter: "local", configured: true, productionSafe: false },
        acceptedData: { acceptedSnapshotCount: 3, activeExperimentHeadCount: 2 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        analysisThread: { id: "thread_1", status: "planning" },
        analysisPlanRevision: { id: "revision_1", revision: 1 },
      }, { status: 201 }));

    await getProjectAnalysisCapabilities("project 1", { fetch: fetchImpl });
    await retryAnalysisThread("thread_1", {
      fetch: fetchImpl,
      idempotencyKey: "retry_thread_1",
    });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/projects/project%201/analysis-capabilities");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/analysis-threads/thread_1/retry");
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
    expect(fetchImpl.mock.calls[1][1].headers["idempotency-key"]).toBe("retry_thread_1");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({});
  });

  it("creates feedback revisions and accepts a revision by idempotent revision id", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ analysisPlanRevision: { id: "revision_2" } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ analysisRun: { id: "run_1", status: "queued" } }, { status: 201 }));

    await createAnalysisPlanRevision("thread_1", {
      feedback: "Treat missing Liquid as zero.",
    }, { fetch: fetchImpl });
    await acceptAnalysisPlanRevision("revision_2", {}, {
      fetch: fetchImpl,
      idempotencyKey: "accept_revision_2",
    });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/analysis-threads/thread_1/plan-revisions");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      feedback: "Treat missing Liquid as zero.",
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/analysis-plan-revisions/revision_2/accept");
    expect(fetchImpl.mock.calls[1][1].headers["idempotency-key"]).toBe("accept_revision_2");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({});
  });

  it("executes accepted runs and loads the complete Plotly result", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        analysisRun: { id: "analysis_run_1", status: "awaiting_result_review" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        analysisRun: { id: "analysis_run_1", status: "awaiting_result_review" },
        analysisResult: { id: "analysis_result_1", status: "awaiting_review" },
      }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({
        rows: [],
        traces: [],
        sourceRefs: [],
      }));

    await getAnalysisRun("analysis/run 1", { fetch: fetchImpl });
    await executeAnalysisRun("analysis/run 1", { fetch: fetchImpl });
    await getAnalysisResultPreview("analysis/run 1", {
      offset: 25,
      limit: 200,
      traceOffset: 10,
      traceLimit: 500,
      sourceOffset: 50,
      sourceLimit: 200,
      fetch: fetchImpl,
    });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/analysis-runs/analysis%2Frun%201");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/analysis-runs/analysis%2Frun%201/execute");
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
    expect(fetchImpl.mock.calls[2][0]).toBe(
      "/api/analysis-runs/analysis%2Frun%201/result-preview",
    );
  });

  it("revises the visible result with natural-language feedback", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      analysisPlanRevision: { id: "analysis_plan_revision_3", revision: 3 },
      priorAnalysisResult: {
        id: "analysis_result_1",
        contentHash: "sha256_result_1",
        status: "awaiting_review",
      },
    }, { status: 201 }));

    await reviseAnalysisRun("analysis_run_1", {
      feedback: "Keep all experiments but use reaction time on x.",
    }, { fetch: fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/analysis-runs/analysis_run_1/revise");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      feedback: "Keep all experiments but use reaction time on x.",
    });
  });

  it("publishes an exact reviewed result with an idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      analysisResult: { id: "analysis_result_1", status: "accepted" },
      chartSpec: { id: "chart_spec_1" },
    }, { status: 201 }));

    await publishAcceptedAnalysisChart("analysis/run 1", {
      analysisResultId: "analysis_result_1",
      defaultVisibleTraceIds: ["trace_1", "trace_2"],
    }, {
      fetch: fetchImpl,
      idempotencyKey: "publish_result_1",
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "/api/analysis-runs/analysis%2Frun%201/accept-and-create-chart",
    );
    expect(fetchImpl.mock.calls[0][1].headers["idempotency-key"]).toBe("publish_result_1");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      analysisResultId: "analysis_result_1",
      defaultVisibleTraceIds: ["trace_1", "trace_2"],
    });
  });
});
