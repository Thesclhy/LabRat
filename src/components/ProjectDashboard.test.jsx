import React, { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel, ChartReviewModal, DeleteProjectModal, NewProjectModal, ProjectDashboard, ProjectOverview, Topbar, WorkbookReviewWorkspace, activeChartSpecsForProject, latestItem, mergeProjectStateForWorkspaceRefresh } from "../main.jsx";
import { AnalysisReviewWorkspace } from "./AnalysisReviewWorkspace.jsx";
import { ManuscriptCanvas } from "./ManuscriptCanvas.jsx";

vi.mock("../charts/Plot.jsx", () => ({
  Plot: () => <div data-testid="plotly-placeholder" />,
}));

vi.mock("../export/pptxExport.js", () => ({
  exportManuscriptPagesToPptx: vi.fn(),
}));

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
  chartSpecs: [{
    id: "chart_spec_1",
    title: "Gas vs Temperature",
    origin: "analysis_result",
    spec: {
      origin: "analysis_result",
      traceCatalog: [{ traceId: "gas", x: [250], y: [0.35] }],
      defaultChartView: { visibleTraceIds: ["gas"] },
    },
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
  it("keeps the Open action inside a fluid desktop project grid", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const dashboardRule = css.match(/\.project-dashboard\s*\{([^}]*)\}/)?.[1] || "";
    const tableRule = css.match(/\.project-table\s*\{([^}]*)\}/)?.[1] || "";
    const rowRule = css.match(/\.project-table-row\s*\{([^}]*)\}/)?.[1] || "";
    const cellRule = css.match(/\.project-table-row\s*>\s*span\s*\{([^}]*)\}/)?.[1] || "";

    expect(dashboardRule).toMatch(/grid-template-columns:\s*clamp\([^;]+\) minmax\(0, 1fr\) clamp\(/);
    expect(tableRule).toMatch(/min-width:\s*0/);
    expect(rowRule).toMatch(/minmax\(58px, auto\)/);
    expect(cellRule).toMatch(/min-width:\s*0/);
  });

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

  it("uses server workflow summaries before a project is opened", () => {
    render(
      <ProjectDashboard
        user={{ username: "labuser" }}
        labs={[{ id: "lab_1", name: "Lab A", role: "editor" }]}
        activeLabId="lab_1"
        onLabChange={() => {}}
        projects={[{
          ...project,
          workflowSummary: { publishedExperimentCount: 63, chartSpecCount: 1 },
        }]}
        selectedProjectId="project_1"
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

    expect(screen.getByText("63 experiments")).toBeTruthy();
    expect(screen.getByText("1 specs")).toBeTruthy();
    expect(screen.queryByText("No published data")).toBeNull();
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
      sourceDocuments: [{ id: "source_doc_1", fileName: "Pending.xlsx" }],
      workbookReviewSessions: [{ id: "session_1", sourceDocumentId: "source_doc_1" }],
      workbookReviewRegions: [{
        id: "region_1",
        workbookReviewSessionId: "session_1",
        disposition: "active",
        reviewStatus: "awaiting_review",
      }],
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
    expect(screen.getAllByText("Create and review charts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Manage approved charts").length).toBeGreaterThan(0);
    expect(screen.getByText("Manuscript")).toBeTruthy();
    expect(screen.queryByText("Master Dataset")).toBeNull();
    expect(screen.queryByText("Supplemental Workbooks")).toBeNull();
    expect(screen.queryByText("Semantic mappings")).toBeNull();
    expect(screen.getByText("1 uploaded workbook")).toBeTruthy();
    expect(screen.getByText(/1 region needs review/)).toBeTruthy();
    expect(screen.getByText("1 specs")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Ask LabRat" }));
    fireEvent.click(screen.getByRole("button", { name: "Review regions" }));
    const workbookDialog = screen.getByRole("dialog", { name: "Uploaded workbooks" });
    expect(within(workbookDialog).getByRole("button", { name: "Open Pending.xlsx" })).toBeTruthy();
    expect(onUploadWorkbook).not.toHaveBeenCalled();
    fireEvent.click(within(workbookDialog).getByRole("button", { name: "Open Pending.xlsx" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Experiment Browser" }));
    fireEvent.click(screen.getByRole("button", { name: "Create chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage approved charts" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert approved charts" }));

    expect(onAskLabRat).toHaveBeenCalledTimes(1);
    expect(onUploadWorkbook).toHaveBeenCalledTimes(1);
    expect(onGoBrowser).toHaveBeenCalledTimes(1);
    expect(onOpenChartReview).toHaveBeenCalledTimes(2);
    expect(onOpenChartReview).toHaveBeenLastCalledWith({ statusFilter: "active" });
    expect(onGoManuscript).toHaveBeenCalledTimes(1);
  });

  it("lists every uploaded workbook before opening confirmed regions", () => {
    const onUploadWorkbook = vi.fn();
    const onDeleteWorkbook = vi.fn().mockResolvedValue({});
    const onGoBrowser = vi.fn();
    const firstSession = {
      id: "session_1",
      sourceDocumentId: "source_doc_1",
      status: "needs_user_review",
      workbookSummary: { workbookName: "Reaction_Rate_Exp45.xlsx", sheetCount: 3 },
      updatedAt: "2026-07-21T12:00:00.000Z",
    };
    const secondSession = {
      id: "session_2",
      sourceDocumentId: "source_doc_2",
      status: "needs_user_review",
      workbookSummary: { workbookName: "MasterTable_updated.xlsx", sheetCount: 1 },
      updatedAt: "2026-07-22T12:00:00.000Z",
    };
    render(
      <ProjectOverview
        projectState={{
          ...projectState,
          sourceDocuments: [{ id: "source_doc_1" }, { id: "source_doc_2" }],
          workbookReviewSessions: [firstSession, secondSession],
          workbookReviewRegions: [
            {
              id: "region_1",
              workbookReviewSessionId: "session_1",
              disposition: "active",
              reviewStatus: "accepted",
            },
            {
              id: "region_2",
              workbookReviewSessionId: "session_2",
              disposition: "active",
              reviewStatus: "accepted",
            },
          ],
        }}
        onAskLabRat={() => {}}
        onOpenProfile={() => {}}
        onUploadWorkbook={onUploadWorkbook}
        onDeleteWorkbook={onDeleteWorkbook}
        onGoBrowser={onGoBrowser}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText(/2 confirmed regions/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review regions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View confirmed regions" }));
    const dialog = screen.getByRole("dialog", { name: "Uploaded workbooks" });
    expect(within(dialog).getByRole("button", { name: "Open Reaction_Rate_Exp45.xlsx" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Open MasterTable_updated.xlsx" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Delete Reaction_Rate_Exp45.xlsx" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Delete MasterTable_updated.xlsx" })).toBeTruthy();
    expect(within(dialog).getAllByText("1 confirmed")).toHaveLength(2);
    expect(onUploadWorkbook).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Open Reaction_Rate_Exp45.xlsx" }));
    expect(onUploadWorkbook).toHaveBeenCalledWith(firstSession);
    expect(screen.queryByRole("dialog", { name: "Uploaded workbooks" })).toBeNull();
  });

  it("confirms workbook deletion without opening the workbook", async () => {
    const onUploadWorkbook = vi.fn();
    const onDeleteWorkbook = vi.fn().mockResolvedValue({});
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const session = {
      id: "session_delete",
      sourceDocumentId: "source_doc_delete",
      version: 2,
      status: "needs_user_review",
      workbookSummary: { workbookName: "DeleteMe.xlsx", sheetCount: 2 },
    };
    render(
      <ProjectOverview
        projectState={{
          ...projectState,
          sourceDocuments: [{ id: "source_doc_delete" }],
          workbookReviewSessions: [session],
          workbookReviewRegions: [{
            id: "region_delete",
            workbookReviewSessionId: session.id,
            disposition: "active",
            reviewStatus: "awaiting_review",
          }],
        }}
        onAskLabRat={() => {}}
        onOpenProfile={() => {}}
        onUploadWorkbook={onUploadWorkbook}
        onDeleteWorkbook={onDeleteWorkbook}
        onGoBrowser={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review regions" }));
    const dialog = screen.getByRole("dialog", { name: "Uploaded workbooks" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete DeleteMe.xlsx" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Delete DeleteMe.xlsx"));
    await waitFor(() => expect(onDeleteWorkbook).toHaveBeenCalledWith(session));
    expect(onUploadWorkbook).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Uploaded workbooks" })).toBeTruthy();
    confirm.mockRestore();
  });

  it("lists workbooks before opening a session with regions awaiting review", () => {
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
          sourceDocuments: [
            { id: "source_doc_1", fileName: "Pending.xlsx" },
            { id: "source_doc_2", fileName: "Confirmed.xlsx" },
          ],
          workbookReviewSessions: [
            { ...pendingSession, sourceDocumentId: "source_doc_1" },
            {
              id: "session_confirmed",
              sourceDocumentId: "source_doc_2",
              status: "needs_user_review",
              updatedAt: "2026-07-19T12:00:00.000Z",
            },
          ],
          workbookReviewRegions: [
            {
              id: "region_pending",
              workbookReviewSessionId: "session_pending",
              disposition: "active",
              reviewStatus: "awaiting_review",
              updatedAt: "2026-07-20T12:00:00.000Z",
            },
            {
              id: "region_confirmed",
              workbookReviewSessionId: "session_confirmed",
              disposition: "active",
              reviewStatus: "accepted",
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

    fireEvent.click(screen.getByRole("button", { name: "Review regions" }));
    const dialog = screen.getByRole("dialog", { name: "Uploaded workbooks" });
    expect(within(dialog).getByRole("button", { name: "Open Pending.xlsx" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Open Confirmed.xlsx" })).toBeTruthy();
    expect(onUploadWorkbook).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Open Pending.xlsx" }));
    expect(onUploadWorkbook).toHaveBeenCalledWith(expect.objectContaining({ id: "session_pending" }));
  });

  it("ignores stale chart specs in overview counts and active chart choices", () => {
    const stateWithStaleSpec = {
      ...projectState,
      chartSpecs: [
        { id: "chart_spec_active", title: "Current Gas", origin: "analysis_result", spec: { origin: "analysis_result", traceCatalog: [] }, status: "active", isStale: false },
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

    expect(screen.getByText("1 specs")).toBeTruthy();
    expect(screen.getByText(/older specs are hidden/)).toBeTruthy();
    expect(activeChartSpecsForProject(stateWithStaleSpec).map((chartSpec) => chartSpec.id)).toEqual(["chart_spec_active"]);
  });

  it("keeps accepted analysis-result ChartSpecs in active chart choices", () => {
    const analysisChart = {
      id: "chart_spec_analysis",
      spec: {
        schemaVersion: "labrat.chartSpec.v2",
        origin: "analysis_result",
        status: "accepted",
        traceCatalog: [{ traceId: "trace_1", pointCount: 2 }],
      },
    };

    expect(activeChartSpecsForProject({
      ...projectState,
      chartSpecs: [analysisChart],
    })).toEqual([analysisChart]);
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

  function workbookColumnIndex(label) {
    return [...label].reduce(
      (value, char) => value * 26 + char.charCodeAt(0) - 64,
      0,
    ) - 1;
  }

  function markerForWorkbookRange(sheetName, range) {
    const [, startCol, startRow] = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    return {
      row: Number(startRow) - 1,
      col: workbookColumnIndex(startCol),
      address: `${startCol}${startRow}`,
      rawValue: `${sheetName} ${range}`,
      formattedValue: `${sheetName} ${range}`,
    };
  }

  function workbookRangeRequests(fetchMock, sheetName = "") {
    return fetchMock.mock.calls
      .filter(([url]) => url === "/api/source-documents/source_doc_1/range")
      .map(([, init]) => JSON.parse(init.body || "{}"))
      .filter((body) => !sheetName || body.sheetName === sheetName);
  }

  function workbookRangeCellCount(range) {
    const [, startCol, startRow, endCol, endRow] = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    return (Number(endRow) - Number(startRow) + 1)
      * (workbookColumnIndex(endCol) - workbookColumnIndex(startCol) + 1);
  }

  function makeHydrationFetch({
    sheets = [{
      name: "Sheet1",
      usedRange: "A1:X81",
      rowCount: 81,
      columnCount: 24,
    }],
    failOnceKey = "",
    emptyKeys = [],
    deferred = new Map(),
  } = {}) {
    const attempts = new Map();
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/source-documents") {
        return jsonResponse({
          sourceDocuments: [{
            id: "source_doc_1",
            metadata: { workbookName: "Large.xlsx", sheets },
          }],
        });
      }
      if (url === "/api/source-documents/source_doc_1/range") {
        const body = JSON.parse(init.body || "{}");
        const key = `${body.sheetName}!${body.range}`;
        attempts.set(key, (attempts.get(key) || 0) + 1);
        if (key === failOnceKey && attempts.get(key) === 1) {
          throw new Error(`Failed ${key}`);
        }
        if (deferred.has(key)) return deferred.get(key);
        return jsonResponse({
          sheetName: body.sheetName,
          range: body.range,
          rows: emptyKeys.includes(key)
            ? []
            : [[markerForWorkbookRange(body.sheetName, body.range)]],
          cells: [],
        });
      }
      return jsonResponse({});
    });
    return { fetchMock, attempts };
  }

  function largeReviewState(sheets) {
    return {
      ...reviewState,
      sourceDocument: {
        id: "source_doc_1",
        metadata: { workbookName: "Large.xlsx", sheets },
      },
    };
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

      expect(await screen.findByText("Label", {}, { timeout: 10_000 })).toBeTruthy();
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

  it("renders reviewed analysis inputs as red source cells without changing workbook draft styling", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[{
            draftRegionId: "analysis_rect_1",
            clientRegionId: "analysis_rect_1",
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "A1:B1",
            status: "reviewed_input",
          }]}
          activeDraftRegionId="analysis_rect_1"
          onDraftRegionsChange={() => {}}
        />,
      );

      const cell = await screen.findByLabelText("Cell A1");
      await waitFor(() => {
        expect(cell.closest(".rdg-cell")?.classList.contains("is-analysis-input")).toBe(true);
        expect(cell.closest(".rdg-cell")?.classList.contains("is-draft")).toBe(false);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("renders blue cells only for the active server region id", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const draftRegions = [{
      clientRegionId: "draft_1",
      draftRegionId: "draft_1",
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      range: "A1:B1",
      status: "draft",
    }, {
      clientRegionId: "draft_2",
      draftRegionId: "draft_2",
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      range: "C1:D1",
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

      const firstCell = await screen.findByLabelText("Cell A1");
      const secondCell = await screen.findByLabelText("Cell C1");
      await waitFor(() => {
        expect(firstCell.closest(".rdg-cell")?.classList.contains("is-draft")).toBe(true);
      });
      expect(secondCell.closest(".rdg-cell")?.classList.contains("is-draft")).toBe(false);

      rerender(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={draftRegions}
          activeDraftRegionId="draft_2"
          onDraftRegionsChange={() => {}}
        />,
      );

      await waitFor(() => {
        expect(firstCell.closest(".rdg-cell")?.classList.contains("is-draft")).toBe(false);
        expect(secondCell.closest(".rdg-cell")?.classList.contains("is-draft")).toBe(true);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("opens the sheet that contains the initially active server region", async () => {
    const sheets = [{
      name: "First",
      usedRange: "A1:B2",
      rowCount: 2,
      columnCount: 2,
    }, {
      name: "Second",
      usedRange: "A1:B2",
      rowCount: 2,
      columnCount: 2,
    }];
    const { fetchMock } = makeHydrationFetch({ sheets });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={largeReviewState(sheets)}
          draftRegions={[{
            id: "region_second",
            sourceDocumentId: "source_doc_1",
            sheetName: "Second",
            rangeRef: "A1:B2",
            disposition: "active",
          }]}
          activeDraftRegionId="region_second"
          onDraftRegionsChange={() => {}}
        />,
      );

      expect(await screen.findByText("Second A1:B2")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Second" }).classList.contains("active")).toBe(true);
      await waitFor(() => {
        expect(screen.getByLabelText("Cell A1").closest(".rdg-cell")?.classList.contains("is-draft")).toBe(true);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("focuses an existing region without mutating the region list", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    const draftRegions = [{
      clientRegionId: "draft_1",
      draftRegionId: "draft_1",
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      range: "A1:B1",
      status: "draft",
    }, {
      clientRegionId: "draft_2",
      draftRegionId: "draft_2",
      sourceDocumentId: "source_doc_1",
      sheetName: "Sheet1",
      range: "C1:D1",
      status: "draft",
    }];
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={draftRegions}
          activeDraftRegionId="draft_2"
          onDraftRegionsChange={onDraftRegionsChange}
          focusSelection={{
            ...draftRegions[1],
            requestId: "focus_draft_2",
            selectionMethod: "red_box_click",
          }}
        />,
      );

      await screen.findByLabelText("Cell A1");
      expect(onDraftRegionsChange).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("turns a clicked workbook suggestion into a server region request", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onCreateRegion = vi.fn();
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onCreateRegion={onCreateRegion}
          focusSelection={{
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "A1:B2",
            selectionMethod: "suggestion_click",
            description: "Detected experiment table",
          }}
        />,
      );

      await waitFor(() => expect(onCreateRegion).toHaveBeenCalledWith({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        range: "A1:B2",
        selectionMethod: "suggestion_click",
      }));
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
      await screen.findByText("Label", {}, { timeout: 10_000 });
      const rangeInput = screen.getByLabelText("Sheet range");
      expect(rangeInput.value).toBe("A1:D5");
      expect(rangeInput.readOnly).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Update dock" }));

      expect(screen.getByText("Dock revision 1")).toBeTruthy();
      expect(screen.getByRole("grid", { name: "Workbook sheet preview" })).toBe(grid);
      expect(screen.getByLabelText("Sheet range").value).toBe("A1:D5");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("focuses an active red box without narrowing the sheet used range", async () => {
    const sheets = [{
      name: "Sheet1",
      usedRange: "A1:X81",
      rowCount: 81,
      columnCount: 24,
    }];
    const { fetchMock } = makeHydrationFetch({ sheets });
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
      range: "M41:N42",
      status: "draft",
    }];
    try {
      const { rerender } = render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={largeReviewState(sheets)}
          draftRegions={draftRegions}
          activeDraftRegionId="draft_1"
          onDraftRegionsChange={() => {}}
        />,
      );

      await screen.findByText("Sheet1 A1:L40");
      const grid = screen.getByRole("grid", { name: "Workbook sheet preview" });
      Object.defineProperty(grid, "scrollTop", { configurable: true, writable: true, value: 0 });
      Object.defineProperty(grid, "scrollLeft", { configurable: true, writable: true, value: 0 });

      rerender(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={largeReviewState(sheets)}
          draftRegions={draftRegions}
          activeDraftRegionId="draft_2"
          onDraftRegionsChange={() => {}}
          focusSelection={{
            requestId: "focus_draft_2",
            clientRegionId: "draft_2",
            draftRegionId: "draft_2",
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "M41:N42",
            selectionMethod: "red_box_click",
          }}
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText("Sheet range").value).toBe("A1:X81");
        expect(grid.scrollTop).toBeGreaterThan(0);
        expect(grid.scrollLeft).toBeGreaterThan(0);
      });
    } finally {
      global.fetch = originalFetch;
    }
  }, 30_000);

  it("requests a server region by dragging from one workbook cell to another", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onCreateRegion = vi.fn();
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onCreateRegion={onCreateRegion}
        />,
      );

      const startCell = await screen.findByLabelText("Cell A1");
      const endCell = await screen.findByLabelText("Cell B1");
      fireEvent.mouseDown(startCell, { button: 0 });
      fireEvent.mouseEnter(endCell);
      fireEvent.mouseUp(endCell);

      await waitFor(() => expect(onCreateRegion).toHaveBeenCalledWith({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        range: "A1:B1",
        selectionMethod: "drag_select",
      }));
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

      await waitFor(() => expect(screen.getByLabelText("Sheet range").value).toBe("A1:D5"));
      expect(onDraftRegionsChange).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("reuses the loaded workbook sheet while focusing different source ranges", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      const { rerender } = render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      await screen.findByText("Label", {}, { timeout: 10_000 });
      await waitFor(() => {
        const rangeRequests = fetchMock.mock.calls
          .filter(([url]) => url === "/api/source-documents/source_doc_1/range")
          .map(([, init]) => JSON.parse(init.body || "{}").range);
        expect(rangeRequests).toContain("A1:D5");
      });

      rerender(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
          focusSelection={{
            requestId: "focus_first",
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "C3:D4",
            focusOnly: true,
          }}
        />,
      );
      rerender(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
          focusSelection={{
            requestId: "focus_second",
            sourceDocumentId: "source_doc_1",
            sheetName: "Sheet1",
            range: "A1:B2",
            focusOnly: true,
          }}
        />,
      );
      await waitFor(() => expect(screen.getByLabelText("Sheet range").value).toBe("A1:D5"));

      const rangeRequests = fetchMock.mock.calls
        .filter(([url]) => url === "/api/source-documents/source_doc_1/range")
        .map(([, init]) => JSON.parse(init.body || "{}").range);
      expect(rangeRequests.filter((range) => range === "A1:D5")).toHaveLength(1);
      expect(rangeRequests).toEqual(["A1:D5"]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("locks sheet selection and new regions to the next review session SourceDocument", async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
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
    const onCreateRegion = vi.fn();
    try {
      const { rerender } = render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={{
            ...reviewState,
            session: { ...reviewState.session, id: "session_1", sourceDocumentId: "source_doc_1" },
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
          onCreateRegion={onCreateRegion}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText("Sheet range").value).toBe("A1:F81"));
      const grid = screen.getByRole("grid", { name: "Workbook sheet preview" });
      Object.defineProperty(grid, "scrollTop", { configurable: true, writable: true, value: 900 });
      Object.defineProperty(grid, "scrollLeft", { configurable: true, writable: true, value: 240 });
      fireEvent.scroll(grid);

      rerender(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={{
            ...reviewState,
            session: { ...reviewState.session, id: "session_2", sourceDocumentId: "source_doc_2" },
            sourceDocument: {
              id: "source_doc_2",
              metadata: {
                workbookName: "Second.xlsx",
                sheets: [
                  { name: "Setup", usedRange: "A1:B2", rowCount: 2, columnCount: 2 },
                  { name: "Results", usedRange: "C3:D4", rowCount: 4, columnCount: 4 },
                ],
              },
            },
          }}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
          onCreateRegion={onCreateRegion}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText("Sheet range").value).toBe("A1:B2"));
      expect(screen.queryByLabelText("Workbook")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Results" }));
      await waitFor(() => expect(screen.getByLabelText("Sheet range").value).toBe("C3:D4"));
      expect(grid.scrollTop).toBe(0);
      expect(grid.scrollLeft).toBe(0);
      await waitFor(() => {
        const secondWorkbookRequests = fetchMock.mock.calls
          .filter(([url]) => url === "/api/source-documents/source_doc_2/range")
          .map(([, init]) => JSON.parse(init.body || "{}"));
        expect(secondWorkbookRequests).toContainEqual({ sheetName: "Results", range: "C3:D4" });
      });

      const startCell = await screen.findByLabelText("Cell C3");
      const endCell = await screen.findByLabelText("Cell D4");
      fireEvent.mouseDown(startCell, { button: 0 });
      fireEvent.mouseEnter(endCell);
      fireEvent.mouseUp(endCell);
      await waitFor(() => expect(onCreateRegion).toHaveBeenCalledWith({
        sourceDocumentId: "source_doc_2",
        sheetName: "Results",
        range: "C3:D4",
        selectionMethod: "drag_select",
      }));
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

  it("hydrates the complete current sheet without scrolling", async () => {
    const sheets = [{
      name: "Sheet1",
      usedRange: "A1:X81",
      rowCount: 81,
      columnCount: 24,
    }];
    const { fetchMock } = makeHydrationFetch({ sheets });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={largeReviewState(sheets)}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      expect(await screen.findByText("Sheet1 A1:L40", {}, { timeout: 10_000 })).toBeTruthy();
      await screen.findByText("Sheet loaded: 6/6 ranges", {}, { timeout: 10_000 });

      const requests = workbookRangeRequests(fetchMock).map((body) => body.range);
      expect(requests).toEqual(expect.arrayContaining([
        "A1:L40",
        "M1:X40",
        "A41:L80",
        "M41:X80",
        "A81:L81",
        "M81:X81",
      ]));
      expect(requests[0]).toBe("A1:L40");
      expect(new Set(requests).size).toBe(requests.length);
      expect(requests.every((range) => workbookRangeCellCount(range) <= 500)).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  }, 15_000);

  it("waits for visible cells before starting at most three background reads", async () => {
    const sheets = [{
      name: "Sheet1",
      usedRange: "A1:X81",
      rowCount: 81,
      columnCount: 24,
    }];
    let releaseVisible;
    const pendingBackground = [];
    const requests = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/source-documents") {
        return jsonResponse({
          sourceDocuments: [{
            id: "source_doc_1",
            metadata: { workbookName: "Large.xlsx", sheets },
          }],
        });
      }
      if (url === "/api/source-documents/source_doc_1/range") {
        const body = JSON.parse(init.body || "{}");
        requests.push(body.range);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (body.range === "A1:L40") {
          return new Promise((resolve) => {
            releaseVisible = () => {
              inFlight -= 1;
              resolve(jsonResponse({
                sheetName: body.sheetName,
                range: body.range,
                rows: [],
                cells: [],
              }));
            };
          });
        }
        return new Promise((resolve) => {
          pendingBackground.push(() => {
            inFlight -= 1;
            resolve(jsonResponse({
              sheetName: body.sheetName,
              range: body.range,
              rows: [],
              cells: [],
            }));
          });
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
          reviewState={largeReviewState(sheets)}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      await waitFor(() => expect(requests).toEqual(["A1:L40"]));
      expect(maxInFlight).toBe(1);
      await act(async () => releaseVisible());
      await waitFor(() => expect(requests).toHaveLength(4));
      expect(inFlight).toBe(3);
      expect(maxInFlight).toBe(3);

      await act(async () => {
        pendingBackground.splice(0).forEach((release) => release());
      });
      await waitFor(() => expect(requests).toHaveLength(6), { timeout: 5_000 });
      expect(maxInFlight).toBe(3);
      await act(async () => {
        pendingBackground.splice(0).forEach((release) => release());
      });
      await screen.findByText("Sheet loaded: 6/6 ranges", {}, { timeout: 10_000 });
    } finally {
      global.fetch = originalFetch;
    }
  }, 20_000);

  it("starts a newly selected sheet from its top visible tile", async () => {
    const sheets = [
      { name: "Sheet1", usedRange: "A1:X61", rowCount: 61, columnCount: 24 },
      { name: "Sheet2", usedRange: "A1:X61", rowCount: 61, columnCount: 24 },
    ];
    const { fetchMock } = makeHydrationFetch({ sheets });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={largeReviewState(sheets)}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      await screen.findByText("Sheet loaded: 4/4 ranges");
      const grid = screen.getByRole("grid", { name: "Workbook sheet preview" });
      Object.defineProperty(grid, "scrollTop", { configurable: true, writable: true, value: 1200 });
      fireEvent.scroll(grid);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 160));
      });
      fetchMock.mockClear();

      fireEvent.click(screen.getByRole("button", { name: "Sheet2" }));
      await screen.findByText("Sheet loaded: 4/4 ranges");

      const sheet2Requests = workbookRangeRequests(fetchMock, "Sheet2");
      expect(sheet2Requests[0]?.range).toBe("A1:L40");
    } finally {
      global.fetch = originalFetch;
    }
  }, 10_000);

  it("retains completed and empty tiles when switching sheets", async () => {
    const sheets = [
      { name: "Sheet1", usedRange: "A1:X81", rowCount: 81, columnCount: 24 },
      { name: "Sheet2", usedRange: "A1:F81", rowCount: 81, columnCount: 6 },
    ];
    const { fetchMock } = makeHydrationFetch({
      sheets,
      emptyKeys: ["Sheet1!M41:X80"],
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={largeReviewState(sheets)}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      await screen.findByText("Sheet loaded: 6/6 ranges");
      const sheet1RequestCount = workbookRangeRequests(fetchMock, "Sheet1").length;
      fireEvent.click(screen.getByRole("button", { name: "Sheet2" }));
      await screen.findByText("Sheet loaded: 3/3 ranges", {}, { timeout: 5_000 });
      fireEvent.click(screen.getByRole("button", { name: "Sheet1" }));
      await screen.findByText("Sheet loaded: 6/6 ranges");

      expect(workbookRangeRequests(fetchMock, "Sheet1")).toHaveLength(sheet1RequestCount);
    } finally {
      global.fetch = originalFetch;
    }
  }, 10_000);

  it("does not show late responses from the previous sheet", async () => {
    const sheets = [
      { name: "Sheet1", usedRange: "A1:X81", rowCount: 81, columnCount: 24 },
      { name: "Sheet2", usedRange: "A1:F2", rowCount: 2, columnCount: 6 },
    ];
    let releaseSheet1;
    const heldSheet1 = new Promise((resolve) => {
      releaseSheet1 = () => resolve(jsonResponse({
        sheetName: "Sheet1",
        range: "A1:L40",
        rows: [[markerForWorkbookRange("Sheet1", "A1:L40")]],
        cells: [],
      }));
    });
    const { fetchMock } = makeHydrationFetch({
      sheets,
      deferred: new Map([["Sheet1!A1:L40", heldSheet1]]),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={largeReviewState(sheets)}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Sheet2" }));
      expect(await screen.findByText("Sheet2 A1:F2")).toBeTruthy();
      releaseSheet1();
      await act(async () => heldSheet1);

      expect(screen.queryByText("Sheet1 A1:L40")).toBeNull();
      expect(screen.getByLabelText("Sheet range").value).toBe("A1:F2");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("retries only failed workbook ranges and keeps successful cells", async () => {
    const sheets = [{
      name: "Sheet1",
      usedRange: "A1:X81",
      rowCount: 81,
      columnCount: 24,
    }];
    const { fetchMock, attempts } = makeHydrationFetch({
      sheets,
      failOnceKey: "Sheet1!M41:X80",
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    try {
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={largeReviewState(sheets)}
          draftRegions={[]}
          onDraftRegionsChange={() => {}}
        />,
      );

      expect(await screen.findByText("Sheet1 A1:L40")).toBeTruthy();
      await screen.findByText("Sheet incomplete: 5/6 ranges");
      expect(screen.getByText("Sheet1 A1:L40")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry failed ranges" }));
      await screen.findByText("Sheet loaded: 6/6 ranges");

      expect(attempts.get("Sheet1!M41:X80")).toBe(2);
      expect(screen.getByText("Sheet1 A1:L40")).toBeTruthy();
    } finally {
      global.fetch = originalFetch;
    }
  }, 10_000);

  it("does not overwrite the active region when dragging a new range", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    const onCreateRegion = vi.fn();
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
          onCreateRegion={onCreateRegion}
        />,
      );

      const startCell = await screen.findByLabelText("Cell C1");
      const endCell = await screen.findByLabelText("Cell D1");
      fireEvent.mouseDown(startCell, { button: 0 });
      fireEvent.mouseEnter(endCell);
      fireEvent.mouseUp(endCell);

      await waitFor(() => expect(onCreateRegion).toHaveBeenCalledWith({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        range: "C1:D1",
        selectionMethod: "drag_select",
      }));
      expect(onDraftRegionsChange).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Ctrl-drag requests another server region without toggling an existing region", async () => {
    const fetchMock = makeWorkbookReviewFetch();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onDraftRegionsChange = vi.fn();
    const onCreateRegion = vi.fn();
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
      render(
        <WorkbookReviewWorkspace
          projectId="project_1"
          reviewState={reviewState}
          draftRegions={[initialRegion]}
          activeDraftRegionId="draft_active"
          onDraftRegionsChange={onDraftRegionsChange}
          onCreateRegion={onCreateRegion}
        />,
      );

      const startCell = await screen.findByLabelText("Cell C1");
      const endCell = await screen.findByLabelText("Cell D1");
      fireEvent.mouseDown(startCell, { button: 0, ctrlKey: true });
      fireEvent.mouseEnter(endCell);
      fireEvent.mouseUp(endCell);

      await waitFor(() => expect(onCreateRegion).toHaveBeenCalledWith({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        range: "C1:D1",
        selectionMethod: "drag_select",
      }));
      expect(onDraftRegionsChange).not.toHaveBeenCalled();
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
    const onCreateRegion = vi.fn();
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
          onCreateRegion={onCreateRegion}
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

      await waitFor(() => expect(onCreateRegion).toHaveBeenCalled());
      const request = onCreateRegion.mock.calls.at(-1)[0];
      expect(request).toMatchObject({
        sourceDocumentId: "source_doc_1",
        sheetName: "Sheet1",
        selectionMethod: "drag_select",
      });
      expect(request.range).toMatch(/^A1:[B-J](?:[2-9]|1\d|20)$/);
      expect(grid.scrollLeft).toBeGreaterThan(0);
      expect(grid.scrollTop).toBeGreaterThan(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});


describe("ChartReviewModal", () => {
  it("shows reviewed analysis chart creation only in the chart review modal", () => {
    render(
      <ChartReviewModal
        open
        chartData={[{ importId: "import_1", fileName: "runs.xlsx" }]}
        allowAnalysisPrompt
        chartInterpretState={{}}
        chartSpecs={[]}
        onInterpretChart={() => {}}
        onOpenImportReview={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Create and review charts")).toBeTruthy();
    expect(screen.getByText("Create a chart")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prepare plan" })).toBeTruthy();
  });

  it("loads and manages approved ChartSpecs independently from proposals", async () => {
    const onLoadChartSpecDetail = vi.fn().mockResolvedValue({
      id: "chart_spec_analysis",
      title: "Normalized selectivity",
      chartType: "stacked_bar",
      spec: {
        schemaVersion: "labrat.chartSpec.v2",
        origin: "analysis_result",
        chartType: "stacked_bar",
        title: "Normalized selectivity",
        traceCatalog: [{
          traceId: "solid",
          name: "Solid",
          x: ["Exp1"],
          y: [92.8],
          xField: "__experiment_label",
          yField: "solid",
          xUnit: null,
          yUnit: "percent",
          sourceRecordIds: ["snapshot_1:0"],
        }],
        defaultChartView: { visibleTraceIds: ["solid"] },
      },
    });
    const onInsertChartSpec = vi.fn();
    render(
      <ChartReviewModal
        open
        chartData={[{ importId: "import_1", fileName: "runs.xlsx" }]}
        allowAnalysisPrompt
        chartInterpretState={{}}
        chartSpecs={[{
          id: "chart_spec_analysis",
          title: "Normalized selectivity",
          chartType: "stacked_bar",
          spec: {
            schemaVersion: "labrat.chartSpec.v2",
            origin: "analysis_result",
            chartType: "stacked_bar",
            title: "Normalized selectivity",
            traceCatalog: [{ traceId: "solid", pointCount: 1 }],
            detailRequired: true,
          },
        }]}
        onInterpretChart={() => {}}
        onLoadChartSpecDetail={onLoadChartSpecDetail}
        onInsertChartSpec={onInsertChartSpec}
        onOpenImportReview={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Approved charts" }));

    expect(screen.queryByText("Create a chart")).toBeNull();
    expect(screen.queryByText("Pending chart")).toBeNull();
    expect(screen.queryByText("Rejected chart")).toBeNull();
    expect(screen.getAllByText("Normalized selectivity").length).toBeGreaterThan(0);
    await waitFor(() => expect(onLoadChartSpecDetail).toHaveBeenCalledWith("chart_spec_analysis"));
    fireEvent.click(await screen.findByRole("button", { name: "Insert in Manuscript" }));
    expect(onInsertChartSpec).toHaveBeenCalledWith("chart_spec_analysis");
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
    expect(screen.queryByText("Create a chart")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import workbook" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenImportReview).toHaveBeenCalledTimes(1);
  });

  it("allows server project chart prompts without a published DataSnapshot", () => {
    const onInterpretChart = vi.fn();
    render(
      <ChartReviewModal
        open
        chartData={[]}
        allowAnalysisPrompt
        chartInterpretState={{}}
        chartSpecs={[]}
        onInterpretChart={onInterpretChart}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText("Select a server project first")).toBeNull();
    expect(screen.getByText("Create a chart")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("e.g. chart the carbon number distribution for Exp31"), {
      target: { value: "draw carbon distribution from P31 to BA32" },
    });
    fireEvent.click(screen.getByText("Prepare plan"));

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

  it("sends the active Browser surface with ordinary LabRat chat requests", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === "/api/projects/project_1/analysis-capabilities") {
        return jsonResponse({
          model: { configured: true },
          executor: { configured: true, adapter: "local_non_production" },
          acceptedData: { acceptedSnapshotCount: 1, activeExperimentHeadCount: 1 },
        });
      }
      if (url === "/api/projects/project_1/agent/runs") {
        return jsonResponse({
          reply: "I prepared a Browser data plan.",
          agentRun: {
            id: "agent_run_browser_context",
            status: "completed",
            mode: "analysis_planning",
            visibleSteps: [],
            actions: [],
            warnings: [],
          },
        }, { status: 201 });
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
          activeSurface="browser"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" } }}
          onProjectStateLoaded={() => {}}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: "Add normalized selectivity to Exp31." } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      expect(await screen.findByText("I prepared a Browser data plan.")).toBeTruthy();
      const request = fetchMock.mock.calls.find(([url]) => url === "/api/projects/project_1/agent/runs");
      const body = JSON.parse(request[1].body);
      expect(body.selectedContext.tab).toBe("browser");
      expect(body.selectedContext.activeSurface).toBe("browser");
      expect(body.selectedContext.analysisOutputTarget).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
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

  it("prefills a reviewed request handed off from onboarding", async () => {
    const onRequestedDraftHandled = vi.fn();
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
        requestedDraft="Build reviewed Experiment Browser records from the confirmed master table."
        onRequestedDraftHandled={onRequestedDraftHandled}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...").value)
        .toBe("Build reviewed Experiment Browser records from the confirmed master table.");
    });
    expect(onRequestedDraftHandled).toHaveBeenCalled();
  });

  it("shows backend-owned model, Python, and accepted-data readiness", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      model: { provider: "anthropic", model: "claude-test", configured: true },
      executor: { mode: "development", adapter: "local", configured: true, productionSafe: false },
      acceptedData: { acceptedSnapshotCount: 3, activeExperimentHeadCount: 2 },
    }));
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

      await waitFor(() => expect(screen.getByLabelText("Analysis runtime status").textContent).toContain("Model: anthropic / claude-test ready"));
      expect(screen.getByLabelText("Analysis runtime status").textContent).toContain("Python: local ready");
      expect(screen.getByLabelText("Analysis runtime status").textContent).toContain("Evidence: 0 confirmed regions, 3 snapshots, 2 active heads");
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/project_1/analysis-capabilities", expect.any(Object));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("refreshes analysis capabilities when accepted project evidence changes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        model: { configured: true },
        executor: { configured: true, adapter: "local_non_production" },
        acceptedData: { acceptedSnapshotCount: 0, activeExperimentHeadCount: 0 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        model: { configured: true },
        executor: { configured: true, adapter: "local_non_production" },
        acceptedData: { acceptedSnapshotCount: 1, activeExperimentHeadCount: 2 },
      }));
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const panel = (projectState) => (
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
        projectState={projectState}
        onProjectStateLoaded={() => {}}
      />
    );

    try {
      const { rerender } = render(panel({
        project: { id: "project_1" },
        dataSnapshots: [],
        experimentSnapshotHeads: [],
      }));
      await waitFor(() => expect(screen.getByLabelText("Analysis runtime status").textContent).toContain("0 snapshots, 0 active heads"));

      rerender(panel({
        project: { id: "project_1" },
        dataSnapshots: [{ id: "snapshot_1" }],
        experimentSnapshotHeads: [{ id: "head_1" }, { id: "head_2" }],
      }));

      await waitFor(() => expect(screen.getByLabelText("Analysis runtime status").textContent).toContain("1 snapshots, 2 active heads"));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
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

  it("restores a workbook filename link that reopens its exact review session", async () => {
    const workbookReviewLink = {
      workbookReviewSessionId: "session_saved_1",
      sourceDocumentId: "source_saved_1",
      workbookName: "Saved Master.xlsx",
      regionCount: 4,
    };
    localStorage.setItem("labrat_blank_chat_history_v2_project_project_1", JSON.stringify([{
      role: "assistant",
      text: "I indexed Saved Master.xlsx and found 4 potentially useful regions.",
      workbookReviewLink,
    }]));
    const onWorkbookReviewLinkOpen = vi.fn().mockResolvedValue(undefined);

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
        onWorkbookReviewLinkOpen={onWorkbookReviewLinkOpen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Saved Master.xlsx" }));
    await waitFor(() => expect(onWorkbookReviewLinkOpen).toHaveBeenCalledWith(workbookReviewLink));
    expect(screen.queryByText(/Select Sheet!/)).toBeNull();
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

  it("shows request progress and cancels the active server AgentRun without falling back", async () => {
    const fetchMock = vi.fn((url, request = {}) => {
      if (url === "/api/projects/project_1/analysis-capabilities") {
        return Promise.resolve(jsonResponse({
          model: { provider: "anthropic", model: "claude-test", configured: true },
          executor: { adapter: "local", configured: true },
          acceptedData: { acceptedSnapshotCount: 1, activeExperimentHeadCount: 2 },
        }));
      }
      if (url === "/api/projects/project_1/agent/runs") {
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
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
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" } }}
          onProjectStateLoaded={() => {}}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: "Compare all accepted experiments." } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      const requestStatus = await screen.findByLabelText("LabRat request status");
      expect(requestStatus.textContent).toContain("Routing request and drafting a reviewable plan");
      expect(requestStatus.textContent).toContain("0s elapsed");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(await screen.findByText("Request cancelled.")).toBeTruthy();
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/projects/project_1/agent/plan")).toBe(false);
      expect(screen.queryByLabelText("LabRat request status")).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("reports an AgentRun failure without claiming that a compatibility plan was created", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === "/api/projects/project_1/analysis-capabilities") {
        return jsonResponse({
          model: { provider: "anthropic", configured: true },
          executor: { adapter: "local", configured: true },
          acceptedData: { acceptedSnapshotCount: 1, activeExperimentHeadCount: 1 },
        });
      }
      if (url === "/api/projects/project_1/agent/runs") {
        return jsonResponse({
          error: { code: "provider_unavailable", message: "Anthropic is unavailable." },
        }, { status: 503 });
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
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" } }}
          onProjectStateLoaded={() => {}}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: "Chart carbon number distribution for Exp31." } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      expect(await screen.findByText(/Anthropic is unavailable.*No plan or chart was created/)).toBeTruthy();
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/projects/project_1/agent/plan")).toBe(false);
      expect(screen.queryByText(/I will prepare a reviewed analysis plan/)).toBeNull();
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

  it("opens a reviewable analysis plan from the normal LabRat conversation without a Browser action", async () => {
    const onOpenAnalysisReview = vi.fn();
    const analysisThread = {
      id: "analysis_thread_1",
      projectId: "project_1",
      status: "planning",
      originalRequest: "Normalize selectivity and compare every experiment.",
    };
    const currentPlanRevision = {
      id: "analysis_plan_revision_1",
      analysisThreadId: analysisThread.id,
      revision: 1,
      status: "awaiting_review",
      requestSummary: "Normalize Solid, Liquid, and Gas to 100%, then compare experiments.",
      sourceRectangles: [
        { sourceDocumentId: "source_1", sheetName: "Runs", range: "B2:D8" },
      ],
      planHash: "sha256_plan_1",
      selectionHash: "sha256_selection_1",
      dependencyHash: "sha256_dependency_1",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      reply: "I drafted a reviewed analysis plan. Check the selected source cells and processing steps.",
      analysisThread,
      currentPlanRevision,
      agentRun: {
        id: "agent_run_analysis_1",
        status: "waiting_for_user",
        mode: "analysis_planning",
        visibleSteps: [{ stepId: "step_analysis", label: "Drafted reviewable analysis plan", details: {} }],
        actions: [],
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
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" } }}
          onProjectStateLoaded={() => {}}
          onOpenAnalysisReview={onOpenAnalysisReview}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, {
        target: { value: "Normalize selectivity and compare every experiment." },
      });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      expect((await screen.findAllByText("Analysis plan revision 1")).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("button", { name: "Review analysis plan" })).toBeTruthy();
      expect(screen.queryByText("Open Experiment Browser")).toBeNull();
      expect(onOpenAnalysisReview).toHaveBeenCalledWith({
        thread: analysisThread,
        revision: currentPlanRevision,
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("retries an evidence-blocked analysis from its AgentRun warning after data is published", async () => {
    const onOpenAnalysisReview = vi.fn();
    const analysisThread = {
      id: "analysis_thread_retry_1",
      projectId: "project_1",
      status: "planning",
      originalRequest: "Compare selectivity across experiments.",
    };
    const retryRevision = {
      id: "analysis_plan_revision_retry_1",
      analysisThreadId: analysisThread.id,
      revision: 1,
      status: "awaiting_review",
      requestSummary: "Compare accepted selectivity values.",
      sourceRectangles: [],
    };
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/analysis-capabilities") {
        return jsonResponse({
          model: { configured: true },
          executor: { configured: true, adapter: "local_non_production" },
          acceptedData: { acceptedSnapshotCount: 1, activeExperimentHeadCount: 2 },
        });
      }
      if (url === "/api/projects/project_1/agent/runs") {
        return jsonResponse({
          reply: "Accepted published experiment data is required before planning.",
          analysisThread,
          currentPlanRevision: null,
          agentRun: {
            id: "agent_run_retry_1",
            warnings: [{ code: "analysis_evidence_required", message: "Publish accepted data." }],
            actions: [],
            visibleSteps: [],
          },
        }, { status: 201 });
      }
      if (url === `/api/analysis-threads/${analysisThread.id}/retry`) {
        expect(init.method).toBe("POST");
        return jsonResponse({ analysisThread, analysisPlanRevision: retryRevision }, { status: 201 });
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
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" } }}
          onProjectStateLoaded={() => {}}
          onOpenAnalysisReview={onOpenAnalysisReview}
        />,
      );

      await waitFor(() => expect(screen.getByLabelText("Analysis runtime status").textContent).toContain("Model: configured"));
      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: analysisThread.originalRequest } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      fireEvent.click(await screen.findByRole("button", { name: "Retry with confirmed evidence" }));
      await waitFor(() => expect(onOpenAnalysisReview).toHaveBeenCalledWith({
        thread: analysisThread,
        revision: retryRevision,
      }));
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/analysis-threads/${analysisThread.id}/retry`,
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not append a completed retry or open its review after switching projects", async () => {
    let resolveRetry;
    const retryResponse = new Promise((resolve) => { resolveRetry = resolve; });
    let resolveRetryJson;
    const retryJsonRead = new Promise((resolve) => { resolveRetryJson = resolve; });
    const analysisThread = {
      id: "analysis_thread_project_switch",
      projectId: "project_1",
      status: "planning",
      originalRequest: "Compare selectivity.",
    };
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith("/analysis-capabilities")) {
        return jsonResponse({
          model: { configured: true },
          executor: { configured: true },
          acceptedData: { acceptedSnapshotCount: 1, activeExperimentHeadCount: 1 },
        });
      }
      if (url === "/api/projects/project_1/agent/runs") {
        return jsonResponse({
          analysisThread,
          agentRun: {
            id: "agent_run_switch",
            warnings: [{ code: "analysis_evidence_required", message: "Publish accepted data." }],
            actions: [],
            visibleSteps: [],
          },
        }, { status: 201 });
      }
      if (url === `/api/analysis-threads/${analysisThread.id}/retry`) return retryResponse;
      throw new Error(`Unexpected fetch ${url}`);
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const onOpenAnalysisReview = vi.fn();
    const panel = (projectId) => (
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
        projectState={{ project: { id: projectId, name: projectId } }}
        onProjectStateLoaded={() => {}}
        onOpenAnalysisReview={onOpenAnalysisReview}
      />
    );

    try {
      const { rerender } = render(panel("project_1"));
      await waitFor(() => expect(screen.getByLabelText("Analysis runtime status").textContent).toContain("Model: configured"));
      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: analysisThread.originalRequest } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });
      fireEvent.click(await screen.findByRole("button", { name: "Retry with confirmed evidence" }));

      rerender(panel("project_2"));
      await waitFor(() => expect(screen.getByLabelText("Analysis runtime status").textContent).toContain("Model: configured"));
      await act(async () => {
        resolveRetry({
          ok: true,
          status: 201,
          json: async () => {
            resolveRetryJson();
            return {
              analysisThread,
              analysisPlanRevision: {
                id: "analysis_plan_revision_switch",
                revision: 1,
                status: "awaiting_review",
                requestSummary: "Old project plan",
              },
            };
          },
        });
        await retryJsonRead;
      });
      expect(screen.queryByText("Old project plan")).toBeNull();
      expect(onOpenAnalysisReview).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("drives reviewed analysis from LabRat through Manuscript trace selection", async () => {
    const analysisThread = {
      id: "analysis_thread_golden",
      projectId: "project_1",
      status: "planning",
      originalRequest: "Normalize selectivity and compare every experiment.",
      messages: [],
    };
    const revision1 = {
      id: "analysis_plan_revision_golden_1",
      analysisThreadId: analysisThread.id,
      revision: 1,
      status: "awaiting_review",
      requestSummary: "Normalize Solid, Liquid, and Gas selectivity.",
      displayPlan: [
        "Read accepted selectivity values.",
        "Scale each retained row to a total of 100 percent.",
      ],
      reviewPlan: {
        processingSteps: [
          "Read accepted selectivity values.",
          "Scale each retained row to a total of 100 percent.",
        ],
        chart: {
          title: "Normalized selectivity by experiment",
          chartType: "bar",
          xDescription: "Component",
          yDescription: "Selectivity (%)",
          seriesDescription: "One curve per experiment",
        },
      },
      sourceRectangles: [{
        sourceDocumentId: "source_document_1",
        sheetName: "Runs",
        range: "L3:N4",
        label: "Accepted selectivity inputs",
      }],
      warnings: [],
    };
    const feedback = "Keep both experiments and label each experiment trace clearly.";
    const revision2 = {
      ...revision1,
      id: "analysis_plan_revision_golden_2",
      revision: 2,
      feedback,
    };
    const selection = {
      sourceRectangles: revision1.sourceRectangles,
      coverage: { selectedExperimentCount: 2, selectedFieldCount: 3 },
      records: [
        {
          experimentId: "experiment_1",
          experimentLabel: "Exp 1",
          snapshotId: "snapshot_1",
          recordIndex: 0,
          fields: [{ fieldKey: "solid", displayName: "Solid", value: 92.8 }],
          series: [],
        },
        {
          experimentId: "experiment_2",
          experimentLabel: "Exp 2",
          snapshotId: "snapshot_2",
          recordIndex: 0,
          fields: [{ fieldKey: "solid", displayName: "Solid", value: 92 }],
          series: [],
        },
      ],
      warnings: [],
    };
    const run = {
      id: "analysis_run_golden",
      acceptedPlanRevisionId: revision2.id,
      status: "awaiting_result_review",
      execution: { adapter: "golden_test_executor", phase: "result_ready" },
      validation: { ok: true, errors: [] },
    };
    const result = {
      id: "analysis_result_golden",
      analysisRunId: run.id,
      status: "awaiting_review",
      traceCount: 2,
      summary: {
        pointCount: 6,
        seriesCount: 2,
        excludedCount: 0,
      },
      validation: {
        ok: true,
        invariants: [{
          type: "row_sum",
          fieldKeys: ["solid", "liquid", "gas"],
          target: 100,
          absoluteTolerance: 0.000001,
          ok: true,
        }],
        errors: [],
      },
      warnings: [],
    };
    const traces = [
      {
        traceId: "trace_exp_1",
        experimentId: "experiment_1",
        experimentLabel: "Exp 1",
        name: "Exp 1",
        x: ["Solid", "Liquid", "Gas"],
        y: [99.5, 0.1, 0.4],
        xUnit: null,
        yUnit: "percent",
        sourceRecordIds: ["snapshot_1:0"],
      },
      {
        traceId: "trace_exp_2",
        experimentId: "experiment_2",
        experimentLabel: "Exp 2",
        name: "Exp 2",
        x: ["Solid", "Liquid", "Gas"],
        y: [99.2, 0.4, 0.4],
        xUnit: null,
        yUnit: "percent",
        sourceRecordIds: ["snapshot_2:0"],
      },
    ];
    const resultPreview = {
      analysisRunId: run.id,
      analysisResultId: result.id,
      plotly: {
        data: traces,
        layout: {
          title: { text: "Normalized selectivity by experiment" },
          xaxis: { title: { text: "Component" } },
          yaxis: { title: { text: "Selectivity (%)" } },
        },
      },
      summary: result.summary,
      exclusions: [],
      validation: result.validation,
      warnings: [],
      sourceRefs: [
        {
          sourceDocumentId: "source_document_1",
          sheetName: "Runs",
          range: "L3:N3",
          sourceRecordId: "snapshot_1:0",
        },
        {
          sourceDocumentId: "source_document_1",
          sheetName: "Runs",
          range: "L4:N4",
          sourceRecordId: "snapshot_2:0",
        },
      ],
      tracePage: { offset: 0, limit: 500, totalCount: 2 },
    };
    const chartSpec = {
      id: "chart_spec_golden",
      title: "Normalized selectivity by experiment",
      chartType: "bar",
      origin: "analysis_result",
      spec: {
        schemaVersion: "labrat.chartSpec.v3",
        origin: "analysis_result",
        chartType: "bar",
        title: "Normalized selectivity by experiment",
        plotly: resultPreview.plotly,
        traceCatalog: traces,
        defaultChartView: { visibleTraceIds: ["trace_exp_1", "trace_exp_2"] },
      },
    };
    const createRevision = vi.fn().mockResolvedValue({
      analysisPlanRevision: revision2,
    });
    const acceptPlan = vi.fn().mockResolvedValue({
      analysisPlanRevision: { ...revision2, status: "accepted" },
      analysisRun: { ...run, status: "queued" },
    });
    const executeRun = vi.fn().mockResolvedValue({
      analysisRun: run,
      analysisResult: result,
    });
    const loadResultPreview = vi.fn().mockResolvedValue(resultPreview);
    const acceptResult = vi.fn().mockResolvedValue({
      analysisThread: { ...analysisThread, status: "completed" },
      analysisPlanRevision: { ...revision2, status: "accepted" },
      analysisRun: { ...run, status: "completed" },
      analysisResult: { ...result, status: "accepted" },
      chartSpec,
    });
    const fetchMock = vi.fn(async (url) => {
      if (url === "/api/projects/project_1/analysis-capabilities") {
        return jsonResponse({
          model: { configured: true },
          executor: { configured: true, adapter: "golden_test_executor" },
          acceptedData: { acceptedSnapshotCount: 1, activeExperimentHeadCount: 2 },
        });
      }
      return jsonResponse({
        reply: "I drafted a reviewed analysis plan. Check the selected source cells and processing steps.",
        analysisThread,
        currentPlanRevision: revision1,
        agentRun: {
          id: "agent_run_golden",
          status: "waiting_for_user",
          mode: "analysis_planning",
          visibleSteps: [{ stepId: "draft", label: "Drafted reviewable analysis plan", details: {} }],
          actions: [],
          warnings: [],
        },
      }, { status: 201 });
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    function WorkbookSourceStub({ draftRegions }) {
      return (
        <div aria-label="Golden workbook source">
          {draftRegions.map((region) => (
            <span key={region.draftRegionId}>{`${region.sheetName}!${region.range}`}</span>
          ))}
        </div>
      );
    }

    function GoldenWorkflowHarness() {
      const [review, setReview] = useState(null);
      const [publishedChart, setPublishedChart] = useState(null);
      const [insertRequest, setInsertRequest] = useState(null);
      const [blocks, setBlocks] = useState([]);
      const [pages, setPages] = useState([{
        id: "page_golden",
        y: 0,
        width: 1600,
        height: 900,
        orientation: "landscape",
      }]);
      const [canvasHeight, setCanvasHeight] = useState(900);
      const [orientation, setOrientation] = useState("landscape");
      const [staged, setStaged] = useState([]);
      const [templates, setTemplates] = useState([]);

      if (publishedChart) {
        return (
          <>
            <ManuscriptCanvas
              blocks={blocks}
              setBlocks={setBlocks}
              staged={staged}
              setStaged={setStaged}
              references={[]}
              chartTemplates={templates}
              setChartTemplates={setTemplates}
              chartSpecs={[publishedChart]}
              pages={pages}
              setPages={setPages}
              canvasHeight={canvasHeight}
              setCanvasHeight={setCanvasHeight}
              pageOrientationPreference={orientation}
              setPageOrientationPreference={setOrientation}
              chartSpecInsertRequest={insertRequest}
              onChartSpecInsertRequestHandled={() => setInsertRequest(null)}
              onLoadChartSpecDetail={vi.fn().mockResolvedValue(publishedChart)}
              onSelectedChartContextChange={() => {}}
              onRequestChartAnalysis={() => {}}
              onSaveProject={() => {}}
            />
            <pre data-testid="golden-manuscript-state">{JSON.stringify({ blocks })}</pre>
          </>
        );
      }

      return (
        <>
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
            projectState={{ project }}
            onProjectStateLoaded={() => {}}
            onOpenAnalysisReview={setReview}
          />
          {review ? (
            <AnalysisReviewWorkspace
              projectId="project_1"
              thread={review.thread}
              revision={review.revision}
              planRevisions={[review.revision]}
              selection={selection}
              WorkbookWorkspaceComponent={WorkbookSourceStub}
              PlotComponent={({ traces: previewTraces }) => (
                <div aria-label="Golden analysis preview">{previewTraces.length} traces</div>
              )}
              createRevision={createRevision}
              acceptPlan={acceptPlan}
              executeRun={executeRun}
              loadResultPreview={loadResultPreview}
              onAcceptResult={acceptResult}
              onAccepted={(response) => {
                if (!response?.chartSpec) return;
                setPublishedChart(response.chartSpec);
                setInsertRequest({
                  chartSpecId: response.chartSpec.id,
                  requestId: "golden_insert_request",
                });
              }}
            />
          ) : null}
        </>
      );
    }

    try {
      render(<GoldenWorkflowHarness />);
      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, {
        target: { value: "Normalize selectivity and compare every experiment." },
      });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      expect((await screen.findAllByText("Analysis plan revision 1")).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Runs!L3:N4").length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText("Open Experiment Browser")).toBeNull();
      expect(screen.queryByLabelText(/Anthropic API key/i)).toBeNull();

      fireEvent.change(screen.getByPlaceholderText("Describe a modification"), {
        target: { value: feedback },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send modification" }));
      await waitFor(() => expect(createRevision).toHaveBeenCalledWith(
        analysisThread.id,
        { feedback },
      ));
      expect(screen.getByText("Revision 2")).toBeTruthy();
      expect(acceptPlan).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Accept plan" }));
      await waitFor(() => expect(acceptPlan).toHaveBeenCalledWith(
        revision2.id,
        {},
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ));
      await waitFor(() => expect(executeRun).toHaveBeenCalledWith(run.id));
      await waitFor(() => expect(loadResultPreview).toHaveBeenCalled());

      expect(screen.getByRole("tab", { name: "Result" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByLabelText("Golden analysis preview").textContent).toBe("2 traces");
      expect(screen.getByText("no exclusions", { exact: false })).toBeTruthy();
      expect(screen.queryByRole("tab", { name: "Chart" })).toBeNull();
      fireEvent.click(screen.getByText("Series", { selector: "summary" }));
      expect(screen.getByRole("checkbox", { name: "Show Exp 1 by default" }).checked).toBe(true);
      expect(screen.getByRole("checkbox", { name: "Show Exp 2 by default" }).checked).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Accept chart" }));

      await waitFor(() => expect(acceptResult).toHaveBeenCalledWith({
        runId: run.id,
        analysisResultId: result.id,
        defaultVisibleTraceIds: ["trace_exp_1", "trace_exp_2"],
      }));
      expect(await screen.findByRole("dialog", { name: "Insert chart" })).toBeTruthy();
      expect(screen.getByText("2 of 2 traces visible")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Insert chart" }));

      await waitFor(() => {
        const state = JSON.parse(screen.getByTestId("golden-manuscript-state").textContent);
        expect(state.blocks[0].chartView.visibleTraceIds).toEqual([
          "trace_exp_1",
          "trace_exp_2",
        ]);
      });
      const chartFrame = document.querySelector(".canvas-block.chart");
      fireEvent.mouseDown(chartFrame, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.mouseUp(window);
      fireEvent.click(screen.getByLabelText("Hide Exp 2 in selected chart"));

      await waitFor(() => {
        const state = JSON.parse(screen.getByTestId("golden-manuscript-state").textContent);
        expect(state.blocks[0].chartView.visibleTraceIds).toEqual(["trace_exp_1"]);
        expect(state.blocks[0].chartSpecSnapshot.spec.traceCatalog).toHaveLength(2);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("attaches spreadsheet files from the plus button and uploads only after sending the chat message", async () => {
    localStorage.removeItem("labrat_blank_chat_history_v1_react");
    const onWorkbookReviewReady = vi.fn();
    const onWorkbookReviewLinkOpen = vi.fn().mockResolvedValue(undefined);
    const onProjectStateLoaded = vi.fn();
    let resolveProjectState;
    const projectStateResponse = new Promise((resolve) => {
      resolveProjectState = resolve;
    });
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/analysis-capabilities") {
        return jsonResponse({
          model: { configured: true },
          executor: { configured: true, adapter: "local" },
          acceptedData: { acceptedSnapshotCount: 0, activeExperimentHeadCount: 0 },
        });
      }
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
          reviewRegions: [{
            id: "region_1",
            workbookReviewSessionId: "session_1",
            sourceDocumentId: "source_doc_1",
            sourceRegionId: "source_region_1",
            sheetName: "Sheet1",
            rangeRef: "A1:Y10",
            disposition: "active",
            reviewStatus: "interpreting",
            version: 1,
            currentRevision: null,
          }],
          interpretationDeferred: true,
        }, { status: 201 });
      }
      if (url === "/api/projects/project_1/state") {
        return projectStateResponse;
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
          onWorkbookReviewLinkOpen={onWorkbookReviewLinkOpen}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Attach spreadsheet" }));
      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(["placeholder"], "Master.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(screen.getByText("Master.xlsx")).toBeTruthy();
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/projects/project_1/files")).toBe(false);

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: "Please help me understand this workbook" } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(onWorkbookReviewReady).toHaveBeenCalled());
      expect(onWorkbookReviewReady.mock.calls[0][0].response.reviewRegions[0]).toMatchObject({
        id: "region_1",
        reviewStatus: "interpreting",
      });
      expect(onProjectStateLoaded).not.toHaveBeenCalled();
      resolveProjectState(jsonResponse({
        project: { id: "project_1" },
        sourceDocuments: [],
        workbookReviewSessions: [],
      }));
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/project_1/files", expect.objectContaining({ method: "POST" }));
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/project_1/workbook-review-sessions", expect.objectContaining({ method: "POST" }));
      expect(await screen.findByText(/AI is understanding them in Workbook Review/)).toBeTruthy();
      expect(onProjectStateLoaded).toHaveBeenCalled();

      expect(screen.queryByRole("button", { name: "Select Sheet1!A1:Y10" })).toBeNull();
      const workbookLink = screen.getByRole("button", { name: "Master.xlsx" });
      fireEvent.click(workbookLink);
      expect(onWorkbookReviewLinkOpen).toHaveBeenCalledWith(expect.objectContaining({
        workbookReviewSessionId: "session_1",
        sourceDocumentId: "source_doc_1",
        workbookName: "Master.xlsx",
        regionCount: 1,
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
          pendingRedBoxes: [],
        }}
      />,
    );

    expect(screen.queryByLabelText("Workbook review response")).toBeNull();
    expect(screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...")).toBeTruthy();
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
