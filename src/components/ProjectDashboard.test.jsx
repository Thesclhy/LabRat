import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentPanel, ChartReviewModal, CompareSeriesModal, DeleteProjectModal, MappingReviewModal, NewProjectModal, ProjectDashboard, ProjectOverview, RefreshWorkbookModal, SupplementalWorkbooksModal, Topbar, activeChartSpecsForProject, buildCompareSeriesGroups, latestItem, mergeProjectStateForWorkspaceRefresh } from "../main.jsx";

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
  mappingSets: [{
    id: "mapping_set_1",
    datasetCommitId: "commit_1",
    status: "proposed",
    payload: {
      schemaVersion: "labrat.semanticMappingSet.v1",
      mappings: [
        {
          mappingId: "mapping_temp",
          rawLabel: "Temperature",
          canonicalField: "temperature",
          semanticRole: "condition",
          valueType: "numeric",
          unit: "C",
          sourceIds: ["field_temp_1"],
          status: "accepted",
        },
        {
          mappingId: "mapping_gas",
          rawLabel: "Selectivity Gas",
          canonicalField: "selectivity_gas",
          semanticRole: "response",
          valueType: "numeric",
          unit: "%",
          sourceIds: ["field_gas_1"],
          status: "proposed",
        },
      ],
    },
    decisionSummary: { accepted: 1, proposed: 1, rejected: 0 },
    updatedAt: "2026-06-15T12:00:00.000Z",
  }],
  chartSpecs: [{ id: "chart_spec_1", title: "Gas vs Temperature" }],
  manuscripts: [{ id: "manuscript_1", updatedAt: "2026-06-15T12:00:00.000Z" }],
};

const compareSeries = [
  {
    id: "series_exp30_adjusted",
    datasetCommitId: "commit_1",
    experimentId: "exp_30",
    experimentLabel: "Exp30",
    seriesKind: "reaction_rate_time_series",
    xField: "reaction_time_min",
    xLabel: "Reaction Time",
    xUnit: "min",
    yField: "adjusted_rate_m_s",
    yLabel: "Adjusted Rate",
    yUnit: "M/s",
    summary: { pointCount: 62, sourceFileName: "Reaction_Rate_Exp30.xlsx" },
    status: "active",
    isStale: false,
  },
  {
    id: "series_exp31_adjusted",
    datasetCommitId: "commit_1",
    experimentId: "exp_31",
    experimentLabel: "Exp31",
    seriesKind: "reaction_rate_time_series",
    xField: "reaction_time_min",
    xLabel: "Reaction Time",
    xUnit: "min",
    yField: "adjusted_rate_m_s",
    yLabel: "Adjusted Rate",
    yUnit: "M/s",
    summary: { pointCount: 60, sourceFileName: "Reaction_Rate_Exp31.xlsx" },
    status: "active",
    isStale: false,
  },
  {
    id: "series_exp30_rate",
    datasetCommitId: "commit_1",
    experimentId: "exp_30",
    experimentLabel: "Exp30",
    seriesKind: "reaction_rate_time_series",
    xField: "reaction_time_min",
    xLabel: "Reaction Time",
    xUnit: "min",
    yField: "reaction_rate_mol_g_h",
    yLabel: "Reaction Rate",
    yUnit: "mol/g/h",
    summary: { pointCount: 62, sourceFileName: "Reaction_Rate_Exp30.xlsx" },
    status: "active",
    isStale: false,
  },
];

