import React, { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectOnboarding } from "./ProjectOnboarding.jsx";
import { AnalysisReviewWorkspace } from "./AnalysisReviewWorkspace.jsx";
import { INITIAL_PROJECT_ONBOARDING, readProjectOnboarding, writeProjectOnboarding, projectOnboardingStorageKey } from "../data/projectOnboardingState.js";

const revision = n => ({ id: `revision_${n}`, revision: n, analysisThreadId: "thread", status: "awaiting_review", outputTarget: "experiment_browser", requestSummary: `Plan ${n}`, displayPlan: [`Keep reviewed source fields (${n}).`], sourceRectangles: [] });
const runFor = n => ({ id: `run_${n}`, analysisThreadId: "thread", acceptedPlanRevisionId: `revision_${n}`, outputTarget: "experiment_browser", status: "awaiting_result_review", createdAt: `2026-09-19T00:00:0${n}Z`, validation: { ok: true, errors: [] } });
const resultFor = n => ({ id: `result_${n}`, analysisRunId: `run_${n}`, outputTarget: "experiment_browser", status: "awaiting_review", validation: { ok: true, errors: [] } });
const previewFor = n => ({ analysisRunId: `run_${n}`, analysisResultId: `result_${n}`, outputTarget: "experiment_browser", validation: { ok: true, errors: [] }, columns: [], rows: [{ experimentId: "exp", label: "Exp1", cells: [] }], totalCount: 1 });
const selection = { sourceRectangles: [], records: [] };
const projectState = { project: { id: "project_1", name: "Synthetic review" }, workbookReviewRegions: [], workbookReviewSessions: [], experimentSnapshotHeads: [] };

function serverFixture() {
  const server = { revisions: [{ ...revision(1), status: "accepted" }], runs: [runFor(1)], status: "awaiting_result_review", failRefresh: false };
  const thread = () => ({ id: "thread", projectId: "project_1", outputTarget: "experiment_browser", status: server.status, planRevisionIds: server.revisions.map(item => item.id), analysisRunIds: server.runs.map(item => item.id), messages: [] });
  const loadThread = vi.fn(async () => {
    if (server.failRefresh) throw new Error("Synthetic refresh failure");
    return { analysisThread: thread(), planRevisions: [...server.revisions].reverse(), analysisRuns: [...server.runs].reverse() };
  });
  const loadRun = vi.fn(async id => {
    const run = server.runs.find(item => item.id === id);
    return { analysisThread: thread(), analysisRun: run, analysisPlanRevision: server.revisions.find(item => item.id === run.acceptedPlanRevisionId), analysisResult: resultFor(Number(id.split("_").at(-1))) };
  });
  const reviseRun = vi.fn(async () => {
    const next = revision(server.revisions.length + 1);
    server.revisions.push(next);
    server.status = "awaiting_plan_review";
    return { analysisPlanRevision: next };
  });
  const acceptPlan = vi.fn(async id => {
    server.revisions = server.revisions.map(item => item.id === id ? { ...item, status: "accepted" } : item);
    const n = Number(id.split("_").at(-1));
    const run = { ...runFor(n), status: "queued" };
    server.runs.push(run);
    server.status = "queued";
    return { analysisThread: thread(), analysisPlanRevision: server.revisions.find(item => item.id === id), analysisRun: run };
  });
  const executeRun = vi.fn(async id => {
    const n = Number(id.split("_").at(-1));
    server.runs = server.runs.map(item => item.id === id ? runFor(n) : item);
    server.status = "awaiting_result_review";
    return loadRun(id);
  });
  const loadResultPreview = vi.fn(async id => previewFor(Number(id.split("_").at(-1))));
  function Review(props) {
    return <AnalysisReviewWorkspace {...props} selection={selection} loadThread={loadThread} loadRun={loadRun} reviseRun={reviseRun} acceptPlan={acceptPlan} executeRun={executeRun} loadResultPreview={loadResultPreview} />;
  }
  return { server, thread, loadThread, loadRun, reviseRun, acceptPlan, executeRun, loadResultPreview, Review };
}

beforeEach(() => window.localStorage.removeItem(projectOnboardingStorageKey("project_1")));
function saveOnboarding() {
  writeProjectOnboarding("project_1", { ...INITIAL_PROJECT_ONBOARDING, step: "result_review", workbookStatus: "ready", analysisThreadId: "thread", analysisPlanRevisionId: "revision_1", analysisRunId: "run_1", analysisResultId: "result_1", generationStatus: "ready", contextIndex: 100 });
}

