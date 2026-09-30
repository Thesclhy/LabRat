import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { App } from "../main.jsx";
import { manuscriptDraftFingerprint } from "../components/ManuscriptCanvas.jsx";
import { APP_BASENAME, loginReturnPath, workspaceRoutes } from "./workspaceRoutes.jsx";
import * as api from "../data/serverApi.js";

const access = vi.hoisted(() => ({ listener: null }));
vi.mock("../data/backendApiV1Client.ts", async (original) => ({ ...await original(),
  onWorkspaceAccessLost: (listener) => { access.listener = listener; return () => { access.listener = null; }; },
}));
vi.mock("../data/serverApi.js", async (original) => ({ ...await original(),
  getServerSession: vi.fn(), listServerLabs: vi.fn(), listServerProjects: vi.fn(),
  getServerProjectState: vi.fn(), loginToServer: vi.fn(), logoutFromServer: vi.fn(),
  patchServerManuscript: vi.fn(), createServerManuscript: vi.fn(),
  getServerWorkbookReviewSession: vi.fn(),
}));
vi.mock("../components/BackendScanPanel.jsx", () => ({ ChartReviewPanel: ({ onInsertChartSpec }) => <button onClick={() => onInsertChartSpec("chart-1")}>Insert test chart</button> }));
vi.mock("../charts/Plot.jsx", () => ({ Plot: () => null }));
vi.mock("../export/pptxExport.js", () => ({ exportManuscriptPagesToPptx: vi.fn() }));
vi.mock("../components/ExperimentBrowser.jsx", () => ({ ExperimentBrowser: ({ projectId }) => <h1>Browser {projectId}</h1> }));
vi.mock("../components/ReferenceLibrary.jsx", () => ({ ReferenceLibrary: ({ projectId }) => <h1>References {projectId}</h1> }));
vi.mock("../components/ProjectOnboarding.jsx", () => ({ ProjectOnboarding: ({ onExit }) => <><h1>Project onboarding</h1><button onClick={onExit}>Exit onboarding</button></> }));
vi.mock("../components/LabManagement.jsx", () => ({ LabManagement: ({ onClose }) => <><h1>Manage lab</h1><button onClick={onClose}>Close management</button></> }));
vi.mock("../components/ManuscriptCanvas.jsx", async (original) => ({ ...await original(),
  ManuscriptCanvas: ({ blocks, setBlocks, onSaveProject, chartSpecInsertRequest, onChartSpecInsertRequestHandled }) => {
    React.useEffect(() => {
      if (!chartSpecInsertRequest) return;
      setBlocks((current) => [...current, { id: chartSpecInsertRequest.requestId, kind: "text", html: "Inserted" }]);
      onChartSpecInsertRequestHandled(chartSpecInsertRequest.requestId);
    }, [chartSpecInsertRequest]);
    return <><h1>Manuscript editor</h1><output data-testid="draft">{blocks.map((block) => block.html).join(" ")}</output>
      <button onClick={() => setBlocks((current) => [...current, { id: `text-${current.length}`, kind: "text", html: "Draft text", x: 0, y: 0, w: 100, h: 50 }])}>Edit manuscript</button>
      <button onClick={onSaveProject}>Save manuscript</button></>;
  },
}));

const labs = [{ id: "lab-a", name: "Lab A", role: "lab_owner" }, { id: "lab-b", name: "Lab B", role: "lab_owner" }];
const session = { user: { id: "user-a", username: "owner" }, labs };
const state = (id = "project-a", labId = "lab-a") => ({
  project: { id, labId, name: id, status: "active", capabilities: ["read", "propose", "approve", "export"], accessScope: "all_experiments", canAskResearchQuestions: true },
  experimentSnapshotHeads: [{ id: "head", experimentIdentityId: "experiment", dataSnapshotId: "snapshot" }],
  publishedExperimentCount: 1, projectProfile: {}, chartSpecs: [], workbookReviewSessions: [], analysisThreads: [],
  manuscripts: [{ id: `manuscript-${id}`, title: id, blocks: [], pages: [], references: [], canvasState: { canvasHeight: 0, pageOrientationPreference: null } }],
});
let router;
const currentPath = () => router.state.location.pathname;
const mount = (initialEntries = ["/LabRat/projects/project-a/overview"], initialIndex) => {
  router = createMemoryRouter(workspaceRoutes(<App />), { basename: APP_BASENAME, initialEntries, initialIndex });
  return render(<RouterProvider router={router} />);
};
const move = async (path) => { await act(async () => { await router.navigate(path); }); };
const tab = async (name) => { fireEvent.click(await screen.findByRole("button", { name, exact: true })); };
const draft = async () => { await screen.findByRole("heading", { name: "Manuscript editor" }); fireEvent.click(screen.getByText("Edit manuscript")); };

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], tasks: [], threads: [], configured: false }), { status: 200 })));
  api.getServerSession.mockResolvedValue(session); api.loginToServer.mockResolvedValue(session);
  api.listServerLabs.mockResolvedValue({ labs });
  api.listServerProjects.mockImplementation(async ({ labId }) => ({ projects: [state(labId === "lab-b" ? "project-b" : "project-a", labId).project] }));
  api.getServerProjectState.mockImplementation(async (id) => state(id, id === "project-b" ? "lab-b" : "lab-a"));
  api.patchServerManuscript.mockImplementation(async (id, body) => ({ manuscript: { id, ...body } }));
  api.createServerManuscript.mockImplementation(async (id, body) => ({ manuscript: { id: `manuscript-${id}`, ...body } }));
  api.logoutFromServer.mockResolvedValue({});
});
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); });

