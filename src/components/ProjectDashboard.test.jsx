import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel, ChartReviewModal, DeleteProjectModal, NewProjectModal, ProjectDashboard, ProjectOverview, Topbar, WorkbookReviewWorkspace, activeChartSpecsForProject, latestItem, mergeProjectStateForWorkspaceRefresh } from "../main.jsx";

const project = {
  id: "project_1",
  name: "Catalyst Screening",
  description: "Compare catalysts",
  status: "active",
  updatedAt: "2026-06-15T12:00:00.000Z",
  projectProfile: {
    researchGoal: "Compare gas selectivity.",
    experimentBackground: "Screening run",
    materials: "Ru/TiO2",
  },
};

const projectState = {
  project,
  projectProfile: project.projectProfile,
  experimentSnapshotHeads: [
    { experimentIdentityId: "exp_30", dataSnapshotId: "snapshot_1" },
    { experimentIdentityId: "exp_31", dataSnapshotId: "snapshot_1" },
  ],
  importRuns: [{ id: "run_1", status: "applied" }],
  chartProposalSets: [{
    id: "chart_set_1",
    payload: { proposals: [{ proposalId: "chart_1", status: "accepted" }] },
  }],
  chartSpecs: [{
    id: "chart_spec_1",
    title: "Gas vs Temperature",
    origin: "source_extract",
    sourceSnapshot: { rows: [{ values: { temperature: 250, gas: 0.35 } }] },
  }],
  manuscripts: [{ id: "manuscript_1", updatedAt: "2026-06-15T12:00:00.000Z" }],
};

function jsonResponse(body, init = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status || 200,
    json: async () => body,
  };
}