const projectStateWithCompareSeries = {
  ...projectState,
  observationSeries: compareSeries,
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
    const onOpenSupplementManager = vi.fn();
    const onOpenMappingReview = vi.fn();
    const onOpenChartReview = vi.fn();
    render(
      <ProjectOverview
        projectState={projectState}
        dataset={{ genericImports: [{ importId: "import_1", fileName: "runs.xlsx" }] }}
        onOpenProfile={() => {}}
        onOpenImportReview={onOpenImportReview}
        onOpenRefreshWorkbook={onOpenRefreshWorkbook}
        onOpenSupplementWorkbook={onOpenSupplementWorkbook}
        onOpenSupplementManager={onOpenSupplementManager}
        onOpenMappingReview={onOpenMappingReview}
        onOpenChartReview={onOpenChartReview}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText("Project profile")).toBeTruthy();
    expect(screen.getByText("Master Dataset")).toBeTruthy();
    expect(screen.getByText("Supplemental Workbooks")).toBeTruthy();
    expect(screen.getByText("Semantic mappings")).toBeTruthy();
    expect(screen.getByText("1 master table")).toBeTruthy();
    expect(screen.getByText("0 supplemental files")).toBeTruthy();
    expect(screen.getByText("1/2 accepted")).toBeTruthy();
    expect(screen.getByText("1 specs")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload master table" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh master table" }));
    fireEvent.click(screen.getByRole("button", { name: "Add supplemental workbook" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage supplemental workbooks" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit mappings" }));
    fireEvent.click(screen.getByRole("button", { name: "Review chart proposals" }));
    expect(onOpenRefreshWorkbook).toHaveBeenCalledTimes(1);
    expect(onOpenSupplementWorkbook).toHaveBeenCalledTimes(1);
    expect(onOpenSupplementManager).toHaveBeenCalledTimes(1);
    expect(onOpenMappingReview).toHaveBeenCalledTimes(1);
    expect(onOpenChartReview).toHaveBeenCalledTimes(1);
    expect(onOpenImportReview).not.toHaveBeenCalled();
  });

  it("shows a compare series entry when compatible observation series exist", () => {
    const onOpenCompareSeries = vi.fn();

    render(
      <ProjectOverview
        projectState={projectStateWithCompareSeries}
        dataset={{ genericImports: [{ importId: "master", fileName: "master.xlsx" }] }}
        onOpenProfile={() => {}}
        onOpenImportReview={() => {}}
        onOpenRefreshWorkbook={() => {}}
        onOpenSupplementWorkbook={() => {}}
        onOpenSupplementManager={() => {}}
        onOpenCompareSeries={onOpenCompareSeries}
        onOpenMappingReview={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText("2 comparable series")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compare series" }));
    expect(onOpenCompareSeries).toHaveBeenCalledTimes(1);
  });

  it("groups compatible series and submits a series compare AnalysisView request", () => {
    const onCreateCompare = vi.fn();
    const groups = buildCompareSeriesGroups(projectStateWithCompareSeries);

    expect(groups).toHaveLength(2);
    expect(groups[0].yField).toBe("adjusted_rate_m_s");
    expect(groups[0].series.map((series) => series.experimentLabel)).toEqual(["Exp30", "Exp31"]);

    render(
      <CompareSeriesModal
        open
        projectState={projectStateWithCompareSeries}
        onCreateCompare={onCreateCompare}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Compare series" })).toBeTruthy();
    expect(screen.getAllByText("Adjusted Rate (M/s) vs Reaction Time (min)").length).toBeGreaterThan(0);
    expect(screen.getByText("2 of 2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Draft compare proposal" }));

    expect(onCreateCompare).toHaveBeenCalledWith({
      title: "Adjusted Rate (M/s) comparison",
      seriesKind: "reaction_rate_time_series",
      experimentIds: ["exp_30", "exp_31"],
      xField: "reaction_time_min",
      yField: "adjusted_rate_m_s",
      groupBy: "experiment",
    });
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
        onOpenSupplementManager={() => {}}
        onOpenMappingReview={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Upload master table" }));
    expect(onOpenImportReview).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No master table")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh master table" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Add supplemental workbook" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Manage supplemental workbooks" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Edit mappings" }).disabled).toBe(true);
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
        dataset={{ genericImports: [{ importId: "import_1", fileName: "runs.xlsx" }] }}
        onOpenProfile={() => {}}
        onOpenImportReview={() => {}}
        onOpenRefreshWorkbook={() => {}}
        onOpenSupplementWorkbook={() => {}}
        onOpenSupplementManager={() => {}}
        onOpenMappingReview={() => {}}
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
    expect(screen.getByText("5 active")).toBeTruthy();
    expect(screen.getByText("1 accepted / 4 pending")).toBeTruthy();
    expect(screen.queryByText("Old pending proposal")).toBeNull();
    expect(screen.queryByText("Accepted Chart")).toBeNull();
    expect(screen.queryByText("Rejected Chart")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Accepted + pending" }));
    expect(onOpenChartReview).toHaveBeenCalledWith({ statusFilter: "active" });
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(onOpenChartReview).toHaveBeenLastCalledWith("pending_1");
  });

  it("keeps supplemental details behind the manager button in the overview card", () => {
    const stateWithSupplement = {
      ...projectState,
      fileObjects: [{ id: "file_pending", originalName: "pending-rate.xlsx" }],
      importRuns: [{
        id: "run_pending",
        fileObjectId: "file_pending",
        status: "normalized_preview",
        scanResult: { sheets: [{ blocks: [{ detectedSupplementType: "reaction_rate_time_series" }] }] },
        normalizePreview: {
          datasetPatch: {
            genericImports: [{
              importId: "pending_import",
              observationSets: [{ kind: "reaction_rate_time_series", inferredExperimentLabel: "Exp31", observations: [{}, {}, {}] }],
              fields: [{}, {}],
            }],
          },
        },
        updatedAt: "2026-06-17T12:00:00.000Z",
      }],
    };
    render(
      <ProjectOverview
        projectState={stateWithSupplement}
        dataset={{
          genericImports: [
            { importId: "master", fileName: "master.xlsx" },
            {
              importId: "supplement",
              fileName: "rate.xlsx",
              relationship: { relationship: "supplement", supplementType: "reaction_rate_time_series", targetExperimentIds: ["exp_30"] },
              observationSets: [{ kind: "reaction_rate_time_series", inferredExperimentLabel: "Exp30", observations: Array.from({ length: 62 }, () => ({})) }],
              fields: [{}, {}, {}],
            },
          ],
        }}
        onOpenProfile={() => {}}
        onOpenImportReview={() => {}}
        onOpenRefreshWorkbook={() => {}}
        onOpenSupplementWorkbook={() => {}}
        onOpenSupplementManager={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText("2 supplemental files")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage supplemental workbooks" }).disabled).toBe(false);
    expect(screen.queryByText("rate.xlsx")).toBeNull();
    expect(screen.queryByText("pending-rate.xlsx")).toBeNull();
  });

  it("shows supplemental workbook details and review/edit actions in the manager modal", () => {
    const onAddSupplemental = vi.fn();
    const onContinueReview = vi.fn();
    const stateWithSupplement = {
      ...projectState,
      fileObjects: [{ id: "file_pending", originalName: "pending-rate.xlsx" }],
      importRuns: [{
        id: "run_pending",
        fileObjectId: "file_pending",
        status: "normalized_preview",
        scanResult: { sheets: [{ blocks: [{ detectedSupplementType: "reaction_rate_time_series" }] }] },
        normalizePreview: {
          datasetPatch: {
            genericImports: [{
              importId: "pending_import",
              observationSets: [{ kind: "reaction_rate_time_series", inferredExperimentLabel: "Exp31", observations: [{}, {}, {}] }],
              fields: [{}, {}],
            }],
          },
        },
        updatedAt: "2026-06-17T12:00:00.000Z",
      }],
    };
    const datasetWithSupplement = {
      genericImports: [
        { importId: "master", fileName: "master.xlsx" },
        {
          importId: "supplement",
          fileName: "rate.xlsx",
          relationship: { relationship: "supplement", supplementType: "reaction_rate_time_series", targetExperimentIds: ["exp_30"] },
          observationSets: [{
            kind: "reaction_rate_time_series",
            inferredExperimentLabel: "Exp30",
            yFields: ["adjustedRateMPerS"],
            observations: Array.from({ length: 62 }, () => ({})),
          }],
          fields: [{}, {}, {}],
          sources: [{}, {}],
        },
      ],
    };

    render(
      <SupplementalWorkbooksModal
        open
        projectState={stateWithSupplement}
        dataset={datasetWithSupplement}
        onAddSupplemental={onAddSupplemental}
        onContinueReview={onContinueReview}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Supplemental Workbooks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^rate\.xlsx/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /pending-rate\.xlsx/ })).toBeTruthy();
    expect(screen.getByText("adjustedRateMPerS")).toBeTruthy();
    expect(screen.getAllByText("Applied").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /pending-rate\.xlsx/ }));
    expect(screen.getAllByText("Needs relationship review").length).toBeGreaterThan(0);
    expect(screen.getByText("3 observations - 2 fields")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue review" }));
    expect(onContinueReview).toHaveBeenCalledWith("run_pending");

    fireEvent.click(screen.getByRole("button", { name: /^rate\.xlsx/ }));
    expect(screen.getByText(/Applied scientific values are immutable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace / edit via reviewed import" }));
    expect(onAddSupplemental).toHaveBeenCalledTimes(1);
  });

  it("opens compare series from the supplemental manager when compatible series exist", () => {
    const onCompareSeries = vi.fn();

    render(
      <SupplementalWorkbooksModal
        open
        projectState={projectStateWithCompareSeries}
        dataset={{ genericImports: [{ importId: "master", fileName: "master.xlsx" }] }}
        onAddSupplemental={() => {}}
        onCompareSeries={onCompareSeries}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Compare series" }));
    expect(onCompareSeries).toHaveBeenCalledTimes(1);
  });

  it("shows supplemental batch progress and selected ready apply actions", () => {
    const onContinueReview = vi.fn();
    const onRetryBatchItem = vi.fn();
    const onApplyBatchItems = vi.fn();
    const activeBatch = {
      id: "batch_1",
      status: "processing",
      summary: { total: 3, completed: 2, ready: 1, failed: 1, processing: 1 },
      items: [
        {
          id: "batch_item_ready",
          fileObjectId: "file_ready",
          importRunId: "run_ready",
          fileName: "Reaction_Rate_Exp30.xlsx",
          status: "ready_for_review",
          progressMessage: "Ready for relationship review.",
          relationshipPreview: {
            proposals: [{
              relationshipProposalId: "relationship_ready",
              proposedRelationship: "supplement",
              targetExperimentIds: ["exp_30"],
              supplementType: "reaction_rate_time_series",
            }],
          },
        },
        {
          id: "batch_item_resolving",
          fileObjectId: "file_resolving",
          fileName: "Reaction_Rate_Exp31.xlsx",
          status: "resolving_relationship",
          progressMessage: "AI is resolving experiment links...",
        },
        {
          id: "batch_item_failed",
          fileObjectId: "file_failed",
          fileName: "bad.xlsx",
          status: "failed",
          error: { message: "Workbook could not be parsed." },
        },
      ],
    };

    render(
      <SupplementalWorkbooksModal
        open
        projectState={projectState}
        dataset={{ genericImports: [{ importId: "master", fileName: "master.xlsx" }] }}
        activeBatch={activeBatch}
        onAddSupplemental={() => {}}
        onContinueReview={onContinueReview}
        onRetryBatchItem={onRetryBatchItem}
        onApplyBatchItems={onApplyBatchItems}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Batch processing")).toBeTruthy();
    expect(screen.getAllByText("AI is resolving experiment links...").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onContinueReview).toHaveBeenCalledWith("run_ready");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryBatchItem).toHaveBeenCalledWith("file_failed");
    fireEvent.click(screen.getByRole("button", { name: "Apply selected ready (1)" }));
    expect(onApplyBatchItems).toHaveBeenCalledWith([expect.objectContaining({ id: "batch_item_ready" })]);
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
        onOpenSupplementManager={() => {}}
        onOpenChartReview={() => {}}
        onGoManuscript={() => {}}
      />,
    );

    expect(screen.getByText("1 specs")).toBeTruthy();
    expect(screen.getByText(/older chart specs are hidden/)).toBeTruthy();
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
      project: { id: "project_1", currentDatasetCommitId: "commit_old" },
      currentDatasetCommit: { id: "commit_old" },
      chartSpecs: [{ id: "chart_old" }],
      manuscripts: [{
        id: "manuscript_1",
        blocks: [{ id: "local_unsaved", kind: "text", text: "Unsaved draft" }],
      }],
    };
    const incomingState = {
      project: { id: "project_1", currentDatasetCommitId: "commit_new" },
      currentDatasetCommit: { id: "commit_new" },
      chartSpecs: [{ id: "chart_new" }],
      manuscripts: [{
        id: "manuscript_1",
        blocks: [{ id: "server_stale", kind: "text", text: "Server copy" }],
      }],
    };

    const merged = mergeProjectStateForWorkspaceRefresh(currentState, incomingState, { preserveManuscripts: true });

    expect(merged.currentDatasetCommit.id).toBe("commit_new");
    expect(merged.chartSpecs.map((chartSpec) => chartSpec.id)).toEqual(["chart_new"]);
    expect(merged.manuscripts).toEqual(currentState.manuscripts);
  });

  it("uses incoming manuscripts for full project loads", () => {
    const currentState = { manuscripts: [{ id: "local" }] };
    const incomingState = { manuscripts: [{ id: "server" }] };

    expect(mergeProjectStateForWorkspaceRefresh(currentState, incomingState).manuscripts).toEqual([{ id: "server" }]);
  });
});

describe("MappingReviewModal", () => {
  it("edits semantic mapping draft fields and saves one mapping set", async () => {
    const onSaveMappings = vi.fn().mockResolvedValue({
      ...projectState.mappingSets[0],
      payload: {
        ...projectState.mappingSets[0].payload,
        mappings: [{
          ...projectState.mappingSets[0].payload.mappings[0],
          canonicalField: "temperature_C",
          semanticRole: "condition",
          status: "accepted",
        }],
      },
    });

    render(
      <MappingReviewModal
        open
        currentDatasetCommitId="commit_1"
        mappingSetRecord={projectState.mappingSets[0]}
        genericImports={[{ importId: "master", fileName: "master.xlsx" }]}
        onGenerateMappings={() => {}}
        onSaveMappings={onSaveMappings}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Edit semantic mappings" })).toBeTruthy();
    expect(screen.getByText("1 accepted")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Canonical field Temperature"), {
      target: { value: "temperature_C" },
    });
    fireEvent.change(screen.getByLabelText("Status Selectivity Gas"), {
      target: { value: "rejected" },
    });
    fireEvent.change(screen.getByLabelText("Semantic role Selectivity Gas"), {
      target: { value: "metadata" },
    });
    fireEvent.change(screen.getByLabelText("Unit Selectivity Gas"), {
      target: { value: "pct" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mappings" }));

    await waitFor(() => expect(onSaveMappings).toHaveBeenCalledTimes(1));
    const savedPayload = onSaveMappings.mock.calls[0][1];
    expect(savedPayload.mappings.find((mapping) => mapping.mappingId === "mapping_temp").canonicalField).toBe("temperature_C");
    const gas = savedPayload.mappings.find((mapping) => mapping.mappingId === "mapping_gas");
    expect(gas.status).toBe("rejected");
    expect(gas.semanticRole).toBe("metadata");
    expect(gas.unit).toBe("pct");
  });

  it("shows stale mapping warning and regenerates instead of saving old commit mappings", async () => {
    const onGenerateMappings = vi.fn().mockResolvedValue({
      ...projectState.mappingSets[0],
      datasetCommitId: "commit_2",
    });

    render(
      <MappingReviewModal
        open
        currentDatasetCommitId="commit_2"
        mappingSetRecord={{ ...projectState.mappingSets[0], datasetCommitId: "commit_old" }}
        genericImports={[{ importId: "master", fileName: "master.xlsx" }]}
        onGenerateMappings={onGenerateMappings}
        onSaveMappings={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/older dataset commit/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save mappings" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate for current dataset" }));

    await waitFor(() => expect(onGenerateMappings).toHaveBeenCalledTimes(1));
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

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, {
        target: { value: "upload supplement for Exp30" },
      });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(screen.getByText("Add supplemental workbook")).toBeTruthy());
      expect(screen.getByText("Target: Exp30")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Choose file" })).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/project_1/agent/plan", expect.objectContaining({ method: "POST" }));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("creates a compare series chart proposal from a chat action", async () => {
    localStorage.removeItem("labrat_blank_chat_history_v1_react");
    const onProjectStateLoaded = vi.fn();
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/agent/plan") {
        return jsonResponse({
          schemaVersion: "labrat.agentPlan.v1",
          reply: "I prepared a compare action.",
          actions: [{
            actionId: "agent_compare_1",
            type: "compare_series",
            status: "requires_confirmation",
            label: "Compare reaction-rate series",
            description: "Create a reviewed AnalysisView, then queue one chart proposal.",
            requiresFile: false,
            requiresReview: true,
            params: {
              prompt: "compare reaction rate for Exp30 and Exp31",
              viewType: "series_compare",
              title: "Reaction rate comparison",
              seriesKind: "reaction_rate_time_series",
              targetExperimentAliases: ["Exp30", "Exp31"],
              experimentIds: ["exp_30", "exp_31"],
              xField: "reaction_time_min",
              yField: "adjusted_rate_m_s",
              groupBy: "experiment",
            },
            warnings: [],
          }],
        });
      }
      if (url === "/api/projects/project_1/analysis-views") {
        expect(JSON.parse(init.body)).toEqual({
          viewType: "series_compare",
          title: "Reaction rate comparison",
          spec: {
            seriesKind: "reaction_rate_time_series",
            experimentIds: ["exp_30", "exp_31"],
            xField: "reaction_time_min",
            yField: "adjusted_rate_m_s",
            groupBy: "experiment",
          },
        });
        return jsonResponse({
          analysisView: {
            id: "analysis_view_compare_1",
            viewType: "series_compare",
            title: "Reaction rate comparison",
            spec: { experimentIds: ["exp_30", "exp_31"] },
          },
        }, { status: 201 });
      }
      if (url === "/api/analysis-views/analysis_view_compare_1/chart-proposal") {
        return jsonResponse({
          chartProposalSet: {
            id: "chart_set_compare_1",
            datasetCommitId: "commit_1",
            payload: {
              proposalSetId: "chart_set_compare_1",
              schemaVersion: "labrat.chartProposalSet.v1",
              proposals: [{
                proposalId: "chart_compare_1",
                status: "proposed",
                title: "Reaction rate comparison",
              }],
              warnings: [],
            },
          },
        }, { status: 201 });
      }
      if (url === "/api/projects/project_1/state") {
        return jsonResponse({
          ...projectStateWithCompareSeries,
          chartProposalSets: [{
            id: "chart_set_compare_1",
            datasetCommitId: "commit_1",
            payload: {
              proposalSetId: "chart_set_compare_1",
              schemaVersion: "labrat.chartProposalSet.v1",
              proposals: [{ proposalId: "chart_compare_1", status: "proposed", title: "Reaction rate comparison" }],
            },
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
          dataset={{ metadata: {}, experiments: [], genericImports: [{ importId: "import_1" }] }}
          blocks={[]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={projectStateWithCompareSeries}
          onProjectStateLoaded={onProjectStateLoaded}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, { target: { value: "compare reaction rate for Exp30 and Exp31" } });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(screen.getByText("Compare reaction-rate series")).toBeTruthy());
      expect(screen.getByText("Target: Exp30, Exp31")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Prepare" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Accept proposal" })).toBeTruthy());
      expect(screen.getByText("Chart: Reaction rate comparison")).toBeTruthy();
      expect(screen.getByText(/Queued chart proposal set chart_set_compare_1/)).toBeTruthy();
      expect(onProjectStateLoaded).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
      localStorage.removeItem("labrat_blank_chat_history_v1_react");
    }
  });

  it("accepts an interpreted chart proposal and creates a ChartSpec inside chat", async () => {
    localStorage.removeItem("labrat_blank_chat_history_v1_react");
    const onProjectStateLoaded = vi.fn();
    const onInsertChartSpec = vi.fn();
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/api/projects/project_1/agent/plan") {
        return jsonResponse({
          schemaVersion: "labrat.agentPlan.v1",
          reply: "I prepared a chart action.",
          actions: [{
            actionId: "agent_chart_1",
            type: "interpret_chart",
            status: "proposed",
            label: "Draft one chart proposal",
            description: "Interpret the request into a source-backed ChartSpec draft.",
            requiresFile: false,
            params: { prompt: "I want a reaction rate scatter plot for experiment 55" },
            warnings: [],
          }],
        });
      }
      if (url === "/api/projects/project_1/charts/interpret") {
        return jsonResponse({
          schemaVersion: "labrat.chartInterpretResponse.v1",
          chartSpecDraft: { title: "Reaction Rate Scatter for Experiment 55", chartType: "scatter" },
          chartProposalSet: {
            id: "chart_set_55",
            datasetCommitId: "commit_1",
            payload: {
              proposalSetId: "proposal_set_55",
              schemaVersion: "labrat.chartProposalSet.v1",
              proposals: [{
                proposalId: "proposal_55",
                status: "proposed",
                title: "Reaction Rate Scatter for Experiment 55",
              }],
              warnings: [],
            },
          },
          warnings: [],
        });
      }
      if (url === "/api/chart-proposal-sets/chart_set_55") {
        const body = JSON.parse(init.body);
        expect(body.payload.proposals[0].status).toBe("accepted");
        return jsonResponse({
          chartProposalSet: {
            id: "chart_set_55",
            datasetCommitId: "commit_1",
            payload: body.payload,
          },
        });
      }
      if (url === "/api/projects/project_1/chart-specs/from-proposal") {
        expect(JSON.parse(init.body)).toEqual({
          chartProposalSetId: "chart_set_55",
          proposalId: "proposal_55",
        });
        return jsonResponse({ chartSpec: { id: "chart_spec_55", title: "Reaction Rate Scatter for Experiment 55" } }, { status: 201 });
      }
      if (url === "/api/projects/project_1/state") {
        return jsonResponse({
          project: { id: "project_1", name: "Catalyst Screening", currentDatasetCommitId: "commit_1" },
          projectProfile: {},
          currentDatasetCommit: { id: "commit_1", datasetPayload: { genericImports: [] } },
          mappingSets: [],
          chartProposalSets: [],
          chartSpecs: [{ id: "chart_spec_55", title: "Reaction Rate Scatter for Experiment 55" }],
          manuscripts: [{ id: "manuscript_1", blocks: [{ id: "server_block" }] }],
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
          dataset={{ metadata: {}, experiments: [], genericImports: [{ importId: "import_1" }] }}
          blocks={[{ id: "local_unsaved", kind: "text" }]}
          setBlocks={() => {}}
          references={[]}
          selected={null}
          selectedChartContext={null}
          pendingChartAnalysis={null}
          activeProjectId="project_1"
          projectState={{ project: { id: "project_1", name: "Catalyst Screening" }, fileObjects: [] }}
          onProjectStateLoaded={onProjectStateLoaded}
          onInsertChartSpec={onInsertChartSpec}
        />,
      );

      const promptInput = screen.getByPlaceholderText("Ask the rat about your data, charts, or manuscript...");
      fireEvent.change(promptInput, {
        target: { value: "I want a reaction rate scatter plot for experiment 55" },
      });
      fireEvent.keyDown(promptInput, { key: "Enter", code: "Enter" });

      await waitFor(() => expect(screen.getByText("Draft one chart proposal")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Prepare" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Accept proposal" })).toBeTruthy());
      expect(screen.getByRole("button", { name: "Create ChartSpec" }).disabled).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Accept proposal" }));
      await waitFor(() => expect(screen.getByText("Proposal accepted")).toBeTruthy());
      expect(screen.getByRole("button", { name: "Create ChartSpec" }).disabled).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Create ChartSpec" }));
      await waitFor(() => expect(screen.getByText("ChartSpec created")).toBeTruthy());
      expect(screen.getByText(/Created ChartSpec chart_spec_55/)).toBeTruthy();
      await waitFor(() => expect(screen.getByRole("button", { name: "Insert into Manuscript" }).disabled).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Insert into Manuscript" }));
      expect(onInsertChartSpec).toHaveBeenCalledWith("chart_spec_55");
      expect(onProjectStateLoaded).toHaveBeenCalledTimes(3);
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
