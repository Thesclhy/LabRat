import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentPanel, ChartReviewModal, DeleteProjectModal, NewProjectModal, ProjectDashboard, ProjectOverview, RefreshWorkbookModal, Topbar, activeChartSpecsForProject } from "../main.jsx";

const project = {
  id: "project_1",
  name: "Catalyst Screening",
  description: "Compare catalysts",
  status: "active",
  currentDatasetCommitId: "commit_1",
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
  currentDatasetCommit: { id: "commit_1" },
  importRuns: [{ id: "run_1", status: "applied" }],
  chartProposalSets: [{
    id: "chart_set_1",
    payload: { proposals: [{ proposalId: "chart_1", status: "accepted" }] },
  }],
  chartSpecs: [{ id: "chart_spec_1", title: "Gas vs Temperature" }],
  manuscripts: [{ id: "manuscript_1", updatedAt: "2026-06-15T12:00:00.000Z" }],
};

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
    expect(screen.getByText("Dataset committed")).toBeTruthy();
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
  it("shows the next project workflow actions", () => {
    const onOpenImportReview = vi.fn();
    const onOpenRefreshWorkbook = vi.fn();
    const onOpenSupplementWorkbook = vi.fn();
    const onOpenChartReview = vi.fn();
    render(
      <ProjectOverview
        projectState={projectState}
        dataset={{ genericImports: [{ importId: "import_1", fileName: "runs.xlsx" }] }}
        onOpenProfile={() => {}}
        onOpenImportReview={onOpenImportReview}
        onOpenRefreshWorkbook={onOpenRefreshWorkbook}
        onOpenSupplementWorkbook={onOpenSupplementWorkbook}
        onOpenChartReview={onOpenChartReview}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText("Project profile")).toBeTruthy();
    expect(screen.getByText("Master Dataset")).toBeTruthy();
    expect(screen.getByText("Supplemental Workbooks")).toBeTruthy();
    expect(screen.getByText("1 master table")).toBeTruthy();
    expect(screen.getByText("0 supplemental files")).toBeTruthy();
    expect(screen.getByText("1 specs")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload master table" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh master table" }));
    fireEvent.click(screen.getByRole("button", { name: "Add supplemental workbook" }));
    fireEvent.click(screen.getByRole("button", { name: "Review chart proposals" }));
    expect(onOpenRefreshWorkbook).toHaveBeenCalledTimes(1);
    expect(onOpenSupplementWorkbook).toHaveBeenCalledTimes(1);
    expect(onOpenChartReview).toHaveBeenCalledTimes(1);
    expect(onOpenImportReview).not.toHaveBeenCalled();
  });

  it("disables master refresh and supplemental uploads without a committed master import", () => {
    const onOpenImportReview = vi.fn();
    render(
      <ProjectOverview
        projectState={{ ...projectState, currentDatasetCommit: { id: "commit_1" } }}
        dataset={{ genericImports: [] }}
        onOpenProfile={() => {}}
        onOpenImportReview={onOpenImportReview}
        onOpenRefreshWorkbook={() => {}}
        onOpenSupplementWorkbook={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Upload master table" }));
    expect(onOpenImportReview).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No master table")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh master table" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Add supplemental workbook" }).disabled).toBe(true);
  });

  it("ignores stale chart specs in overview counts and active chart choices", () => {
    const stateWithStaleSpec = {
      ...projectState,
      chartSpecs: [
        { id: "chart_spec_active", title: "Current Gas", datasetCommitId: "commit_1", status: "active", isStale: false },
        { id: "chart_spec_stale", title: "Old Gas", datasetCommitId: "commit_old", status: "stale", isStale: true },
      ],
    };

    render(
      <ProjectOverview
        projectState={stateWithStaleSpec}
        dataset={{ genericImports: [{ importId: "import_1", fileName: "runs.xlsx" }] }}
        onOpenProfile={() => {}}
        onOpenImportReview={() => {}}
        onOpenRefreshWorkbook={() => {}}
        onOpenSupplementWorkbook={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText("1 specs")).toBeTruthy();
    expect(screen.getByText(/older chart specs are hidden/)).toBeTruthy();
    expect(activeChartSpecsForProject(stateWithStaleSpec).map((chartSpec) => chartSpec.id)).toEqual(["chart_spec_active"]);
  });
});

describe("ChartReviewModal", () => {
  it("shows one-chart prompt and proposal review only in the chart review modal", () => {
    render(
      <ChartReviewModal
        open
        genericImports={[{ importId: "import_1", fileName: "runs.xlsx" }]}
        mappingState={{}}
        chartProposalState={{}}
        chartInterpretState={{}}
        chartSpecs={[]}
        onProposeCharts={() => {}}
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
    expect(screen.getByText("Propose charts").disabled).toBe(false);
  });

  it("shows an import-first empty state when chart review has no data", () => {
    const onOpenImportReview = vi.fn();
    const onClose = vi.fn();
    render(
      <ChartReviewModal
        open
        genericImports={[]}
        onOpenImportReview={onOpenImportReview}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Import workbook first")).toBeTruthy();
    expect(screen.queryByText("One-chart prompt")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import workbook" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenImportReview).toHaveBeenCalledTimes(1);
  });
});

describe("RefreshWorkbookModal", () => {
  it("selects a committed import and uploads a replacement workbook", () => {
    const onStartRefresh = vi.fn();
    render(
      <RefreshWorkbookModal
        open
        imports={[
          { importId: "import_old", fileName: "old.xlsx", experiments: [{ experimentId: "exp_1" }], fields: [{ fieldId: "field_1" }] },
          { importId: "import_supp", fileName: "rate.xlsx", relationship: { relationship: "supplement" }, experiments: [], fields: [] },
          { importId: "import_latest", fileName: "latest.xlsx", experiments: [], fields: [] },
        ]}
        defaultImportId="import_old"
        onStartRefresh={onStartRefresh}
        onClose={() => {}}
      />,
    );
    const file = new File(["replacement"], "replacement.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(screen.getByText("old.xlsx")).toBeTruthy();
    expect(screen.getByText("1 experiments - 1 fields")).toBeTruthy();
    expect(screen.queryByText("rate.xlsx")).toBeNull();
    fireEvent.change(screen.getByLabelText("Upload replacement workbook"), { target: { files: [file] } });

    expect(onStartRefresh).toHaveBeenCalledWith({
      file,
      replaceImportId: "import_old",
      targetImport: expect.objectContaining({ importId: "import_old" }),
    });
  });
});

describe("AgentPanel", () => {
  it("plans server-backed project actions and renders a confirmable action card", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: "labrat.agentPlan.v1",
        reply: "I can add a supplemental workbook after you choose a file.",
        actions: [{
          actionId: "agent_action_1",
          type: "upload_supplement",
          status: "requires_confirmation",
          label: "Add supplemental workbook",
          description: "Choose a workbook and review its relationship to existing experiments.",
          requiresFile: true,
          requiresReview: true,
          params: { targetExperimentAliases: ["Exp30"] },
          warnings: [],
        }],
      }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      render(
        <AgentPanel
          open
          setOpen={() => {}}
          dataset={{ metadata: {}, experiments: [], genericImports: [] }}
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

      fireEvent.change(screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript..."), {
        target: { value: "upload supplement for Exp30" },
      });
      fireEvent.click(screen.getByRole("button", { name: "↑" }));

      await waitFor(() => expect(screen.getByText("Add supplemental workbook")).toBeTruthy());
      expect(screen.getByText("Target: Exp30")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Choose file" })).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/project_1/agent/plan", expect.objectContaining({ method: "POST" }));
    } finally {
      global.fetch = originalFetch;
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