describe("Topbar", () => {
  it("moves Projects into the File menu and keeps lab/project context readonly", () => {
    const onOpenDashboard = vi.fn();
    render(
      <Topbar
        tab="overview"
        setTab={() => {}}
        workspaceMode="project"
        onOpenDashboard={onOpenDashboard}
        onAgent={() => {}}
        sourceError=""
        onOpenImportReview={() => {}}
        hasImportReview
        user={{ username: "labuser" }}
        labs={[{ id: "lab_1", name: "Lab A", role: "editor" }]}
        activeLabId="lab_1"
        onLabChange={() => {}}
        projects={[project]}
        activeProjectId="project_1"
        onProjectChange={() => {}}
        onCreateProject={() => {}}
        onOpenProfile={() => {}}
        onLogout={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Projects" })).toBeNull();
    expect(screen.getByLabelText("Current lab and project").textContent).toContain("Lab A");
    expect(screen.getByLabelText("Current lab and project").textContent).toContain("Catalyst Screening");
    expect(screen.getByRole("button", { name: "File menu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "File menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));

    expect(onOpenDashboard).toHaveBeenCalledTimes(1);
  });

  it("hides project workspace tabs and file context while viewing the Projects dashboard", () => {
    render(
      <Topbar
        tab="overview"
        setTab={() => {}}
        workspaceMode="dashboard"
        onOpenDashboard={() => {}}
        onAgent={() => {}}
        sourceError=""
        onOpenImportReview={() => {}}
        hasImportReview
        user={{ username: "labuser" }}
        labs={[{ id: "lab_1", name: "Lab A", role: "editor" }]}
        activeLabId="lab_1"
        onLabChange={() => {}}
        projects={[project]}
        activeProjectId="project_1"
        onProjectChange={() => {}}
        onCreateProject={() => {}}
        onOpenProfile={() => {}}
        onLogout={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Browser" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manuscript" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refs" })).toBeNull();
    expect(screen.queryByRole("button", { name: "File menu" })).toBeNull();
    expect(screen.queryByLabelText("Current lab and project")).toBeNull();
  });
});
describe("ProjectDashboard", () => {
  it("renders project workflow status and opens the selected project", () => {
    const onOpenProject = vi.fn();
    const onRequestDeleteProject = vi.fn();
    render(
      <ProjectDashboard
        user={{ username: "labuser" }}
        labs={[{ id: "lab_1", name: "Lab A", role: "editor" }]}
        activeLabId="lab_1"
        onLabChange={() => {}}
        projects={[project]}
        selectedProjectId="project_1"
        onSelectProject={() => {}}
        onOpenProject={onOpenProject}
        onCreateProject={() => {}}
        onRequestDeleteProject={onRequestDeleteProject}
        activeProjectId="project_1"
        projectState={projectState}
        projectStateLoading={false}
        sourceError=""
      />,
    );

    expect(screen.getAllByText("Catalyst Screening").length).toBeGreaterThan(0);
    expect(screen.getByText("2 experiments")).toBeTruthy();
    expect(screen.getByText("1 specs")).toBeTruthy();
    expect(screen.getAllByText("Jun 15, 2026").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(onOpenProject).toHaveBeenCalledWith("project_1");
    expect(screen.queryByRole("button", { name: "Open project" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(onRequestDeleteProject).toHaveBeenCalledWith(expect.objectContaining({ id: "project_1" }));
  });

  it("shows no delete project action without a selected project", () => {
    render(
      <ProjectDashboard
        user={{ username: "labuser" }}
        labs={[{ id: "lab_1", name: "Lab A", role: "editor" }]}
        activeLabId="lab_1"
        onLabChange={() => {}}
        projects={[]}
        selectedProjectId=""
        onSelectProject={() => {}}
        onOpenProject={() => {}}
        onCreateProject={() => {}}
        onRequestDeleteProject={() => {}}
        activeProjectId=""
        projectState={null}
        projectStateLoading={false}
        sourceError=""
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete project" })).toBeNull();
  });
});

describe("DeleteProjectModal", () => {
  it("confirms or cancels project deletion", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <DeleteProjectModal
        open
        project={project}
        loading={false}
        error=""
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Delete project" })).toBeTruthy();
    expect(screen.getByText("Catalyst Screening")).toBeTruthy();
    expect(screen.getByText(/Audit data/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(onConfirm).toHaveBeenCalledWith(project);

    rerender(
      <DeleteProjectModal
        open
        project={project}
        loading
        error="Delete failed"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Delete failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deleting..." }).disabled).toBe(true);
  });
});

describe("ProjectOverview", () => {
  it("shows the current workflow surfaces and routes actions", () => {
    const onUploadWorkbook = vi.fn();
    const onOpenChartReview = vi.fn();
    const onAskLabRat = vi.fn();
    const onGoManuscript = vi.fn();
    const onGoBrowser = vi.fn();
    const state = {
      ...projectState,
      sourceDocuments: [{ id: "source_doc_1" }],
      workbookReviewSessions: [{ id: "session_1" }],
    };

    render(
      <ProjectOverview
        projectState={state}
        onAskLabRat={onAskLabRat}
        onOpenProfile={() => {}}
        onUploadWorkbook={onUploadWorkbook}
        onGoBrowser={onGoBrowser}
        onOpenChartReview={onOpenChartReview}
        onGoManuscript={onGoManuscript}
      />,
    );

    expect(screen.getByText("Ask LabRat")).toBeTruthy();
    expect(screen.getByText("Project profile")).toBeTruthy();
    expect(screen.getByText("Workbook review")).toBeTruthy();
    expect(screen.getAllByText("Experiment Browser").length).toBeGreaterThan(0);
    expect(screen.getByText("2 published experiments")).toBeTruthy();
    expect(screen.getAllByText("Review chart proposals").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Manage approved charts").length).toBeGreaterThan(0);
    expect(screen.getByText("Manuscript")).toBeTruthy();
    expect(screen.queryByText("Master Dataset")).toBeNull();
    expect(screen.queryByText("Supplemental Workbooks")).toBeNull();
    expect(screen.queryByText("Semantic mappings")).toBeNull();
    expect(screen.getByText("1 source documents")).toBeTruthy();
    expect(screen.getByText(/1 review sessions/)).toBeTruthy();
    expect(screen.getByText("1 accepted / 1 specs")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Ask LabRat" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue review" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Experiment Browser" }));
    fireEvent.click(screen.getByRole("button", { name: "Review chart proposals" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage approved charts" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert approved charts" }));

    expect(onAskLabRat).toHaveBeenCalledTimes(1);
    expect(onUploadWorkbook).toHaveBeenCalledTimes(1);
    expect(onGoBrowser).toHaveBeenCalledTimes(1);
    expect(onOpenChartReview).toHaveBeenCalledTimes(2);
    expect(onOpenChartReview).toHaveBeenLastCalledWith({ statusFilter: "active" });
    expect(onGoManuscript).toHaveBeenCalledTimes(1);
  });

  it("lists pending chart proposals from the latest proposal set and opens review focused on edit", () => {
    const onOpenChartReview = vi.fn();
    const stateWithPendingProposals = {
      ...projectState,
      chartProposalSets: [
        {
          id: "chart_set_old",
          updatedAt: "2026-06-14T12:00:00.000Z",
          payload: {
            proposals: [
              { proposalId: "old_pending", status: "proposed", chartType: "scatter", title: "Old pending proposal" },
            ],
          },
        },
        {
          id: "chart_set_current",
          updatedAt: "2026-06-16T12:00:00.000Z",
          payload: {
            proposals: [
              { proposalId: "pending_1", status: "proposed", chartType: "scatter", title: "Conversion vs Time", confidence: 0.88 },
              { proposalId: "pending_2", chartType: "bar", title: "Yield by Catalyst", confidence: 0.73 },
              { proposalId: "accepted_1", status: "accepted", chartType: "scatter", title: "Accepted Chart" },
              { proposalId: "rejected_1", status: "rejected", chartType: "bar", title: "Rejected Chart" },
              { proposalId: "pending_3", status: "proposed", chartType: "line", title: "Pressure vs Rate" },
              { proposalId: "pending_4", status: "proposed", chartType: "scatter", title: "Temperature vs Rate" },
            ],
          },
        },
      ],
    };

    render(
      <ProjectOverview
        projectState={stateWithPendingProposals}
        onOpenProfile={() => {}}
        onUploadWorkbook={() => {}}
        onOpenChartReview={onOpenChartReview}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText("Conversion vs Time")).toBeTruthy();
    expect(screen.getByText("scatter - 88% - proposed")).toBeTruthy();
    expect(screen.getByText("Yield by Catalyst")).toBeTruthy();
    expect(screen.getByText("bar - 73% - proposed")).toBeTruthy();
    expect(screen.getByText("Pressure vs Rate")).toBeTruthy();
    expect(screen.getByText("+1 more pending")).toBeTruthy();
    expect(screen.getByText("1 accepted / 4 pending")).toBeTruthy();
    expect(screen.queryByText("Old pending proposal")).toBeNull();
    expect(screen.queryByText("Accepted Chart")).toBeNull();
    expect(screen.queryByText("Rejected Chart")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Manage approved charts" }));
    expect(onOpenChartReview).toHaveBeenCalledWith({ statusFilter: "active" });
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(onOpenChartReview).toHaveBeenLastCalledWith("pending_1");
  });

  it("shows accepted workbook review status after experiments are published", () => {
    const onUploadWorkbook = vi.fn();
    const onGoBrowser = vi.fn();
    render(
      <ProjectOverview
        projectState={{
          ...projectState,
          sourceDocuments: [{ id: "source_doc_1" }],
          workbookReviewSessions: [{ id: "session_1", status: "accepted" }],
        }}
        onAskLabRat={() => {}}
        onOpenProfile={() => {}}
        onUploadWorkbook={onUploadWorkbook}
        onGoBrowser={onGoBrowser}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText(/1 accepted review/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue review" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View accepted review" }));
    expect(onUploadWorkbook).toHaveBeenCalledWith({ id: "session_1", status: "accepted" });
  });

  it("opens the latest pending review when pending and accepted sessions coexist", () => {
    const onUploadWorkbook = vi.fn();
    const pendingSession = {
      id: "session_pending",
      status: "review",
      updatedAt: "2026-07-18T12:00:00.000Z",
    };
    render(
      <ProjectOverview
        projectState={{
          ...projectState,
          sourceDocuments: [{ id: "source_doc_1" }, { id: "source_doc_2" }],
          workbookReviewSessions: [
            pendingSession,
            {
              id: "session_accepted",
              status: "accepted",
              updatedAt: "2026-07-19T12:00:00.000Z",
            },
          ],
        }}
        onAskLabRat={() => {}}
        onOpenProfile={() => {}}
        onUploadWorkbook={onUploadWorkbook}
        onGoBrowser={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue review" }));
    expect(onUploadWorkbook).toHaveBeenCalledWith(pendingSession);
  });

  it("ignores stale chart specs in overview counts and active chart choices", () => {
    const stateWithStaleSpec = {
      ...projectState,
      chartSpecs: [
        { id: "chart_spec_active", title: "Current Gas", origin: "source_extract", sourceSnapshot: { rows: [{ temperature: 300, gas: 12 }] }, status: "active", isStale: false },
        { id: "chart_spec_stale", title: "Old Gas", status: "stale", isStale: true },
      ],
    };

    render(
      <ProjectOverview
        projectState={stateWithStaleSpec}
        onOpenProfile={() => {}}
        onUploadWorkbook={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText("1 accepted / 1 specs")).toBeTruthy();
    expect(screen.getByText(/older specs are hidden/)).toBeTruthy();
    expect(activeChartSpecsForProject(stateWithStaleSpec).map((chartSpec) => chartSpec.id)).toEqual(["chart_spec_active"]);
  });

  it("selects the newest dated proposal set when server records are returned newest-first", () => {
    const selected = latestItem([
      { id: "chart_set_new", updatedAt: "2026-06-17T12:00:00.000Z" },
      { id: "chart_set_old", updatedAt: "2026-06-16T12:00:00.000Z" },
    ]);

    expect(selected.id).toBe("chart_set_new");
  });
});

describe("project state refresh helpers", () => {
  it("preserves the current manuscript slice during workspace data refreshes", () => {
    const currentState = {
      project: { id: "project_1" },
      chartSpecs: [{ id: "chart_old" }],
      manuscripts: [{
        id: "manuscript_1",
        blocks: [{ id: "local_unsaved", kind: "text", text: "Unsaved draft" }],
      }],
    };
    const incomingState = {
      project: { id: "project_1" },
      chartSpecs: [{ id: "chart_new" }],
      manuscripts: [{
        id: "manuscript_1",
        blocks: [{ id: "server_stale", kind: "text", text: "Server copy" }],
      }],
    };

    const merged = mergeProjectStateForWorkspaceRefresh(currentState, incomingState, { preserveManuscripts: true });

    expect(merged.project.id).toBe("project_1");
    expect(merged.chartSpecs.map((chartSpec) => chartSpec.id)).toEqual(["chart_new"]);
    expect(merged.manuscripts).toEqual(currentState.manuscripts);
  });

  it("uses incoming manuscripts for full project loads", () => {
    const currentState = { manuscripts: [{ id: "local" }] };
    const incomingState = { manuscripts: [{ id: "server" }] };

    expect(mergeProjectStateForWorkspaceRefresh(currentState, incomingState).manuscripts).toEqual([{ id: "server" }]);
  });
});

describe("WorkbookReviewWorkspace", () => {
  function makeWorkbookReviewFetch() {
    return vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/source-documents") {
        return jsonResponse({
          sourceDocuments: [{
            id: "source_doc_1",
            metadata: {
              workbookName: "Master.xlsx",
              sheets: [{ name: "Sheet1", usedRange: "A1:D5", rowCount: 5, columnCount: 4 }],
            },
            summary: { sheetCount: 1, regionCount: 1, nonEmptyCellCount: 12 },
          }],
        });
      }
      if (url === "/api/source-documents/source_doc_1/regions") {
        return jsonResponse({ regions: [] });
      }
      if (url === "/api/source-documents/source_doc_1/range") {
        const body = JSON.parse(init.body || "{}");
        return jsonResponse({
          sheetName: body.sheetName,
          range: body.range,
          rows: [
            [
              { row: 0, col: 0, address: "A1", rawValue: "Label", formattedValue: "Label" },
              { row: 0, col: 1, address: "B1", rawValue: "Date", formattedValue: "Date" },
            ],
          ],
          cells: [],
        });
      }
      return jsonResponse({});
    });
  }

  const reviewState = {
    loading: false,
    error: "",
    revisionLoading: false,
    confirmLoading: false,
    revisionError: "",
    clarification: null,
    session: {
      id: "session_1",
      status: "needs_user_review",
      workbookSummary: { workbookName: "Master.xlsx", sheetCount: 1, regionCount: 1, nonEmptyCellCount: 12 },
      currentUnderstanding: {},
      messages: [{ id: "msg_1", role: "assistant", content: "I indexed Master.xlsx." }],
    },
    sourceDocument: {
      id: "source_doc_1",
      metadata: { workbookName: "Master.xlsx" },
    },
    regions: [],
  };

  it("renders an Excel-only workbook preview without legacy review cards", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      const { container } = render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      expect(await screen.findByText("Label")).toBeTruthy();
      expect(screen.getByText("Date")).toBeTruthy();
      expect(screen.getByRole("grid", { name: "Workbook sheet preview" })).toBeTruthy();
      expect(container.querySelector(".workbook-data-grid-shell")).toBeTruthy();
      expect(container.querySelector("table.workbook-excel-grid")).toBeNull();
      expect(screen.queryByText("Source workbook")).toBeNull();
      expect(screen.queryByText("Detected source regions")).toBeNull();
      expect(screen.queryByRole("button", { name: "Preview extract" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Upload workbook" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Choose another workbook" })).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("turns a clicked workbook suggestion into a focused local draft red box", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onDraftRegionsChange={onDraftRegionsChange}
          focusSelection={{
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "A1:B2",
            selectionMethod: "suggestion_click",
            description: "Detected experiment table",
          }}
        />,
      );

      await waitFor(() => {
        const latest = onDraftRegionsChange.mock.calls.at(-1)?.[0] || [];
        expect(latest).toHaveLength(1);
      });
      const nextRegions = onDraftRegionsChange.mock.calls.at(-1)[0];
      expect(nextRegions[0]).toMatchObject({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        range: "A1:B2",
        selectionMethod: "suggestion_click",
        description: "Detected experiment table",
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("keeps the workbook grid mounted while the dock updates", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      function Harness() {
        const [dockRevision, setDockRevision] = React.useState(0);
        return (
          <WorkbookReviewWorkspace
            projectId="project_1"
            reviewState={reviewState}
            draftRegions={[]}
            onDraftRegionsChange={() => {}}
            reviewDock={(
              <aside aria-label="Test workbook review dock">
                <span>Dock revision {dockRevision}</span>
                <button type="button" onClick={() => setDockRevision((value) => value + 1)}>Update dock</button>
              </aside>
            )}
          />
        );
      }

      render(<Harness />);
      const grid = await screen.findByRole("grid", { name: "Workbook sheet preview" });
      await screen.findByText("Label");
      const rangeInput = screen.getByLabelText("Visible range");
      fireEvent.change(rangeInput, { target: { value: "A1:A2" } });
      await waitFor(() => expect(screen.getByLabelText("Visible range").value).toBe("A1:A2"));

      fireEvent.click(screen.getByRole("button", { name: "Update dock" }));

      expect(screen.getByText("Dock revision 1")).toBeTruthy();
      expect(screen.getByRole("grid", { name: "Workbook sheet preview" })).toBe(grid);
      expect(screen.getByLabelText("Visible range").value).toBe("A1:A2");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("focuses the workbook viewport when the active red box changes", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const draftRegions = [{
      clientRegionId: "draft_1",
      draftRegionId: "draft_1",
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      range: "A1:B2",
      status: "draft",
    }, {
      clientRegionId: "draft_2",
      draftRegionId: "draft_2",
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      range: "C3:D4",
      status: "draft",
    }];
    try {
      const { rerender } = render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={draftRegions}
          activeDraftRegionId="draft_1"
          onDraftRegionsChange={() => {}}
        />,
      );

      await screen.findByText("Label");
      await waitFor(() => expect(screen.getByLabelText("Visible range").value).toBe("A1:D5"));

      rerender(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={draftRegions}
          activeDraftRegionId="draft_2"
          onDraftRegionsChange={() => {}}
          focusSelection={{
            requestId: "focus_draft_2",
            clientRegionId: "draft_2",
            draftRegionId: "draft_2",
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "C3:D4",
            selectionMethod: "red_box_click",
          }}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText("Visible range").value).toBe("C3:D4"));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("creates a local draft red box by dragging from one workbook cell to another", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onDraftRegionsChange={onDraftRegionsChange}
        />,
      );

      const startCell = await screen.findByLabelText("Cell A1");
      const endCell = await screen.findByLabelText("Cell B1");
      fireEvent.mouseDown(startCell, { button: 0 });
      fireEvent.mouseEnter(endCell);
      fireEvent.mouseUp(endCell);

      await waitFor(() => expect(onDraftRegionsChange).toHaveBeenCalled());
      const nextRegions = onDraftRegionsChange.mock.calls.at(-1)[0];
      expect(nextRegions).toHaveLength(1);
      expect(nextRegions[0]).toMatchObject({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        range: "A1:B1",
        selectionMethod: "drag_select",
        status: "draft",
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("focuses source evidence without creating a semantic red box", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onDraftRegionsChange={onDraftRegionsChange}
          focusSelection={{
            requestId: "evidence_focus_1",
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "C3:D4",
            selectionMethod: "experiment_browser_source_link",
            focusOnly: true,
          }}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText("Visible range").value).toBe("C3:D4"));
      expect(onDraftRegionsChange).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("reuses loaded workbook range windows when returning to a previous visible range", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      await screen.findByText("Label");
      await waitFor(() => {
        const rangeRequests = fetchMock.mock.calls
          .filter(([url]) => url === "/api/source-documents/source_doc_1/range")
          .map(([, init]) => JSON.parse(init.body || "{}").range);
        expect(rangeRequests).toContain("A1:D5");
      });

      const rangeInput = screen.getByLabelText("Visible range");
      fireEvent.change(rangeInput, { target: { value: "A1:B2" } });
      await waitFor(() => {
        const rangeRequests = fetchMock.mock.calls
          .filter(([url]) => url === "/api/source-documents/source_doc_1/range")
          .map(([, init]) => JSON.parse(init.body || "{}").range);
        expect(rangeRequests).toContain("A1:B2");
      });

      fireEvent.change(rangeInput, { target: { value: "A1:D5" } });
      await act(async () => {});

      const rangeRequests = fetchMock.mock.calls
        .filter(([url]) => url === "/api/source-documents/source_doc_1/range")
        .map(([, init]) => JSON.parse(init.body || "{}").range);
      expect(rangeRequests.filter((range) => range === "A1:D5")).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("resets the real grid and adopts the next workbook range when switching workbooks", async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/source-documents") {
        return jsonResponse({
          sourceDocuments: [{
            id: "source_doc_1",
            metadata: {
              workbookName: "First.xlsx",
              sheets: [{ name: "Sheet1", usedRange: "A1:F81", rowCount: 81, columnCount: 6 }],
            },
          }, {
            id: "source_doc_2",
            metadata: {
              workbookName: "Second.xlsx",
              sheets: [{ name: "Results", usedRange: "C3:D4", rowCount: 4, columnCount: 4 }],
            },
          }],
        });
      }
      if (url === "/api/source-documents/source_doc_1/range"
        || url === "/api/source-documents/source_doc_2/range") {
        const body = JSON.parse(init.body || "{}");
        return jsonResponse({
          sheetName: body.sheetName,
          range: body.range,
          rows: [],
          cells: [],
        });
      }
      return jsonResponse({});
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={{
            ...reviewState,
            sourceDocument: {
              id: "source_doc_1",
              metadata: {
                workbookName: "First.xlsx",
                sheets: [{ name: "Sheet1", usedRange: "A1:F81", rowCount: 81, columnCount: 6 }],
              },
            },
          }}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText("Visible range").value).toBe("A1:F81"));
      const grid = screen.getByRole("grid", { name: "Workbook sheet preview" });
      Object.defineProperty(grid, "scrollTop", { configurable: true, writable: true, value: 900 });
      Object.defineProperty(grid, "scrollLeft", { configurable: true, writable: true, value: 240 });
      fireEvent.scroll(grid);

      fireEvent.change(await screen.findByLabelText("Workbook"), { target: { value: "source_doc_2" } });

      await waitFor(() => expect(screen.getByLabelText("Visible range").value).toBe("C3:D4"));
      expect(grid.scrollTop).toBe(0);
      expect(grid.scrollLeft).toBe(0);
      await waitFor(() => {
        const secondWorkbookRequests = fetchMock.mock.calls
          .filter(([url]) => url === "/api/source-documents/source_doc_2/range")
          .map(([, init]) => JSON.parse(init.body || "{}"));
        expect(secondWorkbookRequests).toContainEqual({ sheetName: "Results", range: "C3:D4" });
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses stable cached workbook tiles while dragging the scrollbar and returning to loaded rows", async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/source-documents") {
        return jsonResponse({
          sourceDocuments: [{
            id: "source_doc_1",
            metadata: {
              workbookName: "Master.xlsx",
              sheets: [{ name: "Sheet1", usedRange: "A1:F81", rowCount: 81, columnCount: 6 }],
            },
            summary: { sheetCount: 1, regionCount: 0, nonEmptyCellCount: 81 },
          }],
        });
      }
      if (url === "/api/source-documents/source_doc_1/range") {
        const body = JSON.parse(init.body || "{}");
        const startRow = Number(body.range.match(/^[A-Z]+(\d+):/)?.[1] || 1);
        return jsonResponse({
          sheetName: body.sheetName,
          range: body.range,
          rows: [[{
            row: startRow - 1,
            col: 0,
            address: `A${startRow}`,
            rawValue: `Row ${startRow}`,
            formattedValue: `Row ${startRow}`,
          }]],
          cells: [],
        });
      }
      return jsonResponse({});
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={{
            ...reviewState,
            sourceDocument: {
              id: "source_doc_1",
              metadata: {
                workbookName: "Master.xlsx",
                sheets: [{ name: "Sheet1", usedRange: "A1:F81", rowCount: 81, columnCount: 6 }],
              },
            },
          }}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      expect(await screen.findByText("Row 1")).toBeTruthy();
      const grid = screen.getByRole("grid", { name: "Workbook sheet preview" });
      Object.defineProperty(grid, "clientWidth", { configurable: true, value: 1100 });
      Object.defineProperty(grid, "clientHeight", { configurable: true, value: 600 });
      Object.defineProperty(grid, "scrollTop", { configurable: true, writable: true, value: 0 });
      Object.defineProperty(grid, "scrollLeft", { configurable: true, writable: true, value: 0 });

      grid.scrollTop = 100;
      fireEvent.scroll(grid);
      grid.scrollTop = 700;
      fireEvent.scroll(grid);
      grid.scrollTop = 1500;
      fireEvent.scroll(grid);

      await waitFor(() => {
        const loadedRanges = fetchMock.mock.calls
          .filter(([url]) => url === "/api/source-documents/source_doc_1/range");
        expect(loadedRanges.length).toBeGreaterThan(1);
      });

      grid.scrollTop = 100;
      fireEvent.scroll(grid);
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 160);
        });
      });

      const rangeRequests = fetchMock.mock.calls
        .filter(([url]) => url === "/api/source-documents/source_doc_1/range")
        .map(([, init]) => JSON.parse(init.body || "{}").range);
      const startRows = rangeRequests.map((range) => Number(range.match(/^[A-Z]+(\d+):/)?.[1] || 0));
      expect(startRows.every((row) => (row - 1) % 40 === 0)).toBe(true);
      expect(rangeRequests.filter((range) => range === "A1:F40")).toHaveLength(1);
      expect(new Set(rangeRequests).size).toBe(rangeRequests.length);
      expect(screen.getByText("Row 1")).toBeTruthy();
      rangeRequests.forEach((range) => {
        const [, startCol, startRow, endCol, endRow] = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/) || [];
        const columnNumber = (label) => [...label].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
        expect((Number(endRow) - Number(startRow) + 1) * (columnNumber(endCol) - columnNumber(startCol) + 1)).toBeLessThanOrEqual(500);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("replaces the active draft red box when dragging a new range", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    const onActiveDraftRegionChange = vi.fn();
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[{
            clientRegionId: "draft_active",
            draftRegionId: "draft_active",
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "A1:B1",
            selectionMethod: "drag_select",
            description: "",
            status: "draft",
          }]}
          activeDraftRegionId="draft_active"
          onDraftRegionsChange={onDraftRegionsChange}
          onActiveDraftRegionChange={onActiveDraftRegionChange}
        />,
      );

      const startCell = await screen.findByLabelText("Cell C1");
      const endCell = await screen.findByLabelText("Cell D1");
      fireEvent.mouseDown(startCell, { button: 0 });
      fireEvent.mouseEnter(endCell);
      fireEvent.mouseUp(endCell);

      await waitFor(() => expect(onDraftRegionsChange).toHaveBeenCalled());
      const nextRegions = onDraftRegionsChange.mock.calls.at(-1)[0];
      expect(nextRegions).toHaveLength(1);
      expect(nextRegions[0]).toMatchObject({
        clientRegionId: "draft_active",
        draftRegionId: "draft_active",
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        range: "C1:D1",
        selectionMethod: "drag_select",
        status: "draft",
      });
      expect(onActiveDraftRegionChange).toHaveBeenCalledWith("draft_active");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("adds and toggles disconnected draft ranges with Ctrl-drag", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    const onActiveDraftRegionChange = vi.fn();
    const initialRegion = {
      clientRegionId: "draft_active",
      draftRegionId: "draft_active",
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      range: "A1:B1",
      selectionMethod: "drag_select",
      description: "",
      status: "draft",
    };
    try {
      function Harness() {
        const [regions, setRegions] = React.useState([initialRegion]);
        const [activeId, setActiveId] = React.useState("draft_active");
        return (
          <WorkbookReviewWorkspace
            projectId="project_1"
            reviewState={reviewState}
            draftRegions={regions}
            activeDraftRegionId={activeId}
            onDraftRegionsChange={(next) => {
              onDraftRegionsChange(next);
              setRegions(next);
            }}
            onActiveDraftRegionChange={(next) => {
              onActiveDraftRegionChange(next);
              setActiveId(next);
            }}
          />
        );
      }
      render(<Harness />);

      const startCell = await screen.findByLabelText("Cell C1");
      const endCell = await screen.findByLabelText("Cell D1");
      fireEvent.mouseDown(startCell, { button: 0, ctrlKey: true });
      fireEvent.mouseEnter(endCell);
      fireEvent.mouseUp(endCell);

      await waitFor(() => {
        const regions = onDraftRegionsChange.mock.calls.at(-1)?.[0] || [];
        expect(regions.map((region) => region.range)).toEqual(["A1:B1", "C1:D1"]);
      });
      const addedRegionId = onActiveDraftRegionChange.mock.calls.at(-1)[0];
      expect(addedRegionId).not.toBe("draft_active");

      fireEvent.mouseDown(startCell, { button: 0, ctrlKey: true });
      fireEvent.mouseEnter(endCell);
      fireEvent.mouseUp(endCell);

      await waitFor(() => {
        const regions = onDraftRegionsChange.mock.calls.at(-1)?.[0] || [];
        expect(regions.map((region) => region.range)).toEqual(["A1:B1"]);
      });
      expect(onActiveDraftRegionChange).toHaveBeenLastCalledWith("draft_active");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("auto-scrolls and extends drag selection when the pointer reaches the workbook edge", async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/source-documents") {
        return jsonResponse({
          sourceDocuments: [{
            id: "source_doc_1",
            metadata: {
              workbookName: "Master.xlsx",
              sheets: [{ name: "Sheet1", usedRange: "A1:J20", rowCount: 20, columnCount: 10 }],
            },
            summary: { sheetCount: 1, regionCount: 1, nonEmptyCellCount: 12 },
          }],
        });
      }
      if (url === "/api/source-documents/source_doc_1/range") {
        const body = JSON.parse(init.body || "{}");
        return jsonResponse({
          sheetName: body.sheetName,
          range: body.range,
          rows: [[
            { row: 0, col: 0, address: "A1", rawValue: "Label", formattedValue: "Label" },
            { row: 0, col: 1, address: "B1", rawValue: "Date", formattedValue: "Date" },
          ]],
          cells: [],
        });
      }
      return jsonResponse({});
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={{
            ...reviewState,
            sourceDocument: {
              id: "source_doc_1",
              metadata: {
                workbookName: "Master.xlsx",
                sheets: [{ name: "Sheet1", usedRange: "A1:J20", rowCount: 20, columnCount: 10 }],
              },
            },
          }}
          draftRegions={[]}
          onDraftRegionsChange={onDraftRegionsChange}
        />,
      );

      const startCell = await screen.findByLabelText("Cell A1");
      const grid = screen.getByRole("grid", { name: "Workbook sheet preview" });
      Object.defineProperty(grid, "clientWidth", { configurable: true, value: 240 });
      Object.defineProperty(grid, "clientHeight", { configurable: true, value: 120 });
      Object.defineProperty(grid, "scrollWidth", { configurable: true, value: 1200 });
      Object.defineProperty(grid, "scrollHeight", { configurable: true, value: 600 });
      grid.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 240,
        bottom: 120,
        width: 240,
        height: 120,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      fireEvent.mouseDown(startCell, { button: 0, clientX: 8, clientY: 8 });
      await act(async () => {});
      fireEvent.mouseMove(window, { clientX: 238, clientY: 118 });
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 120);
        });
      });
      fireEvent.mouseUp(window);

      await waitFor(() => expect(onDraftRegionsChange).toHaveBeenCalled());
      const nextRegions = onDraftRegionsChange.mock.calls.at(-1)[0];
      expect(nextRegions[0]).toMatchObject({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        selectionMethod: "drag_select",
      });
      expect(nextRegions[0].range).toMatch(/^A1:[B-J](?:[2-9]|1\d|20)$/);
      expect(grid.scrollLeft).toBeGreaterThan(0);
      expect(grid.scrollTop).toBeGreaterThan(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});


describe("ChartReviewModal", () => {
  it("shows one-chart prompt and proposal review only in the chart review modal", () => {
    render(
      <ChartReviewModal
        open
        chartData={[{ importId: "import_1", fileName: "runs.xlsx" }]}
        allowSourcePrompt
        chartProposalState={{}}
        chartInterpretState={{}}
        chartSpecs={[]}
        onChartProposalDecision={() => {}}
        onInterpretChart={() => {}}
        onCreateChartSpec={() => {}}
        onOpenImportReview={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Review chart proposals")).toBeTruthy();
    expect(screen.getByText("One-chart prompt")).toBeTruthy();
    expect(screen.getByText("Chart proposals")).toBeTruthy();
    expect(screen.queryByText("Propose charts")).toBeNull();
  });

  it("switches charts modal to Edit specs and forwards proposal delete", () => {
    const onChartProposalDelete = vi.fn();
    render(
      <ChartReviewModal
        open
        chartData={[{ importId: "import_1", fileName: "runs.xlsx" }]}
        allowSourcePrompt
        chartProposalState={{
          result: {
            proposalSet: {
              proposalSetId: "chart_set_1",
              serverId: "chart_set_1",
              proposals: [
                {
                  proposalId: "chart_pending",
                  status: "proposed",
                  chartType: "scatter",
                  title: "Pending chart",
                  x: { label: "Time", unit: "min" },
                  y: { label: "Conversion", unit: "%" },
                  confidence: 0.8,
                  warnings: [],
                },
                {
                  proposalId: "chart_rejected",
                  status: "rejected",
                  chartType: "bar",
                  title: "Rejected chart",
                  x: { label: "Experiment" },
                  y: { label: "Yield" },
                  confidence: 0.4,
                  warnings: [],
                },
              ],
              warnings: [],
            },
          },
        }}
        chartInterpretState={{}}
        chartSpecs={[]}
        onChartProposalDecision={() => {}}
        onChartProposalDelete={onChartProposalDelete}
        onInterpretChart={() => {}}
        onCreateChartSpec={() => {}}
        onOpenImportReview={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Edit specs" }));

    expect(screen.queryByText("One-chart prompt")).toBeNull();
    expect(screen.getByText("Pending chart")).toBeTruthy();
    expect(screen.queryByText("Rejected chart")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onChartProposalDelete).toHaveBeenCalledWith("chart_pending");
  });

  it("shows a project-first empty state when source chart review has no project", () => {
    const onOpenImportReview = vi.fn();
    const onClose = vi.fn();
    render(
      <ChartReviewModal
        open
        chartData={[]}
        onOpenImportReview={onOpenImportReview}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Select a server project first")).toBeTruthy();
    expect(screen.queryByText("One-chart prompt")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import workbook" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenImportReview).toHaveBeenCalledTimes(1);
  });

  it("allows server project chart prompts without normalized imports for source evidence", () => {
    const onInterpretChart = vi.fn();
    render(
      <ChartReviewModal
        open
        chartData={[]}
        allowSourcePrompt
        chartInterpretState={{}}
        chartProposalState={{}}
        chartSpecs={[]}
        onInterpretChart={onInterpretChart}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("Select a server project first")).toBeNull();
    expect(screen.getByText("One-chart prompt")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("e.g. plot carbon distribution from Sheet1!P31:BA32 in Calculation_Exp33.xlsx"), {
      target: { value: "draw carbon distribution from P31 to BA32" },
    });
    fireEvent.click(screen.getByText("Draft chart proposal"));

    expect(onInterpretChart).toHaveBeenCalledWith("draw carbon distribution from P31 to BA32");
  });
});


describe("AgentPanel", () => {
  const clearAgentChatHistoryStorage = () => {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (
        key === "labrat_blank_chat_history_v1_react"
        || key === "labrat_blank_chat_history_v2_local"
        || key?.startsWith("labrat_blank_chat_history_v2_project_")
      ) {
        localStorage.removeItem(key);
      }
    }
  };

  beforeEach(() => {
    clearAgentChatHistoryStorage();
  });

  afterEach(() => {
    clearAgentChatHistoryStorage();
  });

  it("does not expose browser provider credentials in LabRat settings", () => {
    render(
      <AgentPanel
        open
        setOpen={() => {}}
        blocks={[]}
        setBlocks={() => {}}
        references={[]}
        selected={null}
        selectedChartContext={null}
        pendingChartAnalysis={null}
        activeProjectId="project_1"
        projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
        onProjectStateLoaded={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.queryByText("Anthropic API key")).toBeNull();
    expect(screen.queryByText("Model")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("keeps chat history isolated per server project and ignores legacy global history", async () => {
    localStorage.setItem("labrat_blank_chat_history_v1_react", JSON.stringify([
      { role: "assistant", text: "Legacy shared answer" },
    ]));
    localStorage.setItem("labrat_blank_chat_history_v2_project_project_alpha", JSON.stringify([
      { role: "assistant", text: "Alpha project answer" },
    ]));
    localStorage.setItem("labrat_blank_chat_history_v2_project_project_beta", JSON.stringify([
      { role: "assistant", text: "Beta project answer" },
    ]));

    const panel = (projectId, name) => (
      <AgentPanel
        open
        setOpen={() => {}}
        blocks={[]}
        setBlocks={() => {}}
        references={[]}
        selected={null}
        selectedChartContext={null}
        pendingChartAnalysis={null}
        activeProjectId={projectId}
        projectState={{ project: { id: projectId, name }, fileObjects: [] }}
        onProjectStateLoaded={() => {}}
      />
    );

    try {
      const { rerender } = render(panel("project_alpha", "Alpha"));

      expect(screen.getByText("Alpha project answer")).toBeTruthy();
      expect(screen.queryByText("Beta project answer")).toBeNull();
      expect(screen.queryByText("Legacy shared answer")).toBeNull();

      rerender(panel("project_beta", "Beta"));
      await waitFor(() => expect(screen.getByText("Beta project answer")).toBeTruthy());
      expect(screen.queryByText("Alpha project answer")).toBeNull();
      expect(screen.queryByText("Legacy shared answer")).toBeNull();
    } finally {
      localStorage.removeItem("labrat_blank_chat_history_v1_react");
      localStorage.removeItem("labrat_blank_chat_history_v2_project_project_alpha");
      localStorage.removeItem("labrat_blank_chat_history_v2_project_project_beta");
    }
  });

  it("scrolls chat history to the bottom on first open and preserves user scroll after that", async () => {
    localStorage.setItem("labrat_blank_chat_history_v2_project_project_1", JSON.stringify([
      { role: "user", text: "Earlier question" },
      { role: "assistant", text: "Earlier answer" },
      { role: "user", text: "Follow-up question" },
      { role: "assistant", text: "Follow-up answer" },
    ]));
    const frameCallbacks = [];
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    };
    window.cancelAnimationFrame = () => {};
    const panel = (open) => (
      <AgentPanel
        open={open}
        setOpen={() => {}}
        blocks={[]}
        setBlocks={() => {}}
        references={[]}
        selected={null}
        selectedChartContext={null}
        pendingChartAnalysis={null}
        activeProjectId=""
        projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
        onProjectStateLoaded={() => {}}
      />
    );

    try {
      const { rerender } = render(panel(false));
      const messages = document.querySelector(".messages");
      Object.defineProperty(messages, "scrollHeight", { configurable: true, value: 1200 });
      Object.defineProperty(messages, "clientHeight", { configurable: true, value: 300 });

      rerender(panel(true));
      expect(frameCallbacks.length).toBe(1);
      frameCallbacks.shift()();
      expect(messages.scrollTop).toBe(900);

      messages.scrollTop = 240;
      fireEvent.scroll(messages);
      rerender(panel(false));
      rerender(panel(true));
      expect(frameCallbacks.length).toBe(1);
      frameCallbacks.shift()();
      expect(messages.scrollTop).toBe(240);

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: "Will this preserve my place?" } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(screen.getByText(/Select a server project before asking LabRat/)).toBeTruthy());
      expect(messages.scrollTop).toBe(240);

      fireEvent.click(screen.getByRole("button", { name: "Reset chat" }));
      expect(messages.scrollTop).toBe(0);
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
      localStorage.removeItem("labrat_blank_chat_history_v2_project_project_1");
    }
  });

  it("creates server-backed AgentRuns and renders a confirmable action card", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agentRun: {
          id: "agent_run_1",
          schemaVersion: "labrat.agentRun.v1",
          status: "waiting_for_user",
          mode: "action_plan",
          visibleSteps: [{ stepId: "step_1", label: "Created compatibility action plan", details: { actionCount: 1 } }],
          actions: [{
            actionId: "agent_action_1",
            type: "upload_workbook_for_review",
            status: "requires_confirmation",
            label: "Upload workbook for review",
            description: "Choose a workbook and review detected source regions before data or charting.",
            requiresFile: true,
            requiresReview: true,
            params: { targetExperimentAliases: ["Exp30"] },
            warnings: [],
          }],
          warnings: [],
        },
      }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      render(
        <AgentPanel
          open
          setOpen={() => {}}
          blocks={[]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
          onProjectStateLoaded={() => {}}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, {
        target: { value: "upload workbook for Exp30" },
      });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(screen.getByText("Upload workbook for review")).toBeTruthy());
      expect(screen.getByText("Created compatibility action plan")).toBeTruthy();
      expect(screen.getByText("Target: Exp30")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Choose file" })).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/project_1/agent/runs", expect.objectContaining({ method: "POST" }));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("renders a direct project summary response without a confirmation card", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reply: "Project Catalyst Screening has 2 published experiments and 1 source document.",
        agentRun: {
          id: "agent_run_summary_1",
          schemaVersion: "labrat.agentRun.v1",
          status: "completed",
          mode: "project_summary",
          visibleSteps: [{ stepId: "step_summary", label: "Summarized project state", details: {} }],
          actions: [],
          warnings: [],
        },
      }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      render(
        <AgentPanel
          open
          setOpen={() => {}}
          blocks={[]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" } }}
          onProjectStateLoaded={() => {}}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: "这个项目目前有哪些内容？" } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      expect(await screen.findByText("Project Catalyst Screening has 2 published experiments and 1 source document.")).toBeTruthy();
      expect(screen.queryByText("Open Experiment Browser")).toBeNull();
      expect(screen.queryByRole("button", { name: "Confirm agent action" })).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("attaches spreadsheet files from the plus button and uploads only after sending the chat message", async () => {
    localStorage.removeItem("labrat_blank_chat_history_v1_react");
    const onWorkbookReviewReady = vi.fn();
    const onWorkbookSuggestionSelect = vi.fn();
    const onProjectStateLoaded = vi.fn();
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/files") {
        expect(init.method).toBe("POST");
        expect(init.body instanceof FormData).toBe(true);
        return jsonResponse({ fileObject: { id: "file_1", originalName: "Master.xlsx" } }, { status: 201 });
      }
      if (url === "/api/projects/project_1/workbook-review-sessions") {
        expect(JSON.parse(init.body)).toMatchObject({ fileObjectId: "file_1" });
        return jsonResponse({
          workbookReviewSession: {
            id: "session_1",
            status: "needs_user_review",
            workbookSummary: { workbookName: "Master.xlsx", sheetCount: 1, regionCount: 1, nonEmptyCellCount: 12 },
            currentUnderstanding: {},
            messages: [{ id: "msg_1", role: "assistant", content: "I indexed Master.xlsx." }],
          },
          sourceDocument: {
            id: "source_doc_1",
            metadata: { workbookName: "Master.xlsx", sheets: [{ name: "Sheet1", usedRange: "A1:D5" }] },
            summary: { sheetCount: 1, regionCount: 1, nonEmptyCellCount: 12 },
          },
          regions: [{
            id: "source_region_1",
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            rangeRef: "A1:Y10",
            label: "Label, Date, Catalyst Type",
            kind: "standard_table",
            confidence: 0.87,
          }],
        }, { status: 201 });
      }
      if (url === "/api/projects/project_1/state") {
        return jsonResponse({ project: { id: "project_1" }, sourceDocuments: [], workbookReviewSessions: [] });
      }
      return jsonResponse({});
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const { container } = render(
        <AgentPanel
          open
          setOpen={() => {}}
          blocks={[]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
          onProjectStateLoaded={onProjectStateLoaded}
          onWorkbookReviewReady={onWorkbookReviewReady}
          onWorkbookSuggestionSelect={onWorkbookSuggestionSelect}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Attach spreadsheet" }));
      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(["placeholder"], "Master.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(screen.getByText("Master.xlsx")).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: "Please help me understand this workbook" } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(onWorkbookReviewReady).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/project_1/files", expect.objectContaining({ method: "POST" }));
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/project_1/workbook-review-sessions", expect.objectContaining({ method: "POST" }));
      expect(screen.getByText(/I found potentially useful regions/)).toBeTruthy();

      const suggestion = screen.getByRole("button", { name: "Select Sheet1!A1:Y10" });
      fireEvent.click(suggestion);
      expect(onWorkbookSuggestionSelect).toHaveBeenCalledWith(expect.objectContaining({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        range: "A1:Y10",
      }));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("keeps workbook review controls out of the global Agent composer", () => {
    localStorage.removeItem("labrat_blank_chat_history_v1_react");

    render(
      <AgentPanel
        open
        setOpen={() => {}}
        blocks={[]}
        setBlocks={() => {}}
        references={[]}
        selected={null}
        selectedChartContext={null}
        pendingChartAnalysis={null}
        activeProjectId="project_1"
        projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
        onProjectStateLoaded={() => {}}
        workbookReviewContext={{
          active: true,
          session: { id: "session_1", status: "needs_user_review" },
          workbookName: "Master.xlsx",
          currentUnderstanding: {
            id: "understanding_draft_1",
            facts: [{ factId: "fact_1", kind: "region_description" }],
          },
          pendingRedBoxes: [],
        }}
      />,
    );

    expect(screen.queryByLabelText("Workbook review response")).toBeNull();
    expect(screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...")).toBeTruthy();
  });

  it("keeps server-backed interpret chart actions executable when they require confirmation", async () => {
    localStorage.removeItem("labrat_blank_chat_history_v1_react");
    const onProjectStateLoaded = vi.fn();
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/agent/runs") {
        return jsonResponse({
          agentRun: {
            id: "agent_run_chart_1",
            schemaVersion: "labrat.agentRun.v1",
            status: "waiting_for_user",
            mode: "action_plan",
            visibleSteps: [{ stepId: "step_chart", label: "Created compatibility action plan", details: { actionCount: 1 } }],
            actions: [{
              actionId: "agent_chart_1",
              type: "interpret_chart",
              status: "requires_confirmation",
              label: "Draft one chart proposal",
              description: "Interpret the request into a source-backed ChartSpec draft, then queue it for review if confirmed.",
              params: {
                prompt: "i want a cross-compare chart for every experiment, x axis is reaction time, y axis is reaction rate",
              },
              warnings: [],
            }],
            warnings: [],
          },
        }, { status: 201 });
      }
      if (url === "/api/projects/project_1/charts/interpret") {
        expect(JSON.parse(init.body)).toMatchObject({
          prompt: "i want a cross-compare chart for every experiment, x axis is reaction time, y axis is reaction rate",
          persistAsProposal: true,
          entrypoint: "agent_drawer",
          context: { actionId: "agent_chart_1" },
        });
        return jsonResponse({
          schemaVersion: "labrat.chartInterpretResponse.v1",
          chartSpecDraft: { title: "Reaction Rate vs Reaction Time for All Experiments", chartType: "scatter" },
          chartProposalSet: {
            id: "chart_set_cross_compare",
            payload: {
              proposalSetId: "proposal_set_cross_compare",
              schemaVersion: "labrat.chartProposalSet.v1",
              proposals: [{
                proposalId: "proposal_cross_compare",
                status: "proposed",
                title: "Reaction Rate vs Reaction Time for All Experiments",
              }],
              warnings: [],
            },
          },
          warnings: [],
        });
      }
      if (url === "/api/projects/project_1/state") {
        return jsonResponse({
          project: { id: "project_1", name: "Catalyst Screening" },
          projectProfile: {},
          chartProposalSets: [],
          chartSpecs: [],
          manuscripts: [],
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      render(
        <AgentPanel
          open
          setOpen={() => {}}
          blocks={[]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
          onProjectStateLoaded={onProjectStateLoaded}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, {
        target: { value: "i want a cross-compare chart for every experiment, x axis is reaction time, y axis is reaction rate" },
      });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(screen.getByText("Draft one chart proposal")).toBeTruthy());
      expect(screen.getByText("requires_confirmation")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Confirm agent action" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Prepare" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Accept proposal" })).toBeTruthy());
      expect(screen.getByText("Chart: Reaction Rate vs Reaction Time for All Experiments")).toBeTruthy();
      expect(screen.getByText(/Queued chart proposal set chart_set_cross_compare/)).toBeTruthy();
      expect(onProjectStateLoaded).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
      localStorage.removeItem("labrat_blank_chat_history_v1_react");
    }
  });

  it("renders completed AgentRun source extract actions as reviewable instead of preparing again", async () => {
    localStorage.removeItem("labrat_blank_chat_history_v1_react");
    const onReviewSourceExtract = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      agentRun: {
        id: "agent_run_source_1",
        schemaVersion: "labrat.agentRun.v1",
        status: "completed",
        mode: "source_extract",
        visibleSteps: [
          { stepId: "step_parse", label: "Parsed source evidence" },
          { stepId: "step_resolve", label: "Resolved source evidence" },
          { stepId: "step_validate", label: "Validated source extract preview" },
        ],
        actions: [{
          actionId: "agent_source_1",
          type: "create_source_extract_proposal",
          status: "completed",
          label: "Create source extract proposal",
          description: "Create a reviewable source extract proposal from the matched source evidence.",
          params: { prompt: "draw carbon balance distribution from P31 to BA32" },
          result: {
            sourceExtractProposal: {
              id: "source_extract_33",
              status: "proposed",
              extractType: "component_distribution",
              preview: {
                chartIntentDraft: { title: "Exp33 carbon number distribution" },
                rows: [],
              },
              warnings: [],
            },
          },
        }],
        warnings: [],
      },
    }, { status: 201 }));
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      render(
        <AgentPanel
          open
          setOpen={() => {}}
          blocks={[]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
          onProjectStateLoaded={() => {}}
          onReviewSourceExtract={onReviewSourceExtract}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, {
        target: { value: "draw carbon balance distribution from P31 to BA32" },
      });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(screen.getByText("Create source extract proposal")).toBeTruthy());
      expect(screen.getByText(/Created source extract proposal source_extract_33/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Prepare" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Confirm agent action" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Review source extract" }));
      expect(onReviewSourceExtract).toHaveBeenCalledWith(expect.objectContaining({
        id: "source_extract_33",
        status: "proposed",
        extractType: "component_distribution",
      }));
    } finally {
      global.fetch = originalFetch;
      localStorage.removeItem("labrat_blank_chat_history_v1_react");
    }
  });

  it("recovers a stale source extract AgentRun card when the run is already completed", async () => {
    localStorage.setItem("labrat_blank_chat_history_v2_project_project_1", JSON.stringify([
      {
        role: "assistant",
        text: "I prepared an AgentRun action. Review the trace and confirm before anything changes.",
        actions: [{
          actionId: "agent_source_1",
          agentRunId: "agent_run_source_1",
          type: "create_source_extract_proposal",
          status: "failed",
          label: "Create source extract proposal",
          description: "Create a reviewable source extract proposal from the matched source evidence.",
          params: { prompt: "draw carbon balance distribution from P31 to BA32" },
          error: "AgentRun is already completed.",
          warnings: [],
        }],
      },
    ]));
    const onProjectStateLoaded = vi.fn();
    const onReviewSourceExtract = vi.fn();
    const fetchMock = vi.fn(async (url) => {
      if (url === "/api/agent-runs/agent_run_source_1/confirm") {
        return jsonResponse({
          error: {
            code: "agent_run_closed",
            message: "AgentRun is already completed.",
          },
        }, { status: 409 });
      }
      if (url === "/api/agent-runs/agent_run_source_1") {
        return jsonResponse({
          agentRun: {
            id: "agent_run_source_1",
            schemaVersion: "labrat.agentRun.v1",
            status: "completed",
            mode: "source_extract",
            visibleSteps: [
              { stepId: "step_created", label: "Created source extract proposal" },
            ],
            proposalRefs: [{ type: "source_extract_proposal", id: "source_extract_33" }],
            actions: [{
              actionId: "agent_source_1",
              type: "create_source_extract_proposal",
              status: "completed",
              label: "Create source extract proposal",
              description: "Create a reviewable source extract proposal from the matched source evidence.",
              params: { prompt: "draw carbon balance distribution from P31 to BA32" },
              result: { sourceExtractProposalId: "source_extract_33" },
              warnings: [],
            }],
            warnings: [],
          },
        });
      }
      if (url === "/api/projects/project_1/state") {
        return jsonResponse({
          project: { id: "project_1", name: "Catalyst Screening" },
          projectProfile: {},
          chartProposalSets: [],
          chartSpecs: [],
          manuscripts: [],
          sourceExtractProposals: [{
            id: "source_extract_33",
            status: "proposed",
            extractType: "component_distribution",
          }],
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      render(
        <AgentPanel
          open
          setOpen={() => {}}
          blocks={[]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
          onProjectStateLoaded={onProjectStateLoaded}
          onReviewSourceExtract={onReviewSourceExtract}
        />,
      );

      expect(screen.queryByRole("button", { name: "Prepare" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Refresh result" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Review source extract" })).toBeTruthy());
      expect(screen.getByText(/Created source extract proposal source_extract_33/)).toBeTruthy();
      expect(screen.queryByText("AgentRun is already completed.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Prepare" })).toBeNull();
      expect(onProjectStateLoaded).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Review source extract" }));
      expect(onReviewSourceExtract).toHaveBeenCalledWith(expect.objectContaining({
        id: "source_extract_33",
        status: "proposed",
      }));
    } finally {
      global.fetch = originalFetch;
      localStorage.removeItem("labrat_blank_chat_history_v2_project_project_1");
    }
  });

  it("treats interpreted source extract proposals as completed chat actions", async () => {
    localStorage.removeItem("labrat_blank_chat_history_v1_react");
    const onProjectStateLoaded = vi.fn();
    const onReviewSourceExtract = vi.fn();
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/agent/plan") {
        return jsonResponse({
          schemaVersion: "labrat.agentPlan.v1",
          reply: "I prepared a source-backed chart action.",
          actions: [{
            actionId: "agent_source_chart_1",
            type: "interpret_chart",
            status: "proposed",
            label: "Draft one chart proposal",
            description: "Interpret the request into a source-backed ChartSpec draft.",
            requiresFile: false,
            params: { prompt: "draw carbon balance distribution of experiment 33 from P31 to BA32" },
            warnings: [],
          }],
        });
      }
      if (url === "/api/projects/project_1/charts/interpret") {
        expect(JSON.parse(init.body)).toMatchObject({
          prompt: "draw carbon balance distribution of experiment 33 from P31 to BA32",
          persistAsProposal: true,
          entrypoint: "agent_drawer",
          context: { actionId: "agent_source_chart_1" },
        });
        return jsonResponse({
          schemaVersion: "labrat.chartInterpretResponse.v1",
          chartSpecDraft: null,
          chartProposalSet: null,
          evidenceIntent: { sourceKind: "excel_range", range: "P31:BA32", extractType: "component_distribution" },
          evidenceResolution: { status: "resolved", range: "P31:BA32" },
          sourceExtractProposal: {
            id: "source_extract_33",
            status: "proposed",
            extractType: "component_distribution",
            preview: {
              chartIntentDraft: { title: "Exp33 carbon number distribution" },
              rows: [],
            },
            warnings: [],
          },
          warnings: [],
        });
      }
      if (url === "/api/projects/project_1/state") {
        return jsonResponse({
          project: { id: "project_1", name: "Catalyst Screening" },
          projectProfile: {},
          chartProposalSets: [],
          chartSpecs: [],
          manuscripts: [],
          sourceExtractProposals: [{ id: "source_extract_33", status: "proposed" }],
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      render(
        <AgentPanel
          open
          setOpen={() => {}}
          blocks={[]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
          onProjectStateLoaded={onProjectStateLoaded}
          onInsertChartSpec={() => {}}
          onReviewSourceExtract={onReviewSourceExtract}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, {
        target: { value: "draw carbon balance distribution of experiment 33 from P31 to BA32" },
      });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(screen.getByText("Draft one chart proposal")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Prepare" }));

      await waitFor(() => expect(screen.getByText(/Created source extract proposal source_extract_33/)).toBeTruthy());
      expect(screen.getByText("completed")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Accept proposal" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Review source extract" }));
      expect(onReviewSourceExtract).toHaveBeenCalledWith(expect.objectContaining({
        id: "source_extract_33",
        status: "proposed",
        extractType: "component_distribution",
      }));
      expect(onProjectStateLoaded).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
      localStorage.removeItem("labrat_blank_chat_history_v1_react");
    }
  });
});

describe("NewProjectModal", () => {
  it("submits a project name and description", () => {
    const onCreate = vi.fn();
    render(<NewProjectModal open loading={false} error="" onCreate={onCreate} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "CO2 Reduction" },
    });
    fireEvent.change(screen.getByLabelText("Short description"), {
      target: { value: "Screen electrolyte conditions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "CO2 Reduction",
      description: "Screen electrolyte conditions",
    });
  });
});