describe("App routing", () => {
  it("canonicalizes root and project roots without extra history", async () => {
    mount(["/LabRat/"]);
    await waitFor(() => expect(currentPath()).toBe("/LabRat/labs/lab-a/projects"));
    expect(router.state.historyAction).toBe("REPLACE");
    await move("/projects/project-a");
    await screen.findByRole("button", { name: "Overview", exact: true });
    expect(currentPath()).toBe("/LabRat/projects/project-a/overview");
    expect(router.state.historyAction).toBe("REPLACE");
    await move(-1);
    expect(currentPath()).toBe("/LabRat/labs/lab-a/projects");
  });

  it.each(["overview", "browser", "manuscript", "references"])("loads %s directly without overwriting the destination", async (page) => {
    mount([`/LabRat/projects/project-b/${page}`]);
    await screen.findByRole("button", { name: "Overview", exact: true });
    expect(currentPath()).toBe(`/LabRat/projects/project-b/${page}`);
    expect(document.querySelector(".tabs .active")?.textContent.toLowerCase()).toBe(page);
    expect(screen.getByLabelText("Current lab and project").textContent).toContain("Lab B");
    expect(api.getServerProjectState).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Home", exact: true }));
    await waitFor(() => expect(currentPath()).toBe("/LabRat/labs/lab-b/projects"));
    expect(screen.queryByRole("dialog", { name: "Save your changes?" })).toBeNull();
  });

  it("preserves a draft across tabs and POP without reloading or duplicate entries", async () => {
    mount(["/LabRat/projects/project-a/manuscript"]); await draft();
    await tab("References");
    const firstKey = router.state.location.key;
    await tab("References"); expect(router.state.location.key).toBe(firstKey);
    await tab("Overview"); expect(screen.queryByText("References project-a")).toBeNull();
    await move(-1); await screen.findByText("References project-a");
    await move(-1); expect(screen.getByTestId("draft").textContent).toBe("Draft text");
    await move(1); await screen.findByText("References project-a");
    await tab("Manuscript"); expect(screen.getByTestId("draft").textContent).toBe("Draft text");
    expect(api.getServerProjectState).toHaveBeenCalledTimes(1);
    expect(api.patchServerManuscript).not.toHaveBeenCalled();
  });

  it("retains the same-project draft while management is open and closes it on route change", async () => {
    mount(["/LabRat/projects/project-a/manuscript"]); await draft();
    await tab("File menu"); await tab("Lab management");
    await screen.findByText("Manage lab");
    await move("/projects/project-a/browser"); await screen.findByText("Browser project-a");
    expect(screen.queryByText("Manage lab")).toBeNull();
    await tab("Manuscript"); expect(screen.getByTestId("draft").textContent).toBe("Draft text");
  });

  it("blocks POP, supports stay and discard, and restores history direction", async () => {
    mount(["/LabRat/labs/lab-a/projects", "/LabRat/projects/project-a/manuscript"], 1); await draft();
    await move(-1); await screen.findByRole("dialog", { name: "Save your changes?" });
    expect(currentPath()).toBe("/LabRat/projects/project-a/manuscript");
    fireEvent.click(screen.getByText("Stay here"));
    expect(screen.getByTestId("draft").textContent).toBe("Draft text");
    await move(-1); fireEvent.click(await screen.findByText("Discard and leave"));
    await waitFor(() => expect(currentPath()).toBe("/LabRat/labs/lab-a/projects"));
    await move(1); await screen.findByText("Manuscript editor");
    expect(screen.getByTestId("draft").textContent).toBe("");
    expect(api.patchServerManuscript).not.toHaveBeenCalled();
  });

  it("saves before leaving for another project, and passes the exact draft", async () => {
    mount(["/LabRat/projects/project-a/manuscript"]); await draft();
    await move("/projects/project-b/browser");
    fireEvent.click(await screen.findByText("Save and leave"));
    await screen.findByText("Browser project-b");
    expect(api.patchServerManuscript).toHaveBeenCalledWith("manuscript-project-a", expect.objectContaining({ blocks: [expect.objectContaining({ html: "Draft text" })] }));
  });

  it("keeps the draft and original route on save failure, then allows retry", async () => {
    api.patchServerManuscript.mockRejectedValueOnce(new Error("Save offline"));
    mount(["/LabRat/projects/project-a/manuscript"]); await draft(); await tab("Home");
    fireEvent.click(await screen.findByText("Save and leave"));
    await screen.findByText(/Your changes could not be saved/);
    expect(currentPath()).toBe("/LabRat/projects/project-a/manuscript");
    expect(screen.getByTestId("draft").textContent).toBe("Draft text");
    fireEvent.click(screen.getByText("Save and leave"));
    await waitFor(() => expect(currentPath()).toBe("/LabRat/labs/lab-a/projects"));
  });

  it("guards logout and the native unload event only while a draft is dirty", async () => {
    mount(["/LabRat/projects/project-a/manuscript"]); await screen.findByText("Manuscript editor");
    const cleanEvent = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(cleanEvent); expect(cleanEvent.defaultPrevented).toBe(false);
    await draft();
    const dirtyEvent = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(dirtyEvent); expect(dirtyEvent.defaultPrevented).toBe(true);
    await tab("File menu"); await tab("Logout");
    expect(api.logoutFromServer).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText("Discard and leave"));
    await screen.findByText("Log in"); expect(currentPath()).toBe("/LabRat/login");
  });

  it("returns to the requested page after sign-in", async () => {
    api.getServerSession.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), { status: 401 }));
    mount(["/LabRat/projects/project-b/references"]);
    fireEvent.click(await screen.findByText("Log in"));
    await waitFor(() => expect(currentPath()).toBe("/LabRat/login"));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-only" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in", exact: true }));
    await screen.findByText("References project-b");
    expect(currentPath()).toBe("/LabRat/projects/project-b/references");
  });

  it.each([403, 404])("shows an unavailable state on project error %s without falling into another project", async (status) => {
    api.getServerProjectState.mockRejectedValueOnce(Object.assign(new Error("Project unavailable"), { status }));
    mount(["/LabRat/projects/missing/browser"]);
    await screen.findByText("Workspace unavailable");
    expect(api.getServerProjectState).toHaveBeenCalledTimes(1);
    expect(currentPath()).toBe("/LabRat/projects/missing/browser");
    fireEvent.click(screen.getByText("Back to projects"));
    await waitFor(() => expect(currentPath()).toBe("/LabRat/labs/lab-a/projects"));
  });

  it("clears dirty data on revoked access even with an outstanding save", async () => {
    let finishSave;
    api.patchServerManuscript.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    mount(["/LabRat/projects/project-a/manuscript"]); await draft(); await tab("Home");
    fireEvent.click(await screen.findByText("Save and leave"));
    await act(async () => access.listener(403));
    await screen.findByText("Workspace unavailable");
    await act(async () => finishSave({ manuscript: { id: "old-save" } }));
    expect(screen.queryByTestId("draft")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentPath()).toBe("/LabRat/projects/project-a/manuscript");
  });

  it("clears a dirty project on session expiry and preserves its return address", async () => {
    mount(["/LabRat/projects/project-a/manuscript"]); await draft();
    await act(async () => access.listener(401));
    await screen.findByText("Log in");
    expect(currentPath()).toBe("/LabRat/login");
    expect(new URLSearchParams(router.state.location.search).get("returnTo")).toBe("/projects/project-a/manuscript");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores old project responses after A to B to A navigation", async () => {
    let finishOld;
    api.getServerProjectState.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    mount(); await waitFor(() => expect(api.getServerProjectState).toHaveBeenCalledTimes(1));
    await move("/projects/project-b/browser"); await screen.findByText("Browser project-b");
    await move(-1); await screen.findByRole("button", { name: "Overview", exact: true });
    await act(async () => finishOld({ ...state(), project: { ...state().project, name: "STALE PROJECT" } }));
    expect(screen.queryByText("STALE PROJECT")).toBeNull();
    expect(currentPath()).toBe("/LabRat/projects/project-a/overview");
  });

  it("keeps unknown paths explicit and rejects an inaccessible lab", async () => {
    mount(["/LabRat/not-a-page"]); await screen.findByText("Page not found");
    await move("/labs/missing/projects"); await screen.findByText("Workspace unavailable");
    expect(api.getServerProjectState).not.toHaveBeenCalled();
    expect(api.listServerProjects).not.toHaveBeenCalled();
  });

  it("keeps new project onboarding on Overview but honors direct manuscript links", async () => {
    api.getServerProjectState.mockResolvedValue({ ...state(), publishedExperimentCount: 0, experimentSnapshotHeads: [] });
    mount(); await screen.findByText("Project onboarding");
    await move("/projects/project-a/manuscript"); await screen.findByText("Manuscript editor");
    await move(-1); await screen.findByText("Project onboarding");
    fireEvent.click(screen.getByText("Exit onboarding"));
    await waitFor(() => expect(currentPath()).toBe("/LabRat/labs/lab-a/projects"));
  });

  it("accepts only in-app protected login return paths", () => {
    for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/login", "/unknown"]) expect(loginReturnPath(`?returnTo=${encodeURIComponent(value)}`)).toBe("/");
    expect(loginReturnPath("?returnTo=%2Fprojects%2Fp%2Fbrowser")).toBe("/projects/p/browser");
  });

  it("does not replay a chart placement after Back and Forward", async () => {
    mount(); await tab("Manage charts");
    fireEvent.click(await screen.findByText("Insert test chart"));
    await screen.findByText("Manuscript editor");
    await waitFor(() => expect(screen.getByTestId("draft").textContent).toBe("Inserted"));
    await move(-1); await screen.findByRole("button", { name: "Manage charts" });
    expect(screen.queryByRole("dialog", { name: "Manage approved charts" })).toBeNull();
    await move(1); expect(screen.getByTestId("draft").textContent).toBe("Inserted");
    expect(api.patchServerManuscript).not.toHaveBeenCalled();
  });

  it("keeps the current page when a workbook-open request finishes after navigation", async () => {
    let finish;
    api.getServerWorkbookReviewSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    api.getServerProjectState.mockResolvedValue({ ...state(), workbookReviewSessions: [{ id: "review-1", status: "active", workbookName: "Review workbook" }] });
    mount(); await tab("Review workbook");
    await tab("Open Workbook");
    await waitFor(() => expect(api.getServerWorkbookReviewSession).toHaveBeenCalled());
    await tab("Browser");
    await act(async () => finish({ workbookReviewSession: { id: "review-1" }, reviewRegions: [] }));
    expect(screen.getByText("Browser project-a")).toBeTruthy();
    expect(document.querySelector(".tabs .active")?.textContent).toBe("Browser");
  });

  it("preserves the draft when the same project root replaces itself with Overview", async () => {
    mount(["/LabRat/projects/project-a/manuscript"]); await draft();
    await move("/projects/project-a");
    await waitFor(() => expect(currentPath()).toBe("/LabRat/projects/project-a/overview"));
    await tab("Manuscript"); expect(screen.getByTestId("draft").textContent).toBe("Draft text");
    expect(api.getServerProjectState).toHaveBeenCalledTimes(1);
  });

  it("shares an outstanding save with Save and leave without creating duplicates", async () => {
    let finish;
    api.patchServerManuscript.mockImplementationOnce((id, body) => new Promise((resolve) => { finish = () => resolve({ manuscript: { id, ...body } }); }));
    mount(["/LabRat/projects/project-a/manuscript"]); await draft();
    fireEvent.click(screen.getByText("Save manuscript"));
    await tab("Home"); fireEvent.click(await screen.findByText("Save and leave"));
    expect(api.patchServerManuscript).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(currentPath()).toBe("/LabRat/labs/lab-a/projects"));
  });

  it("does not treat nullable historical manuscript fields as edits", async () => {
    api.getServerProjectState.mockResolvedValue({ ...state(), manuscripts: [{ id: "old", blocks: null, pages: null, references: null, canvasState: null }] });
    mount(["/LabRat/projects/project-a/manuscript"]);
    await screen.findByText("Manuscript editor"); await tab("Home");
    await waitFor(() => expect(currentPath()).toBe("/LabRat/labs/lab-a/projects"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("normalizes automatic canvas defaults but detects an actual manuscript edit", () => {
    const stored = { blocks: [{ id: "text", kind: "text", html: "Saved", x: 10, y: 10, w: 100, h: 50 }], pages: [{ id: "page", y: 0, width: 1600, height: 900 }] };
    const initialized = { ...stored, canvasState: { canvasHeight: 900, pageOrientationPreference: "landscape" } };
    expect(manuscriptDraftFingerprint(stored)).toBe(manuscriptDraftFingerprint(initialized));
    expect(manuscriptDraftFingerprint({ ...initialized, blocks: [{ ...stored.blocks[0], html: "Edited" }] })).not.toBe(manuscriptDraftFingerprint(stored));
  });
});
