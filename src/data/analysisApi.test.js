import { describe, expect, it, vi } from "vitest";

import {
  acceptAnalysisPlanRevision,
  createAnalysisPlanRevision,
  getAnalysisPlanSelection,
  getAnalysisThread,
  listAnalysisThreads,
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

  it("creates feedback revisions without accepting and accepts with exact hashes", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ analysisPlanRevision: { id: "revision_2" } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ analysisRun: { id: "run_1", status: "queued" } }, { status: 201 }));

    await createAnalysisPlanRevision("thread_1", {
      feedback: "Treat missing Liquid as zero.",
    }, { fetch: fetchImpl });
    await acceptAnalysisPlanRevision("revision_2", {
      planHash: "sha256_plan_2",
      selectionHash: "sha256_selection_2",
      dependencyHash: "sha256_dependency_2",
    }, {
      fetch: fetchImpl,
      idempotencyKey: "accept_revision_2",
    });

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/analysis-threads/thread_1/plan-revisions");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      feedback: "Treat missing Liquid as zero.",
    });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/analysis-plan-revisions/revision_2/accept");
    expect(fetchImpl.mock.calls[1][1].headers["idempotency-key"]).toBe("accept_revision_2");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      planHash: "sha256_plan_2",
      selectionHash: "sha256_selection_2",
      dependencyHash: "sha256_dependency_2",
    });
  });
});