it("onboarding survives two result feedback rounds, history viewing, and reentry with descending revisions", async () => {
  saveOnboarding();
  const api = serverFixture();
  const publish = vi.fn();
  const props = { projectId: "project_1", projectState, AnalysisReviewComponent: api.Review, loadAnalysisThread: api.loadThread, onAcceptAnalysisResult: publish };
  let page = render(<ProjectOnboarding {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish to Browser" }).disabled).toBe(false));
  for (const n of [2, 3]) {
    fireEvent.change(screen.getByPlaceholderText("Describe a data modification"), { target: { value: `Correction ${n}` } });
    fireEvent.click(screen.getByRole("button", { name: "Send data modification" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" }).disabled).toBe(false));
    await waitFor(() => expect(readProjectOnboarding("project_1")).toMatchObject({ analysisPlanRevisionId: `revision_${n}`, analysisRunId: "", analysisResultId: "", step: "plan_review", generationStatus: "idle" }));
    fireEvent.click(screen.getByRole("button", { name: /Revision 1/ }));
    await waitFor(() => expect(screen.getByText("A newer version is available. Review the latest plan.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Publish to Browser" }).disabled).toBe(true);
    expect(readProjectOnboarding("project_1").analysisPlanRevisionId).toBe(`revision_${n}`);
    expect(api.executeRun).toHaveBeenCalledTimes(n - 2);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Revision ${n}`) }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" }).disabled).toBe(false));
    page.unmount();
    page = render(<ProjectOnboarding {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" }).disabled).toBe(false));
    expect(readProjectOnboarding("project_1").analysisPlanRevisionId).toBe(`revision_${n}`);
    fireEvent.click(screen.getByRole("button", { name: "Accept plan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish to Browser" }).disabled).toBe(false));
    await waitFor(() => expect(readProjectOnboarding("project_1")).toMatchObject({ analysisPlanRevisionId: `revision_${n}`, analysisRunId: `run_${n}`, analysisResultId: `result_${n}`, step: "result_review" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "Publish to Browser" }));
  await waitFor(() => expect(publish).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_3", analysisResultId: "result_3" })));
});

it("feedback refresh failure keeps the new plan and offers retry without restoring old publish", async () => {
  const api = serverFixture();
  render(<api.Review projectId="project_1" thread={api.thread()} revision={api.server.revisions[0]} planRevisions={api.server.revisions} run={runFor(1)} result={resultFor(1)} resultPreview={previewFor(1)} executionStrategy="direct_source_mapping" onAcceptResult={vi.fn()} />);
  api.server.failRefresh = true;
  fireEvent.change(screen.getByPlaceholderText("Describe a data modification"), { target: { value: "Keep comments" } });
  fireEvent.click(screen.getByRole("button", { name: "Send data modification" }));
  expect(await screen.findByRole("button", { name: "Retry latest review" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Publish to Browser" })).toBeNull();
  expect(screen.getByRole("button", { name: "Accept plan" }).disabled).toBe(true);
  api.server.failRefresh = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry latest review" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" }).disabled).toBe(false));
  expect(screen.getByRole("button", { name: /Revision 2/ }).className).toBe("active");
});

it("ignores an old preview arriving after result feedback creates a new plan", async () => {
  const api = serverFixture();
  let releasePreview;
  const delayed = vi.fn(() => new Promise(resolve => { releasePreview = resolve; }));
  render(<AnalysisReviewWorkspace projectId="project_1" thread={api.thread()} revision={api.server.revisions[0]} planRevisions={api.server.revisions} selection={selection} run={runFor(1)} result={resultFor(1)} loadThread={api.loadThread} loadRun={api.loadRun} loadResultPreview={delayed} reviseRun={api.reviseRun} executionStrategy="direct_source_mapping" onAcceptResult={vi.fn()} />);
  await waitFor(() => expect(delayed).toHaveBeenCalled());
  fireEvent.change(screen.getByPlaceholderText("Describe a data modification"), { target: { value: "Keep comments" } });
  fireEvent.click(screen.getByRole("button", { name: "Send data modification" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" }).disabled).toBe(false));
  await act(async () => releasePreview(previewFor(1)));
  expect(screen.queryByRole("button", { name: "Publish to Browser" })).toBeNull();
  expect(screen.getByRole("button", { name: /Revision 2/ }).className).toBe("active");
});

it("refreshes the latest review after a stale publication conflict", async () => {
  const api = serverFixture();
  const publish = vi.fn(async () => {
    api.server.revisions.push(revision(2));
    api.server.status = "awaiting_plan_review";
    throw Object.assign(new Error("stale"), { code: "analysis_result_stale", status: 409 });
  });
  render(<api.Review projectId="project_1" thread={api.thread()} revision={api.server.revisions[0]} planRevisions={api.server.revisions} run={runFor(1)} result={resultFor(1)} resultPreview={previewFor(1)} executionStrategy="direct_source_mapping" onAcceptResult={publish} />);
  fireEvent.click(screen.getByRole("button", { name: "Publish to Browser" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" }).disabled).toBe(false));
  expect(screen.getByText(/A newer plan or result is available/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Publish to Browser" })).toBeNull();
});

it.each(["missing validation", "failed result validation", "wrong result", "server plan review"])("blocks publication with %s", reason => {
  const api = serverFixture();
  const validation = reason === "missing validation" ? {} : { ok: true, errors: [] };
  render(<api.Review projectId="project_1" thread={{ ...api.thread(), ...(reason === "server plan review" ? { status: "awaiting_plan_review" } : {}) }} revision={api.server.revisions[0]} planRevisions={api.server.revisions} run={{ ...runFor(1), validation }} result={{ ...resultFor(1), validation: reason === "failed result validation" ? { ok: false, errors: [{ code: "invalid", message: "Invalid result" }] } : validation, ...(reason === "wrong result" ? { analysisRunId: "different" } : {}) }} resultPreview={{ ...previewFor(1), validation }} executionStrategy="direct_source_mapping" onAcceptResult={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Publish to Browser" }).disabled).toBe(true);
});

it("never automatically executes a queued historical run", async () => {
  const api = serverFixture();
  api.server.revisions.push(revision(2));
  api.server.status = "awaiting_plan_review";
  api.server.runs[0] = { ...runFor(1), status: "queued" };
  api.loadRun.mockResolvedValue({ analysisRun: api.server.runs[0], analysisResult: null });
  render(<api.Review projectId="project_1" thread={api.thread()} revision={revision(2)} executionStrategy="direct_source_mapping" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Accept plan" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /Revision 1/ }));
  await waitFor(() => expect(api.loadRun).toHaveBeenCalledWith("run_1"));
  expect(screen.getByText("A newer version is available. Review the latest plan.")).toBeTruthy();
  expect(api.executeRun).not.toHaveBeenCalled();
});
