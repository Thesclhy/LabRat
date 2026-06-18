import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { makePlot } from "./charts/makePlot";
import { BackendScanPanel, ChartReviewPanel } from "./components/BackendScanPanel";
import { BlankOnboarding } from "./components/BlankOnboarding";
import { ProjectProfileChat } from "./components/ProjectProfileChat.jsx";
import { ServerLogin } from "./components/ServerLogin.jsx";
import { ThinkingIndicator } from "./components/ThinkingIndicator.jsx";
import { GenericImportBrowser } from "./components/GenericImportBrowser";
import { Plot } from "./charts/Plot";
import { ManuscriptCanvas } from "./components/ManuscriptCanvas";
import { BLANK_PROJECT_SOURCE_NAME, blankTemplateLinks, isBlankDataMode } from "./data/appMode.js";
import { interpretChartWithBackend } from "./data/backendChartInterpretApi.js";
import { proposeChartsWithBackend } from "./data/backendChartProposalApi.js";
import { scanWorkbookWithBackend } from "./data/backendImportScanApi.js";
import { normalizeScanWithBackend } from "./data/backendImportNormalizeApi.js";
import { proposeSemanticMappingsWithBackend } from "./data/backendSemanticMappingApi.js";
import { proposeExcelMappingsFromScan } from "./data/aiExcelParserBoundary.js";
import { applyGenericImportPatch } from "./data/genericImportPatch.js";
import { buildGenericBrowserRows } from "./data/experimentBrowserRows.js";
import { getMasterImports, getSupplementalImports, hasMasterImport, isSupplementalImport, supplementalWorkbookSummariesForProject } from "./data/genericImportRelationships.js";
import { setChartProposalStatus, setMappingStatus, upsertGenericChartProposalSet, upsertGenericMappingSet } from "./data/genericProposalState.js";
import { createBlockReviewState, setBlockReviewDecision } from "./data/importBlockReviewState.js";
import { parseLocalExcelFolder } from "./data/masterTableImporter.js";
import { emptyDataset } from "./data/loadEmbeddedDataset.js";
import { resolveStartupProject } from "./data/startupProject.js";
import { uploadSupplementalFilesAsBatch } from "./data/supplementalBatchUpload.js";
import { scanExcelFolder } from "./data/workbookScanner.js";
import {
  applyServerImportRun,
  createServerAnalysisView,
  createServerAnalysisViewChartProposal,
  createServerChartSpecFromProposal,
  createServerImportRun,
  createServerManuscript,
  createServerMappingSet,
  createServerProject,
  createServerSupplementalImportBatch,
  deleteServerProject,
  getServerProjectState,
  getServerSession,
  getServerSupplementalImportBatch,
  interpretServerProjectChart,
  listServerLabs,
  listServerProjects,
  loginToServer,
  logoutFromServer,
  patchServerChartProposalSet,
  patchServerManuscript,
  patchServerMappingSet,
  patchServerProjectProfile,
  planServerProjectAgent,
  previewServerImportRelationship,
  previewServerImportRefresh,
  previewServerImportRunNormalization,
  proposeServerProjectCharts,
  resolveServerProjectDataQuery,
  supplementalImportBatchEventsUrl,
  uploadServerProjectFile,
} from "./data/serverApi.js";
import { ls } from "./storage/localStorage";
import { buildProjectRecord, loadActiveProject, normalizeProjectDataset, normalizeProjectRecord, saveActiveProject } from "./storage/projectStorage";
import { experimentDateSortValue, formatExperimentDateForDisplay } from "./utils/date.js";
import { expNo, fmt, uid } from "./utils/format";
import "./styles.css";

const BLANK_MODE = isBlankDataMode();

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function payloadWithServerId(record, idKey) {
  const payload = record?.payload && typeof record.payload === "object" ? record.payload : {};
  return {
    ...payload,
    serverId: record?.id || payload.serverId || null,
    [idKey]: payload[idKey] || record?.id || payload.serverId || null,
  };
}

function decisionSummary(items = []) {
  const values = asArray(items);
  return {
    accepted: values.filter((item) => item?.status === "accepted").length,
    rejected: values.filter((item) => item?.status === "rejected").length,
    proposed: values.filter((item) => !item?.status || item.status === "proposed").length,
    decisions: values
      .filter((item) => item?.proposalId || item?.mappingId)
      .map((item) => ({
        proposalId: item.proposalId,
        mappingId: item.mappingId,
        status: item.status || "proposed",
      })),
  };
}

function datasetFromServerProjectState(projectState) {
  const payload = projectState?.currentDatasetCommit?.datasetPayload || {};
  return normalizeProjectDataset({
    ...emptyDataset(),
    ...payload,
    genericImports: asArray(payload.genericImports),
    genericMappingSets: asArray(projectState?.mappingSets).map((set) => payloadWithServerId(set, "mappingSetId")),
    genericChartProposals: asArray(projectState?.chartProposalSets).map((set) => payloadWithServerId(set, "proposalSetId")),
  });
}

export function mergeProjectStateForWorkspaceRefresh(currentState, incomingState, options = {}) {
  if (!incomingState) return currentState || null;
  if (!options.preserveManuscripts) return incomingState;
  return {
    ...incomingState,
    manuscripts: currentState?.manuscripts ?? incomingState.manuscripts,
  };
}

function itemTimestamp(item) {
  const candidates = [
    item?.updatedAt,
    item?.createdAt,
    item?.savedAt,
  ];
  for (const value of candidates) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

export function latestItem(items) {
  const values = asArray(items);
  if (!values.length) return null;
  let fallback = values.at(-1) || null;
  let latest = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  values.forEach((item) => {
    const timestamp = itemTimestamp(item);
    if (timestamp == null) return;
    if (!latest || timestamp > latestTimestamp) {
      latest = item;
      latestTimestamp = timestamp;
    }
  });
  return latest || fallback;
}

function emptyRefreshDraft() {
  return {
    open: false,
    replaceImportId: "",
    expectedParentDatasetCommitId: "",
    targetImport: null,
    preview: null,
    loading: false,
    error: "",
  };
}

function emptyRelationshipDraft() {
  return {
    preview: null,
    selectedProposalId: "",
    loading: false,
    error: "",
  };
}

function emptySupplementalBatchState() {
  return {
    activeBatchId: "",
    batch: null,
    uploading: false,
    applying: false,
    error: "",
    usePolling: false,
    sseFailures: 0,
  };
}

function selectableRelationshipProposals(preview) {
  return asArray(preview?.proposals).filter((proposal) => (
    proposal?.proposedRelationship === "supplement"
    && asArray(proposal.targetExperimentIds).length > 0
  ));
}

function scanBlockIds(scanResult) {
  return asArray(scanResult?.sheets).flatMap((sheet) => asArray(sheet?.blocks).map((block) => block?.blockId).filter(Boolean));
}

function summarizeNormalizePreview(normalizePreview) {
  const imports = asArray(normalizePreview?.datasetPatch?.genericImports);
  return {
    importCount: imports.length,
    experimentCount: normalizePreview?.summary?.createdExperiments ?? imports.reduce((total, item) => total + asArray(item?.experiments).length, 0),
    fieldCount: normalizePreview?.summary?.createdFields ?? imports.reduce((total, item) => total + asArray(item?.fields).length, 0),
    measurementCount: normalizePreview?.summary?.createdMeasurements ?? imports.reduce((total, item) => total + asArray(item?.measurements).length, 0),
    warningCount: normalizePreview?.summary?.warningCount ?? imports.reduce((total, item) => total + asArray(item?.warnings).length, 0),
  };
}

const SEMANTIC_ROLE_OPTIONS = ["identifier", "time", "condition", "response", "material", "metadata", "note", "replicate"];
const MAPPING_STATUS_OPTIONS = ["proposed", "accepted", "rejected"];

function mappingPayloadFromRecord(record) {
  if (!record) return null;
  return payloadWithServerId(record, "mappingSetId");
}

function mappingSetForDatasetCommit(projectState, datasetCommitId) {
  const mappingSets = asArray(projectState?.mappingSets);
  if (!mappingSets.length) return null;
  const currentCommitSets = datasetCommitId
    ? mappingSets.filter((set) => set?.datasetCommitId === datasetCommitId)
    : [];
  return latestItem(currentCommitSets) || latestItem(mappingSets);
}

function mappingSetIsStale(mappingSet, datasetCommitId) {
  return !!(mappingSet?.datasetCommitId && datasetCommitId && mappingSet.datasetCommitId !== datasetCommitId);
}

function mappingCounts(mappingSet) {
  const mappings = asArray(mappingSet?.payload?.mappings || mappingSet?.mappings);
  return {
    total: mappings.length,
    accepted: mappings.filter((mapping) => mapping?.status === "accepted").length,
    rejected: mappings.filter((mapping) => mapping?.status === "rejected").length,
    proposed: mappings.filter((mapping) => !mapping?.status || mapping.status === "proposed").length,
  };
}

function proposalPayloadFromRecord(record) {
  if (!record) return null;
  return payloadWithServerId(record, "proposalSetId");
}

function latestChartProposalSetForProject(projectState) {
  return proposalPayloadFromRecord(latestItem(projectState?.chartProposalSets));
}

function pendingChartProposalsForProject(projectState, limit = 3) {
  const proposalSet = latestChartProposalSetForProject(projectState);
  const pending = asArray(proposalSet?.proposals).filter((proposal) => !proposal?.status || proposal.status === "proposed");
  return {
    proposals: pending.slice(0, limit),
    remaining: Math.max(0, pending.length - limit),
    total: pending.length,
  };
}

function activeChartProposalSummaryForProject(projectState) {
  const proposalSet = latestChartProposalSetForProject(projectState);
  const proposals = asArray(proposalSet?.proposals);
  const pending = proposals.filter((proposal) => !proposal?.status || proposal.status === "proposed").length;
  const accepted = proposals.filter((proposal) => proposal?.status === "accepted").length;
  return {
    accepted,
    pending,
    total: accepted + pending,
  };
}

function genericImportLabel(genericImport) {
  if (!genericImport) return "Imported workbook";
  return genericImport.fileName
    || genericImport.files?.[0]?.name
    || genericImport.files?.[0]?.fileName
    || genericImport.importId
    || "Imported workbook";
}

function genericImportExperimentCount(genericImport) {
  return asArray(genericImport?.experiments).length;
}

function genericImportFieldCount(genericImport) {
  const fields = asArray(genericImport?.fields);
  if (fields.length) return fields.length;
  const labels = new Set();
  asArray(genericImport?.measurements).forEach((measurement) => {
    const key = measurement?.fieldId || measurement?.displayName || measurement?.rawLabel || measurement?.measurementId;
    if (key) labels.add(key);
  });
  return labels.size;
}

function genericImportObservationCount(genericImport) {
  return asArray(genericImport?.observationSets).reduce((total, set) => (
    total + (set?.summary?.observationCount ?? asArray(set?.observations).length)
  ), 0);
}

function genericImportLineageText(genericImport) {
  const metadata = genericImport?.refreshMetadata || {};
  const parentImportId = genericImport?.refreshOfImportId || metadata.refreshOfImportId || "";
  const appliedAt = metadata.appliedAt || genericImport?.refreshedAt || "";
  if (!parentImportId && !appliedAt) return "";
  const parts = [];
  if (parentImportId) parts.push(`refreshed from ${parentImportId}`);
  if (appliedAt) parts.push(`applied ${formatShortDate(appliedAt)}`);
  return parts.join(" - ");
}

function refreshErrorMessage(error) {
  if (error?.code === "refresh_no_changes_detected") return "No changes detected.";
  if (error?.code === "dataset_commit_conflict") return "Project data changed; reload project and try again.";
  if (error?.code === "refresh_target_not_found") return "The selected import no longer exists. Choose another refresh target.";
  return error?.message || String(error);
}

function upsertServerRecordById(items, incoming) {
  if (!incoming?.id) return asArray(items);
  const values = asArray(items);
  const index = values.findIndex((item) => item?.id === incoming.id);
  if (index < 0) return [...values, incoming];
  return values.map((item, itemIndex) => itemIndex === index ? incoming : item);
}

function formatShortDate(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function completedProfileFields(projectProfile) {
  const profile = projectProfile || {};
  return ["researchGoal", "experimentBackground", "materials", "methods", "instruments", "analysisNotes", "tags"]
    .filter((key) => Array.isArray(profile[key]) ? profile[key].length : String(profile[key] || "").trim()).length;
}

function projectCurrentDatasetCommitId(projectState) {
  return projectState?.currentDatasetCommit?.id || projectState?.project?.currentDatasetCommitId || null;
}

function isActiveChartSpecForProject(chartSpec, projectState) {
  if (!chartSpec) return false;
  if (chartSpec.isStale || chartSpec.status === "stale") return false;
  const currentCommitId = projectCurrentDatasetCommitId(projectState);
  if (chartSpec.datasetCommitId && currentCommitId && chartSpec.datasetCommitId !== currentCommitId) return false;
  return true;
}

export function activeChartSpecsForProject(projectState) {
  return asArray(projectState?.chartSpecs).filter((chartSpec) => isActiveChartSpecForProject(chartSpec, projectState));
}

export function activeObservationSeriesForProject(projectState) {
  const currentCommitId = projectCurrentDatasetCommitId(projectState);
  return asArray(projectState?.observationSeries).filter((series) => (
    series?.experimentId
    && series?.datasetCommitId
    && (!currentCommitId || series.datasetCommitId === currentCommitId)
    && !series.isStale
    && series.status !== "stale"
  ));
}

function seriesAxisLabel(series, axis) {
  const label = axis === "x" ? series?.xLabel : series?.yLabel;
  const field = axis === "x" ? series?.xField : series?.yField;
  const unit = axis === "x" ? series?.xUnit : series?.yUnit;
  return [label || field || "field", unit ? `(${unit})` : ""].filter(Boolean).join(" ");
}

export function buildCompareSeriesGroups(projectState) {
  const groups = new Map();
  activeObservationSeriesForProject(projectState).forEach((series) => {
    if (!series.seriesKind || !series.xField || !series.yField) return;
    const key = [series.seriesKind, series.xField, series.yField].join("|");
    const group = groups.get(key) || {
      key,
      seriesKind: series.seriesKind,
      xField: series.xField,
      yField: series.yField,
      xLabel: seriesAxisLabel(series, "x"),
      yLabel: seriesAxisLabel(series, "y"),
      series: [],
    };
    if (!group.series.some((item) => item.experimentId === series.experimentId)) {
      group.series.push(series);
    }
    groups.set(key, group);
  });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      series: group.series.sort((a, b) => {
        const byNumber = expNo(a.experimentLabel) - expNo(b.experimentLabel);
        if (Number.isFinite(byNumber) && byNumber !== 0) return byNumber;
        return String(a.experimentLabel || a.experimentId).localeCompare(String(b.experimentLabel || b.experimentId));
      }),
    }))
    .sort((a, b) => b.series.length - a.series.length || a.yLabel.localeCompare(b.yLabel));
}

function staleChartSpecCountForProject(projectState) {
  return asArray(projectState?.chartSpecs).filter((chartSpec) => chartSpec && !isActiveChartSpecForProject(chartSpec, projectState)).length;
}

function projectWorkflowSummary(project, state = null) {
  const projectProfile = state?.projectProfile || project?.projectProfile || {};
  const profileCount = completedProfileFields(projectProfile);
  const hasDataset = !!(state?.currentDatasetCommit?.id || project?.currentDatasetCommitId);
  const importRuns = asArray(state?.importRuns);
  const latestImportRun = latestItem(importRuns);
  const chartProposalSets = asArray(state?.chartProposalSets);
  const proposalPayloads = chartProposalSets.flatMap((set) => asArray(set?.payload?.proposals));
  const acceptedCharts = proposalPayloads.filter((proposal) => proposal.status === "accepted").length;
  const chartSpecs = activeChartSpecsForProject(state);
  const staleChartSpecs = staleChartSpecCountForProject(state);
  const manuscripts = asArray(state?.manuscripts);
  return {
    profileCount,
    profileComplete: profileCount >= 3,
    hasDataset,
    importStatus: latestImportRun?.status || (hasDataset ? "applied" : "not started"),
    chartProposalCount: proposalPayloads.length,
    acceptedCharts,
    chartSpecCount: chartSpecs.length,
    staleChartSpecCount: staleChartSpecs,
    manuscriptCount: manuscripts.length,
    manuscriptUpdatedAt: latestItem(manuscripts)?.updatedAt || null,
  };
}

function ProjectStatusChip({ tone = "neutral", children }) {
  return <span className={`project-status-chip ${tone}`}>{children}</span>;
}

function ProjectSwitcher({
  user,
  labs,
  activeLabId,
  onLabChange,
  projects,
  activeProjectId,
  onProjectChange,
  onOpenDashboard,
  onCreateProject,
  onOpenProfile,
  onOpenImportReview,
  hasImportReview,
  onLogout,
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const activeLab = labs.find((lab) => (lab.id || lab.labId) === activeLabId) || null;
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;
  const labName = activeLab?.name || "No lab";
  const projectName = activeProject?.name || "No project";
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <div className="project-switcher" ref={menuRef}>
      <div className="project-switcher-context" aria-label="Current lab and project" title={`${labName} / ${projectName}`}>
        <span>{labName}</span>
        <strong>{projectName}</strong>
      </div>
      <button
        type="button"
        className="project-file-button"
        aria-label="File menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        File
      </button>
      {open && (
        <div className="project-switcher-menu" role="menu">
          <div className="project-switcher-user">
            <span>{user?.displayName || user?.username || "Signed in"}</span>
            <small>{user?.username || "workspace"}</small>
          </div>
          <label>
            <span>Lab</span>
            <select value={activeLabId || ""} onChange={(event) => { onLabChange?.(event.target.value); close(); }}>
              {labs.map((lab) => <option key={lab.id || lab.labId} value={lab.id || lab.labId}>{lab.name}</option>)}
            </select>
          </label>
          <label>
            <span>Project</span>
            <select value={activeProjectId || ""} onChange={(event) => { onProjectChange?.(event.target.value); close(); }}>
              <option value="">Select project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <div className="project-switcher-actions">
            <button type="button" onClick={() => { close(); onOpenDashboard?.(); }}>Projects</button>
            <button type="button" onClick={() => { close(); onCreateProject?.(); }}>New project</button>
            <button type="button" disabled={!activeProjectId} onClick={() => { close(); onOpenProfile?.(); }}>Profile</button>
            <button type="button" disabled={!hasImportReview || !activeProjectId} onClick={() => { close(); onOpenImportReview?.(); }}>Import workbook</button>
            <button type="button" onClick={() => { close(); onLogout?.(); }}>Logout</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar({
  tab,
  setTab,
  workspaceMode,
  onOpenDashboard,
  dirty,
  onSave,
  onAgent,
  dataset,
  sourceName,
  loadingSource,
  sourceError,
  onOpenImportReview,
  hasImportReview,
  blankMode,
  user,
  labs,
  activeLabId,
  onLabChange,
  projects,
  activeProjectId,
  onProjectChange,
  onCreateProject,
  onOpenProfile,
  onLogout,
}) {
  const showProjectTabs = workspaceMode !== "dashboard" && !!activeProjectId;
  const showProjectSwitcher = workspaceMode !== "dashboard";
  return (
    <header className="topbar">
      <div className="brand"><img className="brand-logo" src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="LabRat" /><span className="brand-word">LabRat</span><span className="sub">&middot; Your AI Research Assistant</span></div>
      <nav className="tabs">
        {showProjectTabs && [["overview", "Overview"], ["browser", "Browser"], ["manuscript", "Manuscript"], ["reference", "Refs"]].map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>
      <div className="top-actions" aria-label="Workspace actions">
        {sourceError && <span className="topbar-status bad-src" title={sourceError}>{sourceError}</span>}
        {showProjectSwitcher && (
          <ProjectSwitcher
            user={user}
            labs={labs}
            activeLabId={activeLabId}
            onLabChange={onLabChange}
            projects={projects}
            activeProjectId={activeProjectId}
            onProjectChange={onProjectChange}
            onOpenDashboard={onOpenDashboard}
            onCreateProject={onCreateProject}
            onOpenProfile={onOpenProfile}
            onOpenImportReview={onOpenImportReview}
            hasImportReview={hasImportReview}
            onLogout={onLogout}
          />
        )}
        <button className="agent-btn" type="button" onClick={onAgent}>
          <img src={`${import.meta.env.BASE_URL}labrat-logo.png`} alt="" />
          <span>Ask</span>
        </button>
      </div>
    </header>
  );
}

export function ProjectDashboard({
  user,
  labs,
  activeLabId,
  onLabChange,
  projects,
  selectedProjectId,
  onSelectProject,
  onOpenProject,
  onCreateProject,
  onRequestDeleteProject,
  activeProjectId,
  projectState,
  projectStateLoading,
  sourceError,
}) {
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
    || projects.find((project) => project.id === activeProjectId)
    || projects[0]
    || null;
  const selectedIsLoaded = !!selectedProject && selectedProject.id === projectState?.project?.id;
  const summary = projectWorkflowSummary(selectedProject, selectedIsLoaded ? projectState : null);
  const projectRows = projects.map((project) => ({
    project,
    summary: projectWorkflowSummary(project, project.id === projectState?.project?.id ? projectState : null),
  }));
  return (
    <main className="project-dashboard">
      <aside className="project-dashboard-rail">
        <div>
          <h2>Labs</h2>
          <p>{user?.displayName || user?.username || "Signed in"}</p>
        </div>
        <div className="lab-list">
          {labs.map((lab) => {
            const labId = lab.id || lab.labId;
            return (
              <button
                type="button"
                key={labId}
                className={labId === activeLabId ? "active" : ""}
                onClick={() => onLabChange?.(labId)}
              >
                <span>{lab.name}</span>
                <small>{lab.role || "member"}</small>
              </button>
            );
          })}
        </div>
        <button type="button" className="wide-action primary" disabled={!activeLabId} onClick={onCreateProject}>New project</button>
      </aside>

      <section className="project-dashboard-list">
        <div className="project-dashboard-head">
          <div>
            <h1>Projects</h1>
            <p>{projects.length ? `${projects.length} project${projects.length === 1 ? "" : "s"} in this lab` : "Create your first research project."}</p>
          </div>
          <button type="button" className="primary" disabled={!activeLabId} onClick={onCreateProject}>New project</button>
        </div>
        {sourceError && <p className="import-review-error">{sourceError}</p>}
        {projects.length ? (
          <div className="project-table" role="table" aria-label="Projects">
            <div className="project-table-row header" role="row">
              <span>Project</span>
              <span>Progress</span>
              <span>Data</span>
              <span>Charts</span>
              <span>Updated</span>
              <span />
            </div>
            {projectRows.map(({ project, summary: rowSummary }) => (
              <div
                role="row"
                tabIndex={0}
                key={project.id}
                className={`project-table-row ${selectedProject?.id === project.id ? "active" : ""}`}
                onClick={() => onSelectProject?.(project.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectProject?.(project.id);
                  }
                }}
              >
                <span className="project-name-cell">
                  <strong>{project.name}</strong>
                  <small>{project.projectProfile?.researchGoal || project.description || "No research goal yet"}</small>
                </span>
                <span className="project-progress-cell">
                  <ProjectStatusChip tone={rowSummary.profileComplete ? "good" : "warn"}>Profile {rowSummary.profileCount}/7</ProjectStatusChip>
                  <ProjectStatusChip tone={rowSummary.manuscriptCount ? "good" : "neutral"}>{rowSummary.manuscriptCount ? "Manuscript" : "No manuscript"}</ProjectStatusChip>
                </span>
                <span>{rowSummary.hasDataset ? "Dataset committed" : "No data"}</span>
                <span>{rowSummary.chartSpecCount} specs</span>
                <span>{formatShortDate(project.updatedAt)}</span>
                <span className="project-open-cell">
                  <button
                    type="button"
                    className="project-row-open"
                    disabled={projectStateLoading && project.id === activeProjectId}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectProject?.(project.id);
                      onOpenProject?.(project.id);
                    }}
                  >
                    {projectStateLoading && project.id === activeProjectId ? "Opening..." : "Open"}
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="project-dashboard-empty">
            <h2>No projects yet</h2>
            <p>Start a project for a research topic, then upload data and create reviewed chart specs.</p>
            <button type="button" className="primary" disabled={!activeLabId} onClick={onCreateProject}>New project</button>
          </div>
        )}
      </section>

      <aside className="project-detail-panel">
        {selectedProject ? (
          <>
            <div className="project-detail-head">
              <span>{selectedProject.status || "active"}</span>
              <h2>{selectedProject.name}</h2>
              <p>{selectedProject.projectProfile?.researchGoal || selectedProject.description || "No project background saved yet."}</p>
            </div>
            <div className="project-detail-metrics">
              <div><strong>{summary.profileCount}/7</strong><span>Profile fields</span></div>
              <div><strong>{summary.hasDataset ? "Yes" : "No"}</strong><span>Dataset commit</span></div>
              <div><strong>{summary.chartSpecCount}</strong><span>Chart specs</span></div>
              <div><strong>{summary.manuscriptCount}</strong><span>Manuscripts</span></div>
            </div>
            <div className="project-flow-stack">
              <ProjectFlowItem done={summary.profileComplete} label="Project background" detail={summary.profileComplete ? "Ready for AI context" : "Needs more context"} />
              <ProjectFlowItem done={summary.hasDataset} label="Dataset" detail={summary.hasDataset ? "Current commit available" : "Upload and apply import"} />
              <ProjectFlowItem done={summary.chartSpecCount > 0} label="Approved charts" detail={summary.chartSpecCount ? `${summary.chartSpecCount} chart specs` : `${summary.chartProposalCount} proposals, ${summary.acceptedCharts} accepted`} />
              <ProjectFlowItem done={summary.manuscriptCount > 0} label="Manuscript" detail={summary.manuscriptUpdatedAt ? `Updated ${formatShortDate(summary.manuscriptUpdatedAt)}` : "Not started"} />
            </div>
            <div className="project-detail-actions">
              <button
                type="button"
                className="danger-subtle"
                onClick={() => onRequestDeleteProject?.(selectedProject)}
              >
                Delete project
              </button>
            </div>
          </>
        ) : (
          <div className="project-dashboard-empty compact">
            <h2>No project selected</h2>
            <p>Create a project to start collecting experiment context and data.</p>
          </div>
        )}
      </aside>
    </main>
  );
}

function ProjectFlowItem({ done, label, detail }) {
  return (
    <div className={`project-flow-item ${done ? "done" : ""}`}>
      <span aria-hidden="true">{done ? "OK" : "--"}</span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export function ProjectOverview({ projectState, dataset, onOpenProfile, onOpenImportReview, onOpenRefreshWorkbook, onOpenSupplementWorkbook, onOpenSupplementManager, onOpenCompareSeries, onOpenMappingReview, onOpenChartReview, onGoManuscript }) {
  const summary = projectWorkflowSummary(projectState?.project, projectState);
  const masterImports = getMasterImports(dataset);
  const supplementalImports = getSupplementalImports(dataset);
  const supplementalSummaries = supplementalWorkbookSummariesForProject(projectState, dataset);
  const compareSeriesGroups = buildCompareSeriesGroups(projectState);
  const hasMaster = masterImports.length > 0;
  const currentCommitId = projectState?.currentDatasetCommit?.id || projectState?.project?.currentDatasetCommitId || "";
  const mappingSet = mappingSetForDatasetCommit(projectState, currentCommitId);
  const mappingStats = mappingCounts(mappingSet);
  const mappingStale = mappingSetIsStale(mappingSet, currentCommitId);
  const canRefreshWorkbook = !!(projectState?.currentDatasetCommit?.id || projectState?.project?.currentDatasetCommitId)
    && hasMaster;
  const canAddSupplementalWorkbook = canRefreshWorkbook;
  const canEditMappings = !!currentCommitId && hasMaster;
  const mappingDetail = !hasMaster
    ? "Upload the master table before reviewing semantic mappings"
    : !mappingSet
      ? "Generate mappings for Browser columns and chart inputs"
      : mappingStale
        ? "Mappings are from an older dataset commit; regenerate before editing"
        : `${mappingStats.proposed} proposed, ${mappingStats.rejected} rejected`;
  const pendingChartProposals = pendingChartProposalsForProject(projectState);
  const activeChartProposalSummary = activeChartProposalSummaryForProject(projectState);
  const chartDetail = summary.staleChartSpecCount
    ? `${summary.chartProposalCount} proposals, ${summary.acceptedCharts} accepted. Some older chart specs are hidden until regenerated.`
    : `${summary.chartProposalCount} proposals, ${summary.acceptedCharts} accepted`;
  const nextAction = !summary.profileComplete
    ? { label: "Edit profile", action: onOpenProfile }
    : !summary.hasDataset
      ? { label: "Import workbook", action: onOpenImportReview }
    : !summary.chartSpecCount
        ? { label: "Review chart proposals", action: onOpenChartReview }
        : { label: "Build manuscript", action: onGoManuscript };
  return (
    <main className="project-overview">
      <section className="project-overview-hero">
        <div>
          <h1>{projectState?.project?.name || "Project overview"}</h1>
          <p>{projectState?.projectProfile?.researchGoal || "Complete the project profile so later chart and manuscript suggestions have context."}</p>
        </div>
        <button type="button" className="primary" onClick={nextAction.action}>{nextAction.label}</button>
      </section>
      <section className="project-overview-grid">
        <ProjectOverviewCard title="Project profile" value={`${summary.profileCount}/7`} detail={summary.profileComplete ? "Enough context for chart AI" : "Add research goal, materials, methods, and analysis notes"} action="Edit profile" onClick={onOpenProfile} />
        <ProjectOverviewCard
          title="Master Dataset"
          value={hasMaster ? "1 master table" : "No master table"}
          detail={hasMaster ? `Master imports active: ${masterImports.length}. Import status: ${summary.importStatus}` : "Upload one reviewed MasterTable before adding supplemental workbooks"}
          action="Upload master table"
          onClick={onOpenImportReview}
          actionDisabled={hasMaster}
          actionTitle={hasMaster ? "A project can have one active master table. Use refresh to replace it." : "Upload the project master table"}
          secondaryAction="Refresh master table"
          onSecondaryClick={onOpenRefreshWorkbook}
          secondaryDisabled={!canRefreshWorkbook}
          secondaryTitle={canRefreshWorkbook ? "Replace the committed master table with a reviewed workbook refresh" : "Refresh requires a committed master table"}
        />
        <ProjectOverviewCard
          title="Supplemental Workbooks"
          value={`${supplementalSummaries.length} supplemental files`}
          detail={hasMaster ? "Attach extra Excel files to existing experiments through relationship review" : "Upload a master table before adding supplemental files"}
          action="Add supplemental workbook"
          onClick={onOpenSupplementWorkbook}
          actionDisabled={!canAddSupplementalWorkbook}
          actionTitle={canAddSupplementalWorkbook ? "Upload an extra workbook and link it to existing experiments" : "Supplemental uploads require a committed master table"}
          secondaryAction="Manage supplemental workbooks"
          onSecondaryClick={onOpenSupplementManager}
          secondaryDisabled={!hasMaster && !supplementalSummaries.length}
          secondaryTitle={hasMaster || supplementalSummaries.length ? "Browse supplemental workbook details and review/edit options" : "Supplemental workbooks require a committed master table"}
        >
          <CompareSeriesOverviewAction groups={compareSeriesGroups} onClick={onOpenCompareSeries} />
        </ProjectOverviewCard>
        <ProjectOverviewCard
          title="Semantic mappings"
          value={mappingSet ? `${mappingStats.accepted}/${mappingStats.total} accepted` : "No mappings"}
          detail={mappingDetail}
          action="Edit mappings"
          onClick={onOpenMappingReview}
          actionDisabled={!canEditMappings}
          actionTitle={canEditMappings ? "Edit accepted fields for Browser columns and chart inputs" : "Mappings require a committed master table"}
        />
        <ProjectOverviewCard title="Charts" value={`${summary.chartSpecCount} specs`} detail={chartDetail} action="Review chart proposals" onClick={onOpenChartReview}>
          <ActiveChartProposalButton
            summary={activeChartProposalSummary}
            onClick={() => onOpenChartReview?.({ statusFilter: "active" })}
          />
          <PendingChartProposalList
            proposals={pendingChartProposals.proposals}
            remaining={pendingChartProposals.remaining}
            onEditProposal={(proposalId) => onOpenChartReview?.(proposalId)}
          />
        </ProjectOverviewCard>
        <ProjectOverviewCard title="Manuscript" value={summary.manuscriptCount ? "Draft" : "Not started"} detail={summary.manuscriptUpdatedAt ? `Updated ${formatShortDate(summary.manuscriptUpdatedAt)}` : "Insert approved chart specs into the canvas"} action="Open manuscript" onClick={onGoManuscript} />
      </section>
    </main>
  );
}

function supplementStatusLabel(status) {
  if (status === "applied") return "Applied";
  if (status === "normalized_preview") return "Needs relationship review";
  if (status === "review_ready") return "Pending review";
  if (status === "failed") return "Failed";
  return status ? String(status).replace(/_/g, " ") : "Pending";
}

function supplementStatusClass(status) {
  if (status === "applied") return "applied";
  if (status === "failed") return "failed";
  return "pending";
}

function supplementalTargetsText(item = {}) {
  return item.targetLabels?.length ? item.targetLabels.join(", ") : "No linked experiment yet";
}

function supplementalCountText(item = {}) {
  const countParts = [
    item.observationCount ? `${item.observationCount} observations` : "",
    item.fieldCount ? `${item.fieldCount} fields` : "",
    item.sourceCount ? `${item.sourceCount} sources` : "",
  ].filter(Boolean);
  return countParts.join(" - ") || "No parsed counts";
}

function batchItemStatusLabel(status) {
  if (status === "ready_for_review") return "Ready for review";
  if (status === "resolving_relationship") return "Resolving";
  return supplementStatusLabel(status);
}

function selectableRelationshipForBatchItem(item = {}) {
  const proposals = asArray(item.relationshipPreview?.proposals);
  return proposals.find((proposal) => (
    proposal?.proposedRelationship === "supplement"
    && asArray(proposal.targetExperimentIds).length > 0
  )) || null;
}

function batchItemReadyForApply(item = {}) {
  return item.status === "ready_for_review" && item.importRunId && selectableRelationshipForBatchItem(item);
}

function mergeSupplementalBatches(projectState, activeBatch) {
  const batches = [];
  if (activeBatch?.id) batches.push(activeBatch);
  asArray(projectState?.supplementalImportBatches).forEach((batch) => {
    if (!batches.some((item) => item.id === batch.id)) batches.push(batch);
  });
  return batches;
}

function SupplementalBatchPanel({ batches, selectedItemIds, onSelectionChange, onReviewItem, onRetryItem, onApplySelected, applying }) {
  const visibleBatches = asArray(batches).filter((batch) => asArray(batch.items).length);
  if (!visibleBatches.length) return null;
  const selectedCount = selectedItemIds.size;
  return (
    <section className="supplemental-batch-panel" aria-label="Supplemental batch progress">
      <div className="supplemental-batch-head">
        <div>
          <strong>Batch processing</strong>
          <span>Review-ready files are prepared, but not applied until you approve them.</span>
        </div>
        <button type="button" className="primary" disabled={!selectedCount || applying} onClick={onApplySelected}>
          {applying ? "Applying..." : `Apply selected ready (${selectedCount})`}
        </button>
      </div>
      {visibleBatches.map((batch) => (
        <div className="supplemental-batch-card" key={batch.id}>
          <div className="supplemental-batch-title">
            <strong>{batch.summary?.completed || 0}/{batch.summary?.total || batch.items.length} processed</strong>
            <span className={`supplemental-status ${supplementStatusClass(batch.status)}`}>{batchItemStatusLabel(batch.status)}</span>
          </div>
          <div className="supplemental-batch-items">
            {asArray(batch.items).map((item) => {
              const ready = batchItemReadyForApply(item);
              const selected = selectedItemIds.has(item.id);
              const resolving = item.status === "resolving_relationship";
              return (
                <article className={`supplemental-batch-item is-${item.status}`} key={item.id}>
                  <label className="supplemental-batch-select">
                    <input
                      type="checkbox"
                      disabled={!ready || applying}
                      checked={ready && selected}
                      onChange={(event) => onSelectionChange?.(item.id, event.target.checked)}
                    />
                    <span>
                      <strong>{item.fileName || "Supplemental workbook"}</strong>
                      <small>{item.progressMessage || batchItemStatusLabel(item.status)}</small>
                    </span>
                  </label>
                  <span className={`supplemental-status ${supplementStatusClass(item.status)}`}>{batchItemStatusLabel(item.status)}</span>
                  {resolving && <ThinkingIndicator text="AI is resolving experiment links..." />}
                  {item.error && <p className="import-review-error">{item.error.message || item.error.code}</p>}
                  <div className="supplemental-batch-actions">
                    {item.importRunId && item.status !== "failed" && (
                      <button type="button" onClick={() => onReviewItem?.(item.importRunId)}>Review</button>
                    )}
                    {item.status === "failed" && item.fileObjectId && (
                      <button type="button" onClick={() => onRetryItem?.(item.fileObjectId)}>Retry</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

export function SupplementalWorkbooksModal({ open, projectState, dataset, activeBatch, batchUploading = false, batchApplying = false, batchError = "", onAddSupplemental, onCompareSeries, onContinueReview, onRetryBatchItem, onApplyBatchItems, onClose }) {
  const summaries = supplementalWorkbookSummariesForProject(projectState, dataset);
  const summaryIds = summaries.map((item) => item.id).join("|");
  const [selectedId, setSelectedId] = useState("");
  const batches = mergeSupplementalBatches(projectState, activeBatch);
  const compareGroups = buildCompareSeriesGroups(projectState);
  const canCompareSeries = compareGroups.some((group) => group.series.length >= 2);
  const readyItemIds = batches.flatMap((batch) => asArray(batch.items).filter(batchItemReadyForApply).map((item) => item.id)).join("|");
  const [selectedBatchItemIds, setSelectedBatchItemIds] = useState(() => new Set());
  useEffect(() => {
    if (!open) return;
    setSelectedId((current) => summaries.some((item) => item.id === current) ? current : summaries[0]?.id || "");
  }, [open, summaryIds]);
  useEffect(() => {
    if (!open) return;
    setSelectedBatchItemIds((current) => {
      const readyIds = new Set(readyItemIds ? readyItemIds.split("|").filter(Boolean) : []);
      const next = new Set([...current].filter((id) => readyIds.has(id)));
      readyIds.forEach((id) => next.add(id));
      return next;
    });
  }, [open, readyItemIds]);
  if (!open) return null;
  const selected = summaries.find((item) => item.id === selectedId) || summaries[0] || null;
  const selectedBatchItems = batches.flatMap((batch) => asArray(batch.items)).filter((item) => selectedBatchItemIds.has(item.id) && batchItemReadyForApply(item));
  const hasBatchRows = batches.some((batch) => asArray(batch.items).length);
  const closeFromBackdrop = (event) => {
    if (event.target === event.currentTarget) onClose?.();
  };
  return (
    <div className="modal-backdrop" onMouseDown={closeFromBackdrop}>
      <div className="modal wide supplemental-manager-modal" role="dialog" aria-modal="true" aria-label="Supplemental Workbooks">
        <div className="modal-head">
          <div>
            <h2>Supplemental Workbooks</h2>
            <p>Browse attached supplemental files, inspect parsed content, and continue reviewed edit flows.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body supplemental-manager-body">
          <div className="supplemental-manager-toolbar">
            <div>
              <strong>{summaries.length} supplemental files</strong>
              <span>Applied files stay immutable; edits go through reviewed supplemental import.</span>
            </div>
            <div className="supplemental-manager-toolbar-actions">
              <button
                type="button"
                disabled={!canCompareSeries}
                title={canCompareSeries ? "Select compatible observation series and draft a compare chart proposal" : "Need at least two compatible active observation series"}
                onClick={onCompareSeries}
              >
                Compare series
              </button>
              <button type="button" className="primary" onClick={onAddSupplemental}>Add supplemental workbook</button>
            </div>
          </div>
          {batchUploading && (
            <div className="supplemental-batch-message">
              <ThinkingIndicator text="Uploading supplemental workbooks..." />
            </div>
          )}
          {batchError && <p className="import-review-error">{batchError}</p>}
          <SupplementalBatchPanel
            batches={batches}
            selectedItemIds={selectedBatchItemIds}
            applying={batchApplying}
            onSelectionChange={(itemId, checked) => setSelectedBatchItemIds((current) => {
              const next = new Set(current);
              if (checked) next.add(itemId);
              else next.delete(itemId);
              return next;
            })}
            onReviewItem={onContinueReview}
            onRetryItem={onRetryBatchItem}
            onApplySelected={() => onApplyBatchItems?.(selectedBatchItems)}
          />
          {!summaries.length && !hasBatchRows ? (
            <div className="supplemental-manager-empty">
              <h3>No supplemental workbooks yet.</h3>
              <p>Add an extra workbook after the master table is committed, then review the relationship before it becomes part of the dataset.</p>
              <button type="button" onClick={onAddSupplemental}>Add supplemental workbook</button>
            </div>
          ) : summaries.length ? (
            <div className="supplemental-manager-layout">
              <aside className="supplemental-manager-list" aria-label="Supplemental workbook list">
                {summaries.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`supplemental-manager-item ${item.id === selected?.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span>
                      <strong>{item.fileName || "Supplemental workbook"}</strong>
                      <small>{item.supplementType || "supplemental_data"} - {supplementalTargetsText(item)}</small>
                      <small>{supplementalCountText(item)}</small>
                    </span>
                    <span className={`supplemental-status ${supplementStatusClass(item.status)}`}>{supplementStatusLabel(item.status)}</span>
                  </button>
                ))}
              </aside>
              <section className="supplemental-manager-detail">
                {selected ? (
                  <>
                    <div className="supplemental-detail-head">
                      <div>
                        <h3>{selected.fileName || "Supplemental workbook"}</h3>
                        <p>{selected.supplementType || "supplemental_data"}</p>
                      </div>
                      <span className={`supplemental-status ${supplementStatusClass(selected.status)}`}>{supplementStatusLabel(selected.status)}</span>
                    </div>
                    <dl className="supplemental-detail-grid">
                      <div>
                        <dt>Linked experiments</dt>
                        <dd>{supplementalTargetsText(selected)}</dd>
                      </div>
                      <div>
                        <dt>Observation sets</dt>
                        <dd>{selected.observationSetCount || 0}</dd>
                      </div>
                      <div>
                        <dt>Observations</dt>
                        <dd>{selected.observationCount || 0}</dd>
                      </div>
                      <div>
                        <dt>Fields</dt>
                        <dd>{selected.fieldCount || 0}</dd>
                      </div>
                      <div>
                        <dt>Sources</dt>
                        <dd>{selected.sourceCount || 0}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{selected.updatedAt ? formatShortDate(selected.updatedAt) : "Not recorded"}</dd>
                      </div>
                    </dl>
                    <div className="supplemental-detail-section">
                      <strong>Y fields</strong>
                      <p>{selected.yFields?.length ? selected.yFields.join(", ") : "No observation y fields detected."}</p>
                    </div>
                    <div className="supplemental-detail-section">
                      <strong>Edit / review path</strong>
                      <p>
                        {selected.status === "applied"
                          ? "Applied scientific values are immutable. Replace or add a supplemental workbook through review to change the active dataset."
                          : "This workbook has not been applied yet. Continue review to inspect blocks, relationships, and apply decisions."}
                      </p>
                    </div>
                    <div className="supplemental-manager-actions">
                      {selected.status !== "applied" && selected.importRunId && (
                        <button type="button" className="primary" onClick={() => onContinueReview?.(selected.importRunId)}>Continue review</button>
                      )}
                      <button type="button" className="secondary" onClick={onAddSupplemental}>Replace / edit via reviewed import</button>
                    </div>
                  </>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function chartProposalMeta(proposal) {
  const parts = [];
  if (proposal?.chartType) parts.push(proposal.chartType);
  if (typeof proposal?.confidence === "number") parts.push(`${Math.round(proposal.confidence * 100)}%`);
  parts.push(proposal?.status || "proposed");
  return parts.join(" - ");
}

function ActiveChartProposalButton({ summary, onClick }) {
  if (!summary?.total) return null;
  return (
    <div className="active-chart-review-row">
      <div>
        <strong>{summary.total} active</strong>
        <small>{summary.accepted} accepted / {summary.pending} pending</small>
      </div>
      <button type="button" onClick={onClick}>Accepted + pending</button>
    </div>
  );
}

function PendingChartProposalList({ proposals = [], remaining = 0, onEditProposal }) {
  if (!proposals.length) return null;
  return (
    <div className="pending-chart-proposals" aria-label="Pending chart proposals">
      {proposals.map((proposal, index) => (
        <div className="pending-chart-proposal-row" key={proposal.proposalId || proposal.title || `pending-chart-${index}`}>
          <div>
            <strong>{proposal.title || proposal.proposalId || "Untitled proposal"}</strong>
            <small>{chartProposalMeta(proposal)}</small>
          </div>
          <button type="button" onClick={() => onEditProposal?.(proposal.proposalId)}>Edit</button>
        </div>
      ))}
      {remaining > 0 && <span className="pending-chart-more">+{remaining} more pending</span>}
    </div>
  );
}

function CompareSeriesOverviewAction({ groups = [], onClick }) {
  const comparableGroups = groups.filter((group) => group.series.length >= 2);
  const seriesCount = comparableGroups.reduce((total, group) => total + group.series.length, 0);
  if (!groups.length) return null;
  return (
    <div className="compare-series-entry-row">
      <div>
        <strong>{seriesCount || groups.length} comparable series</strong>
        <small>{comparableGroups.length ? `${comparableGroups.length} compatible group${comparableGroups.length === 1 ? "" : "s"}` : "Need at least two matching experiments"}</small>
      </div>
      <button
        type="button"
        disabled={!comparableGroups.length}
        title={comparableGroups.length ? "Create a cross-experiment compare chart" : "Need at least two compatible active observation series"}
        onClick={onClick}
      >
        Compare series
      </button>
    </div>
  );
}

function ProjectOverviewCard({ title, value, detail, action, onClick, actionDisabled = false, actionTitle = "", secondaryAction, onSecondaryClick, secondaryDisabled = false, secondaryTitle = "", children }) {
  return (
    <article className="project-overview-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
      {children}
      <div className="project-overview-card-actions">
        <button type="button" disabled={actionDisabled} title={actionTitle} onClick={onClick}>{action}</button>
        {secondaryAction && (
          <button
            type="button"
            className="secondary"
            disabled={secondaryDisabled}
            title={secondaryTitle}
            onClick={onSecondaryClick}
          >
            {secondaryAction}
          </button>
        )}
      </div>
    </article>
  );
}

export function NewProjectModal({ open, loading, error, onCreate, onClose }) {
  const [draft, setDraft] = useState({ name: "", description: "" });
  useEffect(() => {
    if (open) setDraft({ name: "", description: "" });
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose?.(); }}>
      <form className="modal new-project-modal" role="dialog" aria-modal="true" aria-label="New project" onSubmit={(event) => {
        event.preventDefault();
        onCreate?.(draft);
      }}>
        <div className="modal-head">
          <h2>New project</h2>
          <button type="button" aria-label="Close" disabled={loading} onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <label>Project name<input autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. CO2 reduction catalyst screen" /></label>
          <label>Short description<textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Optional research topic, campaign, or objective" /></label>
          {error && <p className="import-review-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" disabled={loading} onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={loading || !draft.name.trim()}>{loading ? "Creating..." : "Create project"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function DeleteProjectModal({ open, project, loading = false, error = "", onConfirm, onClose }) {
  if (!open || !project) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose?.(); }}>
      <section className="modal project-delete-modal" role="dialog" aria-modal="true" aria-label="Delete project">
        <div className="modal-head">
          <h2>Delete project</h2>
          <button type="button" aria-label="Close delete project" disabled={loading} onClick={onClose}>x</button>
        </div>
        <form
          className="modal-body project-delete-body"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm?.(project);
          }}
        >
          <div>
            <h3>{project.name}</h3>
            <p>
              This will hide the project from the Projects list. Audit data, imported scientific records,
              chart specs, and manuscripts are preserved.
            </p>
          </div>
          {error && <p className="import-review-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" disabled={loading} onClick={onClose}>Cancel</button>
            <button type="submit" className="danger" disabled={loading}>{loading ? "Deleting..." : "Delete project"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function RefreshWorkbookModal({ open, imports = [], defaultImportId = "", loading = false, error = "", onStartRefresh, onClose }) {
  const committedImports = asArray(imports).filter((item) => item?.importId && !isSupplementalImport(item));
  const fallbackImportId = defaultImportId || latestItem(committedImports)?.importId || "";
  const [selectedImportId, setSelectedImportId] = useState(fallbackImportId);
  useEffect(() => {
    if (open) setSelectedImportId(fallbackImportId);
  }, [open, fallbackImportId]);
  if (!open) return null;
  const selectedImport = committedImports.find((item) => item.importId === selectedImportId) || committedImports[0] || null;
  const startRefresh = (event) => {
    const file = event.target.files?.[0];
    if (file && selectedImport) {
      onStartRefresh?.({
        file,
        replaceImportId: selectedImport.importId,
        targetImport: selectedImport,
      });
    }
    event.target.value = "";
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose?.(); }}>
      <section className="modal refresh-workbook-modal" role="dialog" aria-modal="true" aria-label="Refresh workbook">
        <div className="modal-head">
          <h2>Refresh workbook</h2>
          <button type="button" aria-label="Close refresh workbook" disabled={loading} onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <p className="import-review-note">
            Choose the committed import to replace, then upload the corrected workbook. The replacement still goes through full scan, block review, normalized preview, and refresh diff review before apply.
          </p>
          {committedImports.length ? (
            <div className="refresh-import-list" role="radiogroup" aria-label="Committed imports">
              {committedImports.map((item) => {
                const itemId = item.importId;
                const lineage = genericImportLineageText(item);
                return (
                  <label className={`refresh-import-option ${selectedImportId === itemId ? "active" : ""}`} key={itemId}>
                    <input
                      type="radio"
                      name="refresh-import"
                      value={itemId}
                      checked={selectedImportId === itemId}
                      onChange={() => setSelectedImportId(itemId)}
                    />
                    <span>
                      <strong>{genericImportLabel(item)}</strong>
                      <small>{genericImportExperimentCount(item)} experiments - {genericImportFieldCount(item)} fields</small>
                      {lineage && <small>{lineage}</small>}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="import-review-empty">No committed imports are available to refresh.</div>
          )}
          {error && <p className="import-review-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" disabled={loading} onClick={onClose}>Cancel</button>
            <label className={`folder-btn ${loading || !selectedImport ? "disabled" : ""}`}>
              {loading ? "Starting..." : "Upload replacement workbook"}
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={loading || !selectedImport}
                onChange={startRefresh}
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

export function CompareSeriesModal({ open, projectState, loading = false, error = "", clarification = null, onCreateCompare, onClose }) {
  const groups = useMemo(() => buildCompareSeriesGroups(projectState), [projectState]);
  const comparableGroups = groups.filter((group) => group.series.length >= 2);
  const groupKeys = groups.map((group) => group.key).join("|");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [selectedExperimentIds, setSelectedExperimentIds] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    const fallbackGroup = comparableGroups[0] || groups[0] || null;
    setSelectedGroupKey((current) => groups.some((group) => group.key === current) ? current : fallbackGroup?.key || "");
  }, [open, groupKeys]);

  const selectedGroup = groups.find((group) => group.key === selectedGroupKey) || comparableGroups[0] || groups[0] || null;
  const selectedSeriesKey = selectedGroup?.series.map((series) => series.experimentId).join("|") || "";

  useEffect(() => {
    if (!open || !selectedGroup) return;
    setSelectedExperimentIds(new Set(selectedGroup.series.map((series) => series.experimentId).filter(Boolean)));
    setTitleDraft(`${selectedGroup.yLabel} comparison`);
  }, [open, selectedGroup?.key, selectedSeriesKey]);

  if (!open) return null;

  const query = search.toLowerCase().trim();
  const visibleSeries = selectedGroup
    ? selectedGroup.series.filter((series) => !query || [
      series.experimentLabel,
      series.experimentId,
      series.summary?.sourceFileName,
      series.yLabel,
      series.xLabel,
    ].join(" ").toLowerCase().includes(query))
    : [];
  const selectedCount = selectedExperimentIds.size;
  const canSubmit = !!selectedGroup && selectedCount >= 2 && !loading;
  const closeFromBackdrop = (event) => {
    if (event.target === event.currentTarget && !loading) onClose?.();
  };
  const toggleExperiment = (experimentId, checked) => {
    setSelectedExperimentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(experimentId);
      else next.delete(experimentId);
      return next;
    });
  };
  const submit = (event) => {
    event.preventDefault();
    if (!selectedGroup || selectedCount < 2) return;
    onCreateCompare?.({
      title: titleDraft.trim() || `${selectedGroup.yLabel} comparison`,
      seriesKind: selectedGroup.seriesKind,
      experimentIds: selectedGroup.series
        .map((series) => series.experimentId)
        .filter((experimentId) => selectedExperimentIds.has(experimentId)),
      xField: selectedGroup.xField,
      yField: selectedGroup.yField,
      groupBy: "experiment",
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={closeFromBackdrop}>
      <form className="modal wide compare-series-modal" role="dialog" aria-modal="true" aria-label="Compare series" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Compare series</h2>
            <p>Select compatible supplemental observation series, then draft a reviewable chart proposal.</p>
          </div>
          <button type="button" aria-label="Close compare series" disabled={loading} onClick={onClose}>x</button>
        </div>
        <div className="modal-body compare-series-body">
          {!groups.length ? (
            <div className="import-review-empty">
              Apply at least two compatible supplemental workbooks before creating a compare chart.
            </div>
          ) : (
            <>
              <section className="compare-series-groups" aria-label="Compatible series groups">
                {groups.map((group) => (
                  <label className={`compare-series-group ${group.key === selectedGroup?.key ? "active" : ""}`} key={group.key}>
                    <input
                      type="radio"
                      name="compare-series-group"
                      value={group.key}
                      checked={group.key === selectedGroup?.key}
                      onChange={() => setSelectedGroupKey(group.key)}
                    />
                    <span>
                      <strong>{group.yLabel} vs {group.xLabel}</strong>
                      <small>{group.series.length} experiment{group.series.length === 1 ? "" : "s"} - {group.seriesKind}</small>
                    </span>
                  </label>
                ))}
              </section>
              {selectedGroup && (
                <section className="compare-series-selection">
                  <div className="compare-series-selection-head">
                    <div>
                      <strong>{selectedCount} of {selectedGroup.series.length} selected</strong>
                      <small>{selectedGroup.yLabel} vs {selectedGroup.xLabel}</small>
                    </div>
                    <div className="compare-series-selection-actions">
                      <button type="button" onClick={() => setSelectedExperimentIds(new Set(selectedGroup.series.map((series) => series.experimentId).filter(Boolean)))}>Select all</button>
                      <button type="button" onClick={() => setSelectedExperimentIds(new Set())}>Clear</button>
                    </div>
                  </div>
                  <label className="compare-series-title">
                    Chart title
                    <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
                  </label>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search experiment label or source file..."
                    aria-label="Search compare series"
                  />
                  <div className="compare-series-list">
                    {visibleSeries.map((series) => {
                      const experimentId = series.experimentId;
                      return (
                        <label className="compare-series-row" key={series.id || series.seriesId || experimentId}>
                          <input
                            type="checkbox"
                            checked={selectedExperimentIds.has(experimentId)}
                            onChange={(event) => toggleExperiment(experimentId, event.target.checked)}
                          />
                          <span>
                            <strong>{series.experimentLabel || experimentId}</strong>
                            <small>{series.summary?.pointCount || 0} points - {series.summary?.sourceFileName || series.sourceImportId || "source n/a"}</small>
                          </span>
                        </label>
                      );
                    })}
                    {!visibleSeries.length && <div className="import-review-empty">No series match the current search.</div>}
                  </div>
                </section>
              )}
            </>
          )}
          {clarification && (
            <div className="import-review-error">
              <strong>{clarification.message || "Need clarification"}</strong>
              {asArray(clarification.options).length ? (
                <span>{asArray(clarification.options).map((option) => option.label || option.field || option.experimentId || option.alias).filter(Boolean).join(", ")}</span>
              ) : null}
            </div>
          )}
          {error && <p className="import-review-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" disabled={loading} onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={!canSubmit}>{loading ? "Drafting..." : "Draft compare proposal"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Browser({ dataset, setSelected, sourceName, blankMode, onOpenImportReview, onOpenMappingReview, onOpenCompareSeries, compareSeriesEnabled = false, compareSeriesTitle = "", onOpenProfile, projectProfile, templateLinks, projectId }) {
  const [filters, setFilters] = useState({ search: "", cat: [], impeller: [], rpm: [], cb95: false, hasPostGc: false, hasSweep: false, hasrate: false });
  const [sort, setSort] = useState(["date", -1]);
  const [browserView, setBrowserView] = useState("curated");
  const setChip = (key, val) => setFilters((f) => ({ ...f, [key]: f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val] }));
  const hasPostReactionGc = (e) => !!(e.calculation || e.files?.calculation || e.sources?.some((source) => source.kind === "post_reaction_gc"));
  const hasSweepData = (e) => !!(e.sweep || e.files?.sweep || e.sources?.some((source) => source.kind === "sweep_gc"));
  const genericRowCount = useMemo(() => buildGenericBrowserRows(dataset).length, [dataset]);
  const activeView = !dataset.experiments.length && genericRowCount ? "imported" : browserView;
  const viewSwitch = (
    <section className="filter">
      <h4>View</h4>
      <div className="chips">
        <Chip active={activeView === "curated"} onClick={() => setBrowserView("curated")}>Curated ({dataset.experiments.length})</Chip>
        <Chip active={activeView === "imported"} onClick={() => setBrowserView("imported")}>Imported ({genericRowCount})</Chip>
      </div>
    </section>
  );
  const rows = useMemo(() => {
    const q = filters.search.toLowerCase().trim();
    const out = dataset.experiments.filter((e) => {
      if (q && !`${e.label} ${e.comments || ""}`.toLowerCase().includes(q)) return false;
      if (filters.cat.length && !filters.cat.includes(e.catalyst_type || "-")) return false;
      if (filters.impeller.length && !filters.impeller.includes(e.impeller || "-")) return false;
      if (filters.rpm.length && !filters.rpm.includes(String(e.rpm))) return false;
      if (filters.cb95 && !(e.carbon_balance_pct >= 95)) return false;
      if (filters.hasPostGc && !hasPostReactionGc(e)) return false;
      if (filters.hasSweep && !hasSweepData(e)) return false;
      if (filters.hasrate && !e.rate_sources?.length) return false;
      return true;
    });
    const [col, dir] = sort;
    return out.sort((a, b) => {
      const av = col === "label" ? expNo(a.label) : col === "date" ? experimentDateSortValue(a.date) : a[col];
      const bv = col === "label" ? expNo(b.label) : col === "date" ? experimentDateSortValue(b.date) : b[col];
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [filters, sort, dataset.experiments]);
  const cats = [...new Set(dataset.experiments.map((e) => e.catalyst_type || "-"))].sort();
  const imps = [...new Set(dataset.experiments.map((e) => e.impeller || "-"))].sort();
  const rpms = [...new Set(dataset.experiments.map((e) => String(e.rpm)))].sort((a, b) => Number(a) - Number(b));
  const blankProjectHasNoUserData = blankMode
    && !dataset.experiments.length
    && !(dataset.genericImports || []).length
    && !(dataset.genericMappingSets || []).length
    && !(dataset.genericChartProposals || []).length;
  if (blankProjectHasNoUserData) {
    return (
      <div className="browser">
        <aside className="sidebar blank-sidebar">
          <section className="filter">
            <h4>Project</h4>
            <p>Empty project</p>
          </section>
          <section className="filter">
            <h4>Compatibility</h4>
            <p>Legacy HDPE MasterTable folder import remains available from Import review.</p>
          </section>
        </aside>
        <main className="main">
          <div className="page-head">
            <div><h1>New LabRat project</h1><p>{projectProfile?.researchGoal || "No accepted dataset commit yet."}</p></div>
            <button type="button" className="compact-action primary" onClick={onOpenImportReview}>Import workbook</button>
          </div>
          <div className="server-project-start">
            <button type="button" className="primary" onClick={onOpenProfile}>Edit profile</button>
          </div>
          <BlankOnboarding onImportWorkbook={onOpenImportReview} templateLinks={templateLinks} />
        </main>
      </div>
    );
  }
  if (activeView === "imported") {
    return (
      <div className="browser">
        <GenericImportBrowser
          dataset={dataset}
          sourceName={sourceName}
          onOpenImportReview={onOpenImportReview}
          onOpenMappingReview={onOpenMappingReview}
          onCompareSeries={onOpenCompareSeries}
          compareSeriesEnabled={compareSeriesEnabled}
          compareSeriesTitle={compareSeriesTitle}
          viewSwitch={viewSwitch}
          projectId={projectId}
        />
      </div>
    );
  }
  return (
    <div className="browser">
      <aside className="sidebar">
        {viewSwitch}
        <Filter title="Search"><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Label, comments..." /></Filter>
        <Filter title="Catalyst">{cats.map((c) => <Chip key={c} active={filters.cat.includes(c)} onClick={() => setChip("cat", c)}>{c}</Chip>)}</Filter>
        <Filter title="Impeller">{imps.map((c) => <Chip key={c} active={filters.impeller.includes(c)} onClick={() => setChip("impeller", c)}>{c}</Chip>)}</Filter>
        <Filter title="RPM">{rpms.map((c) => <Chip key={c} active={filters.rpm.includes(c)} onClick={() => setChip("rpm", c)}>{c}</Chip>)}</Filter>
        <label className="check"><input type="checkbox" checked={filters.cb95} onChange={(e) => setFilters({ ...filters, cb95: e.target.checked })} /> Carbon balance &gt;= 95%</label>
        <label className="check"><input type="checkbox" checked={filters.hasPostGc} onChange={(e) => setFilters({ ...filters, hasPostGc: e.target.checked })} /> Has post-rxn GC data</label>
        <label className="check"><input type="checkbox" checked={filters.hasSweep} onChange={(e) => setFilters({ ...filters, hasSweep: e.target.checked })} /> Has sweep data</label>
        <label className="check"><input type="checkbox" checked={filters.hasrate} onChange={(e) => setFilters({ ...filters, hasrate: e.target.checked })} /> Has rate data</label>
        <button className="clear" type="button" onClick={() => setFilters({ search: "", cat: [], impeller: [], rpm: [], cb95: false, hasPostGc: false, hasSweep: false, hasrate: false })}>Clear filters</button>
      </aside>
      <main className="main">
        <div className="page-head">
          <div><h1>Experiment Browser</h1><p>{rows.length} of {dataset.experiments.length} experiments - source: {sourceName} - click a row for full record.</p></div>
          <button type="button" className="compact-action primary" onClick={onOpenImportReview}>Import workbook</button>
        </div>
        <div className="card table-wrap experiment-table">
          <table>
            <thead><tr>{[
              ["label", "Label"], ["date", "Date"], ["catalyst_loading_g", "Cat (g)"], ["reaction_time_hr", "t (h)"], ["rpm", "RPM"], ["impeller", "Impeller"], ["conversion_pct", "Conv %"], ["selectivity_liquid_pct", "Sel S/L/G"], ["carbon_balance_pct", "C-bal %"], ["files", "Files"],
            ].map(([k, l]) => <th key={k} onClick={() => k !== "files" && setSort(([old, d]) => old === k ? [k, -d] : [k, 1])}>{l}</th>)}</tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.label} onClick={() => setSelected(e)}>
                <td><span>{e.label}</span></td><td>{formatExperimentDateForDisplay(e.date)}</td><td>{fmt(e.catalyst_loading_g, 3)}</td><td>{fmt(e.reaction_time_hr, 1)}</td><td>{fmt(e.rpm, 0)}</td>
                <td><span className="pill muted">{e.impeller || "-"}</span></td><td>{fmt(e.conversion_pct, 1)}</td>
                <td>{fmt(e.selectivity_solid_pct, 1)} / {fmt(e.selectivity_liquid_pct, 1)} / {fmt(e.selectivity_gas_pct, 1)}</td>
                <td className="plain-cell"><span className={`pill ${e.carbon_balance_pct >= 95 ? "ok" : e.carbon_balance_pct >= 90 ? "warn" : "bad"}`}>{fmt(e.carbon_balance_pct, 1)}</span></td>
                <td className="plain-cell"><FilePills e={e} /></td>
              </tr>
            ))}
              {!rows.length && (
                <tr className="table-empty-row">
                  <td colSpan={10}>No experiments match the active filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function Filter({ title, children }) {
  return <section className="filter"><h4>{title}</h4><div className="chips">{children}</div></section>;
}

function Chip({ active, onClick, children }) {
  return <button type="button" className={`chip ${active ? "active" : ""}`} aria-pressed={active} onClick={onClick}>{children}</button>;
}

function FilePills({ e }) {
  const items = [["calculation", "Calc"], ["sweep", "Sweep"]];
  const rateSource = Array.isArray(e.rate_sources) && e.rate_sources.length ? e.rate_sources[0] : null;
  return <>{items.map(([k, l]) => {
    const f = e.files?.[k];
    if (!f) return <span key={k} className="file disabled">{l}</span>;
    const href = typeof f === "string" ? `/original/${encodeURIComponent(f)}` : f.url;
    const title = typeof f === "string" ? f : f.name;
    return href
      ? <a key={k} className="file" href={href} title={title} onClick={(ev) => ev.stopPropagation()} target="_blank">{l}</a>
      : <span key={k} className="file disabled" title={title}>{l}</span>;
  })}
    {rateSource
      ? <span className="file" title={`${rateSource.source_file || "Reaction rate data"}${rateSource.n_points ? ` - ${rateSource.n_points} points` : ""}`}>Reaction rate</span>
      : <span className="file disabled">Reaction rate</span>}
  </>;
}

function DetailModal({ exp, onClose, onStage }) {
  if (!exp) return null;
  const selectivity = makePlot("selectivity", [exp]);
  const rate = exp.rate_sources?.length ? makePlot("rate", [exp]) : null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head"><span>{exp.label} - Full record</span><button type="button" aria-label="Close full record" onClick={onClose}>x</button></div>
        <div className="modal-body">
          <div className="detail-title">
            <div><h2>{exp.label} <span>{formatExperimentDateForDisplay(exp.date)}</span></h2><p>{exp.catalyst_type} - {exp.polymer_type} - {exp.impeller} impeller</p></div>
            <button className="primary" onClick={() => onStage(exp.label)}>Stage for manuscript</button>
          </div>
          <div className="stats">
            <Stat label="Conversion" value={`${fmt(exp.conversion_pct, 1)}%`} note={`${fmt(exp.reaction_time_hr, 1)} h`} />
            <Stat label="Carbon balance" value={`${fmt(exp.carbon_balance_pct, 1)}%`} note={exp.carbon_balance_pct >= 95 ? "passes" : "flagged"} />
            <Stat label="Liquid selectivity" value={`${fmt(exp.selectivity_liquid_pct, 2)}%`} note={`solid ${fmt(exp.selectivity_solid_pct, 1)}% / gas ${fmt(exp.selectivity_gas_pct, 2)}%`} />
            <Stat label="H2 consumed" value={fmt(exp.h2_consumption_mol, 3)} note="mol" />
          </div>
          <div className="detail-grid">
            <section className="card"><h3>Conditions</h3><KV e={exp} /></section>
            <section className="card"><h3>Selectivity</h3><Plot {...selectivity} className="short" /></section>
            {rate && <section className="card full"><h3>Reaction rate vs. time</h3><Plot {...rate} className="tall" /></section>}
            <section className="card full"><h3>Sources</h3><SourceList e={exp} /></section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return <div className="stat"><span>{label}</span><span className="stat-value">{value}</span><small>{note}</small></div>;
}

function ImportReviewModal({
  mode = "append",
  refreshDraft,
  relationshipDraft,
  backendScanState,
  backendBlockReview,
  backendNormalizeState,
  backendMappingState,
  genericImports,
  fieldRoleOverrides,
  onBackendScanFile,
  onBlockReviewDecision,
  onFieldRoleOverride,
  onPreviewNormalize,
  onApplyNormalize,
  onRelationshipProposalSelect,
  onProposeMappings,
  onMappingDecision,
  onReloadProjectState,
  onClose,
}) {
  const isRefreshMode = mode === "refresh";
  const isSupplementMode = mode === "supplement";
  const targetLabel = genericImportLabel(refreshDraft?.targetImport);
  const modalLabel = isRefreshMode ? "Refresh workbook review" : isSupplementMode ? "Supplemental workbook review" : "Import review";
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal wide import-review-modal" role="dialog" aria-modal="true" aria-label={modalLabel}>
        <div className="modal-head">
          <span>{modalLabel}</span>
          <button type="button" aria-label="Close import review" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <p className="import-review-note">
            {isRefreshMode
              ? `Refresh workflow: scan the replacement workbook for ${targetLabel}, review detected blocks and fields, preview normalized data, then approve the refresh diff before replacing the committed import.`
              : isSupplementMode
                ? "Supplement workflow: scan an extra workbook, review detected blocks and fields, preview normalized data, then approve the detected relationship to attach it to existing experiments."
                : "Import workflow: scan a workbook, review detected blocks and fields, preview/apply normalized data, then review semantic mappings for Browser columns and chart inputs."}
          </p>
          <BackendScanPanel
            mode={mode}
            refreshDraft={refreshDraft}
            relationshipDraft={relationshipDraft}
            scanState={backendScanState}
            blockReview={backendBlockReview}
            normalizeState={backendNormalizeState}
            mappingState={backendMappingState}
            genericImports={genericImports}
            fieldRoleOverrides={fieldRoleOverrides}
            onScanFile={onBackendScanFile}
            onBlockReviewDecision={onBlockReviewDecision}
            onFieldRoleOverride={onFieldRoleOverride}
            onPreviewNormalize={onPreviewNormalize}
            onApplyNormalize={onApplyNormalize}
            onRelationshipProposalSelect={onRelationshipProposalSelect}
            onProposeMappings={onProposeMappings}
            onMappingDecision={onMappingDecision}
            onReloadProjectState={onReloadProjectState}
          />
        </div>
      </section>
    </div>
  );
}

export function ChartReviewModal({
  open,
  genericImports = [],
  mappingState,
  chartProposalState,
  chartInterpretState,
  chartSpecs,
  focusProposalId,
  statusFilter,
  onProposeCharts,
  onChartProposalDecision,
  onInterpretChart,
  onCreateChartSpec,
  onOpenImportReview,
  onClose,
}) {
  if (!open) return null;
  const hasImports = genericImports.length > 0;
  const title = statusFilter === "active" ? "Accepted + pending charts" : "Review chart proposals";
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal wide chart-review-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <span>{title}</span>
          <button type="button" aria-label="Close chart proposal review" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <p className="import-review-note">
            Draft one chart proposal from a prompt, review chart proposals, then create ChartSpecs for Manuscript.
          </p>
          {hasImports ? (
            <ChartReviewPanel
              genericImports={genericImports}
              mappingState={mappingState}
              chartProposalState={chartProposalState}
              chartInterpretState={chartInterpretState}
              chartSpecs={chartSpecs}
              focusProposalId={focusProposalId}
              statusFilter={statusFilter}
              onProposeCharts={onProposeCharts}
              onChartProposalDecision={onChartProposalDecision}
              onInterpretChart={onInterpretChart}
              onCreateChartSpec={onCreateChartSpec}
            />
          ) : (
            <div className="import-review-empty chart-review-empty">
              <strong>Import workbook first</strong>
              <span>Chart proposals need reviewed imported data before LabRat can draft chart specs.</span>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  onClose?.();
                  onOpenImportReview?.();
                }}
              >
                Import workbook
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function editableMappingPayload(mappingSetRecord) {
  const payload = mappingPayloadFromRecord(mappingSetRecord) || {
    schemaVersion: "labrat.semanticMappingSet.v1",
    mappings: [],
    warnings: [],
  };
  return {
    ...cloneJson(payload),
    mappings: asArray(payload.mappings).map((mapping) => ({
      status: "proposed",
      canonicalField: "",
      semanticRole: "",
      unit: "",
      ...cloneJson(mapping),
    })),
    warnings: asArray(payload.warnings),
  };
}

export function MappingReviewModal({
  open,
  currentDatasetCommitId,
  mappingSetRecord,
  genericImports = [],
  onGenerateMappings,
  onSaveMappings,
  onClose,
}) {
  const [draft, setDraft] = useState(() => editableMappingPayload(mappingSetRecord));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const mappingSetKey = `${mappingSetRecord?.id || "none"}:${mappingSetRecord?.updatedAt || mappingSetRecord?.createdAt || ""}`;
  useEffect(() => {
    if (!open) return;
    setDraft(editableMappingPayload(mappingSetRecord));
    setBusy("");
    setError("");
  }, [open, mappingSetKey]);
  if (!open) return null;

  const stale = mappingSetIsStale(mappingSetRecord, currentDatasetCommitId);
  const mappings = asArray(draft.mappings);
  const counts = {
    total: mappings.length,
    accepted: mappings.filter((mapping) => mapping.status === "accepted").length,
    rejected: mappings.filter((mapping) => mapping.status === "rejected").length,
    proposed: mappings.filter((mapping) => !mapping.status || mapping.status === "proposed").length,
  };
  const hasCurrentMappingSet = !!mappingSetRecord?.id && !stale;
  const hasMasterImports = getMasterImports({ genericImports }).length > 0;
  const updateMapping = (mappingId, patch) => {
    setDraft((current) => ({
      ...current,
      mappings: asArray(current.mappings).map((mapping) => (
        mapping.mappingId === mappingId ? { ...mapping, ...patch } : mapping
      )),
    }));
  };
  const runGenerate = async () => {
    setBusy("generate");
    setError("");
    try {
      const nextRecord = await onGenerateMappings?.();
      if (nextRecord) setDraft(editableMappingPayload(nextRecord));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setBusy("save");
    setError("");
    try {
      const nextRecord = await onSaveMappings?.(mappingSetRecord, draft);
      if (nextRecord) setDraft(editableMappingPayload(nextRecord));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy("");
    }
  };
  const closeFromBackdrop = (event) => {
    if (event.target === event.currentTarget) onClose?.();
  };

  return (
    <div className="modal-backdrop" onMouseDown={closeFromBackdrop}>
      <section className="modal wide mapping-review-modal" role="dialog" aria-modal="true" aria-label="Edit semantic mappings">
        <div className="modal-head">
          <div>
            <h2>Edit semantic mappings</h2>
            <p>Mapping changes update Browser columns, chart inputs, and AI context without changing raw imported data.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body mapping-review-body">
          <div className="mapping-review-toolbar">
            <div className="backend-scan-stats">
              <span>{counts.total} mappings</span>
              <span>{counts.accepted} accepted</span>
              <span>{counts.proposed} proposed</span>
              <span>{counts.rejected} rejected</span>
            </div>
            <div className="mapping-review-actions">
              <button
                type="button"
                disabled={!hasMasterImports || busy === "generate"}
                onClick={runGenerate}
              >
                {busy === "generate"
                  ? "Generating..."
                  : stale
                    ? "Regenerate for current dataset"
                    : mappingSetRecord ? "Regenerate mappings" : "Generate mappings"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!hasCurrentMappingSet || !mappings.length || busy === "save"}
                onClick={save}
              >
                {busy === "save" ? "Saving..." : "Save mappings"}
              </button>
            </div>
          </div>
          {!hasMasterImports && <p className="import-review-error">Upload and apply a master table before editing mappings.</p>}
          {stale && (
            <p className="import-review-error">
              This mapping set belongs to an older dataset commit. Regenerate mappings for the current dataset before editing.
            </p>
          )}
          {error && <p className="import-review-error">{error}</p>}
          {!mappingSetRecord && !busy && (
            <div className="import-review-empty">
              No semantic mappings have been generated for this dataset yet.
            </div>
          )}
          {mappings.length > 0 && (
            <div className="mapping-editor-table">
              <table>
                <thead>
                  <tr>
                    <th>Source field</th>
                    <th>Status</th>
                    <th>Canonical field</th>
                    <th>Semantic role</th>
                    <th>Unit</th>
                    <th>Value type</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => {
                    const label = mapping.rawLabel || mapping.displayName || mapping.mappingId;
                    return (
                      <tr key={mapping.mappingId}>
                        <td>
                          <strong>{label}</strong>
                          <small>{asArray(mapping.sourceIds).length} source values</small>
                        </td>
                        <td>
                          <select
                            aria-label={`Status ${label}`}
                            value={mapping.status || "proposed"}
                            disabled={stale}
                            onChange={(event) => updateMapping(mapping.mappingId, { status: event.target.value })}
                          >
                            {MAPPING_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            aria-label={`Canonical field ${label}`}
                            value={mapping.canonicalField || ""}
                            disabled={stale}
                            onChange={(event) => updateMapping(mapping.mappingId, { canonicalField: event.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`Semantic role ${label}`}
                            value={mapping.semanticRole || ""}
                            disabled={stale}
                            onChange={(event) => updateMapping(mapping.mappingId, { semanticRole: event.target.value })}
                          >
                            <option value="">unmapped</option>
                            {SEMANTIC_ROLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            aria-label={`Unit ${label}`}
                            value={mapping.unit || ""}
                            disabled={stale}
                            onChange={(event) => updateMapping(mapping.mappingId, { unit: event.target.value })}
                          />
                        </td>
                        <td><span className="backend-scan-muted">{mapping.valueType || "unknown"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function KV({ e }) {
  const rows = [["Temperature", `${fmt(e.temperature_C, 0)} C`], ["Pressure", `${fmt(e.pressure_bar, 0)} bar`], ["Reaction time", `${fmt(e.reaction_time_hr, 1)} h`], ["RPM", fmt(e.rpm, 0)], ["Catalyst", `${fmt(e.catalyst_loading_g, 4)} g`], ["HDPE", `${fmt(e.polymer_loading_g, 4)} g`]];
  return <dl className="kv">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>;
}

function SourceList({ e }) {
  return <div className="sources"><FilePills e={e} />{(e.sources || []).map((s, i) => <div key={i} className="source-row"><span>{s.kind}</span><span>{s.file}{s.sheet ? ` - ${s.sheet}` : ""}{s.row ? ` - row ${s.row}` : ""}</span></div>)}</div>;
}

function ReferenceLibrary({ references, setReferences }) {
  const [filter, setFilter] = useState("all");
  const addFiles = (files) => Array.from(files || []).forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => setReferences((refs) => [...refs, { id: uid(), name: file.name, mime: file.type, size: file.size, dataUrl: reader.result, note: "", createdAt: Date.now(), kind: refKind(file) }]);
    reader.readAsDataURL(file);
  });
  const shown = filter === "all" ? references : references.filter((r) => r.kind === filter);
  return <main className="reference main">
    <div className="page-head"><div><h1>References</h1><p>Upload images, PDFs, raw data, calculations, and notes into the local reference library.</p></div></div>
    <label className="drop">Drop or choose files<input type="file" multiple onChange={(e) => addFiles(e.target.files)} /></label>
    <div className="chips ref-filter">{["all", "image", "pdf", "data", "document", "code", "other"].map((k) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{k}</Chip>)}</div>
    <div className="ref-grid">{shown.map((r) => <article className="ref-card" key={r.id}>
      <div className="thumb">{r.kind === "image" ? <img src={r.dataUrl} alt="" /> : <span>{r.kind}</span>}</div>
      <div className="ref-info"><span>{r.name}</span><small>{Math.round(r.size / 1024)} KB</small><textarea value={r.note} placeholder="Add a note..." onChange={(e) => setReferences((refs) => refs.map((x) => x.id === r.id ? { ...x, note: e.target.value } : x))} /></div>
      <div className="ref-actions"><a href={r.dataUrl} download={r.name}>Download</a><button onClick={() => setReferences((refs) => refs.filter((x) => x.id !== r.id))}>Delete</button></div>
    </article>)}</div>
  </main>;
}

function refKind(file) {
  const n = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "image";
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx|xls|csv|tsv|txt|log|json)$/i.test(n)) return "data";
  if (/\.(docx|doc|md|pptx)$/i.test(n)) return "document";
  if (/\.(m|py|js|r|mat)$/i.test(n)) return "code";
  return "other";
}

function AgentActionCard({ action, projectState, busyActionId, onChooseFile, onUseExistingFile, onExecute, onConfirm, onAcceptChartProposal, onCreateChartSpec, onInsertChartSpec }) {
  const params = action.params || {};
  const preview = action.preview || null;
  const fileOptions = asArray(params.existingFiles);
  const isBusy = busyActionId === action.actionId || ["previewing", "executing", "accepting_proposal", "creating_chart_spec"].includes(action.status);
  const canConfirm = ["ready_to_apply", "ready_to_persist", "ready_to_create"].includes(action.status);
  const hasChatChartProposal = ["interpret_chart", "compare_series"].includes(action.type) && action.chartProposalSetId && action.proposalId;
  const proposalAccepted = action.proposalStatus === "accepted" || ["proposal_accepted", "chart_spec_created"].includes(action.status);
  const chartSpecCreated = action.status === "chart_spec_created" || Boolean(action.chartSpecId);
  const warnings = [...asArray(action.warnings), ...asArray(preview?.warnings)];
  return (
    <div className={`agent-action-card is-${action.status || "proposed"}`}>
      <div className="agent-action-head">
        <strong>{action.label || action.type}</strong>
        <span>{action.status || "proposed"}</span>
      </div>
      {action.description && <p>{action.description}</p>}
      {params.targetExperimentAliases?.length > 0 && <small>Target: {params.targetExperimentAliases.join(", ")}</small>}
      {params.prompt && <small>Prompt: {params.prompt}</small>}
      {preview?.summary && (
        <div className="agent-action-summary">
          {Object.entries(preview.summary).map(([key, value]) => (
            <span key={key}>{key}: {String(value)}</span>
          ))}
        </div>
      )}
      {preview?.relationshipProposal && (
        <small>
          Relationship: {preview.relationshipProposal.supplementType || preview.relationshipProposal.proposedRelationship}
          {" -> "}
          {asArray(preview.relationshipProposal.targetExperimentIds).join(", ")}
        </small>
      )}
      {preview?.chartTitle && <small>Chart: {preview.chartTitle}</small>}
      {preview?.message && <small>{preview.message}</small>}
      {warnings.length > 0 && (
        <ul className="agent-action-warnings">
          {warnings.map((warning, index) => (
            <li key={`${warning.code || "warning"}-${index}`}>{warning.message || warning.code || String(warning)}</li>
          ))}
        </ul>
      )}
      {action.error && <p className="import-review-error">{action.error}</p>}
      <div className="agent-action-buttons">
        {action.requiresFile && !canConfirm && action.status !== "completed" && (
          <>
            <button type="button" disabled={isBusy} onClick={() => onChooseFile?.(action.actionId)}>
              {isBusy ? "Working..." : "Choose file"}
            </button>
            {fileOptions.length > 0 && (
              <select
                disabled={isBusy}
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) onUseExistingFile?.(action.actionId, event.target.value);
                  event.target.value = "";
                }}
              >
                <option value="">Use existing file...</option>
                {fileOptions.map((file) => (
                  <option key={file.fileObjectId} value={file.fileObjectId}>{file.name}</option>
                ))}
              </select>
            )}
          </>
        )}
        {!action.requiresFile && !canConfirm && action.status !== "completed" && !hasChatChartProposal && (
          <button type="button" disabled={isBusy} onClick={() => onExecute?.(action.actionId)}>
            {isBusy ? "Working..." : action.type === "resolve_data_query" ? "Resolve query" : "Prepare"}
          </button>
        )}
        {canConfirm && (
          <button type="button" className="primary" disabled={isBusy} onClick={() => onConfirm?.(action.actionId)}>
            {isBusy ? "Applying..." : action.type === "create_chart_spec_from_proposal" ? "Create ChartSpec" : action.type?.includes("chart") ? "Confirm chart action" : "Confirm apply"}
          </button>
        )}
        {hasChatChartProposal && !chartSpecCreated && (
          <>
            {proposalAccepted ? (
              <span className="workflow-status is-applied">Proposal accepted</span>
            ) : (
              <button type="button" disabled={isBusy} onClick={() => onAcceptChartProposal?.(action.actionId)}>
                {isBusy ? "Accepting..." : "Accept proposal"}
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={isBusy || !proposalAccepted}
              title={proposalAccepted ? "Create a durable ChartSpec for Manuscript insertion" : "Accept the proposal before creating a ChartSpec"}
              onClick={() => onCreateChartSpec?.(action.actionId)}
            >
              {isBusy ? "Working..." : "Create ChartSpec"}
            </button>
          </>
        )}
        {chartSpecCreated && <span className="workflow-status is-applied">ChartSpec created</span>}
        {chartSpecCreated && action.chartSpecId && (
          <button
            type="button"
            className="primary"
            disabled={isBusy}
            onClick={() => onInsertChartSpec?.(action.chartSpecId)}
          >
            Insert into Manuscript
          </button>
        )}
        {action.status === "completed" && !hasChatChartProposal && <span className="workflow-status is-applied">Completed</span>}
      </div>
      {projectState?.project?.name && <small>Project: {projectState.project.name}</small>}
    </div>
  );
}

export function AgentPanel({
  open,
  setOpen,
  dataset,
  blocks,
  setBlocks,
  references,
  selected,
  selectedChartContext,
  pendingChartAnalysis,
  onChartAnalysisHandled,
  activeProjectId,
  projectState,
  onProjectStateLoaded,
  onInsertChartSpec,
}) {
  const [history, setHistory] = useState(() => ls.get("labrat_blank_chat_history_v1_react", []).map(({ streaming, streamId, ...message }) => message));
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("labrat_blank_anthropic_key_v1") || "");
  const [model, setModel] = useState(() => localStorage.getItem("labrat_blank_anthropic_model_v1") || "claude-sonnet-4-5");
  const [writingExamples, setWritingExamples] = useState(() => localStorage.getItem("labrat_blank_writing_examples_v1") || "");
  const [projectBackground, setProjectBackground] = useState(() => localStorage.getItem("labrat_blank_project_background_v1") || "");
  const [houseRules, setHouseRules] = useState(() => localStorage.getItem("labrat_blank_house_rules_v1") || "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingFileActionId, setPendingFileActionId] = useState("");
  const [busyActionId, setBusyActionId] = useState("");
  const fileActionInputRef = useRef(null);
  const [settingsDraft, setSettingsDraft] = useState({
    apiKey,
    model,
    writingExamples,
    projectBackground,
    houseRules,
  });
  useEffect(() => {
    ls.set("labrat_blank_chat_history_v1_react", history.map(({ streaming, streamId, ...message }) => message));
  }, [history]);
  const openSettings = () => {
    setSettingsDraft({ apiKey, model, writingExamples, projectBackground, houseRules });
    setSettingsOpen(true);
  };
  const cancelSettings = () => {
    setSettingsDraft({ apiKey, model, writingExamples, projectBackground, houseRules });
    setSettingsOpen(false);
  };
  const saveSettings = () => {
    const next = {
      apiKey: settingsDraft.apiKey,
      model: settingsDraft.model || "claude-sonnet-4-5",
      writingExamples: settingsDraft.writingExamples,
      projectBackground: settingsDraft.projectBackground,
      houseRules: settingsDraft.houseRules,
    };
    setApiKey(next.apiKey);
    setModel(next.model);
    setWritingExamples(next.writingExamples);
    setProjectBackground(next.projectBackground);
    setHouseRules(next.houseRules);
    localStorage.setItem("labrat_blank_anthropic_key_v1", next.apiKey);
    localStorage.setItem("labrat_blank_anthropic_model_v1", next.model);
    localStorage.setItem("labrat_blank_writing_examples_v1", next.writingExamples);
    localStorage.setItem("labrat_blank_project_background_v1", next.projectBackground);
    localStorage.setItem("labrat_blank_house_rules_v1", next.houseRules);
    setSettingsOpen(false);
  };
  const updateSettingsDraft = (key, value) => setSettingsDraft((draft) => ({ ...draft, [key]: value }));
  const context = () => ({
    study: dataset.metadata.study,
    n_experiments: dataset.experiments.length,
    selected: selected?.label,
    selected_chart: selectedChartContext,
    assistant_profile: {
      writing_examples: writingExamples,
      project_background: projectBackground,
      house_rules: houseRules,
    },
    manuscript_blocks: blocks.map((b) => ({
      kind: b.kind,
      chartSpecId: b.chartSpecId,
      title: b.chartSpecSnapshot?.title || b.opts?.title,
      text: b.kind === "text" ? b.html : undefined,
    })),
    references: references.map((r) => ({ name: r.name, kind: r.kind, note: r.note })),
    experiments_csv: dataset.experiments.map((e) => [e.label, e.catalyst_loading_g, e.rpm, e.impeller, e.reaction_time_hr, e.conversion_pct, e.selectivity_liquid_pct, e.carbon_balance_pct].join(",")).join("\n"),
  });
  const serverAgentEnabled = Boolean(activeProjectId);
  const updateActionInHistory = (actionId, patch) => {
    setHistory((current) => current.map((message) => {
      if (!Array.isArray(message.actions)) return message;
      return {
        ...message,
        actions: message.actions.map((action) => (
          action.actionId === actionId ? { ...action, ...patch } : action
        )),
      };
    }));
  };
  const actionById = (actionId) => {
    for (const message of history) {
      const action = asArray(message.actions).find((item) => item.actionId === actionId);
      if (action) return action;
    }
    return null;
  };
  const reloadProjectAfterAgentAction = async () => {
    if (!activeProjectId) return null;
    const state = await getServerProjectState(activeProjectId);
    onProjectStateLoaded?.(state);
    return state;
  };
  const chartProposalActionPayload = (action) => action.chartProposalSetPayload
    || action.chartProposalSet?.payload
    || action.preview?.chartProposalSetPayload
    || null;
  const acceptAgentChartProposal = async (actionId) => {
    const action = actionById(actionId);
    if (!action || busyActionId) return;
    if (!action.chartProposalSetId || !action.proposalId) {
      updateActionInHistory(actionId, { error: "No chart proposal is available to accept." });
      return;
    }
    const proposalSetPayload = chartProposalActionPayload(action);
    if (!proposalSetPayload?.proposals?.length) {
      updateActionInHistory(actionId, { error: "The chart proposal payload is missing. Open Chart proposals to review it." });
      return;
    }
    setBusyActionId(actionId);
    updateActionInHistory(actionId, { status: "accepting_proposal", error: "" });
    try {
      const baseProposalSet = {
        ...proposalSetPayload,
        proposalSetId: proposalSetPayload.proposalSetId || action.chartProposalSetId,
        serverId: action.chartProposalSetId,
      };
      const nextProposalSet = setChartProposalStatus(baseProposalSet, action.proposalId, "accepted");
      const saved = await patchServerChartProposalSet(action.chartProposalSetId, {
        status: "proposed",
        payload: nextProposalSet,
        decisionSummary: decisionSummary(nextProposalSet.proposals),
      });
      const savedPayload = saved.chartProposalSet
        ? payloadWithServerId(saved.chartProposalSet, "proposalSetId")
        : nextProposalSet;
      updateActionInHistory(actionId, {
        status: "proposal_accepted",
        proposalStatus: "accepted",
        chartProposalSetPayload: savedPayload,
        preview: {
          ...(action.preview || {}),
          message: "Proposal accepted. Create a ChartSpec to use it in Manuscript.",
        },
        error: "",
      });
      await reloadProjectAfterAgentAction();
    } catch (err) {
      updateActionInHistory(actionId, {
        status: action.status || "completed",
        error: err.message || String(err),
      });
    } finally {
      setBusyActionId("");
    }
  };
  const createAgentChartSpec = async (actionId) => {
    const action = actionById(actionId);
    if (!action || busyActionId) return;
    if (!action.chartProposalSetId || !action.proposalId) {
      updateActionInHistory(actionId, { error: "No accepted proposal is available for ChartSpec creation." });
      return;
    }
    if (action.proposalStatus !== "accepted" && action.status !== "proposal_accepted") {
      updateActionInHistory(actionId, { error: "Accept the proposal before creating a ChartSpec." });
      return;
    }
    setBusyActionId(actionId);
    updateActionInHistory(actionId, { status: "creating_chart_spec", error: "" });
    try {
      const response = await createServerChartSpecFromProposal(activeProjectId, {
        chartProposalSetId: action.chartProposalSetId,
        proposalId: action.proposalId,
      });
      const chartSpec = response.chartSpec || null;
      updateActionInHistory(actionId, {
        status: "chart_spec_created",
        proposalStatus: "accepted",
        chartSpecId: chartSpec?.id || action.chartSpecId || "",
        preview: {
          ...(action.preview || {}),
          message: chartSpec?.id
            ? `Created ChartSpec ${chartSpec.id}. It is available in Manuscript Approved Charts.`
            : "Created a ChartSpec. It is available in Manuscript Approved Charts.",
        },
        error: "",
      });
      await reloadProjectAfterAgentAction();
    } catch (err) {
      updateActionInHistory(actionId, {
        status: "proposal_accepted",
        error: err.message || String(err),
      });
    } finally {
      setBusyActionId("");
    }
  };
  const createImportRunFromAgentFile = async (action, { file = null, fileObjectId = "" } = {}) => {
    if (!activeProjectId) throw new Error("Select a server project first.");
    let nextFileObjectId = fileObjectId;
    if (!nextFileObjectId && file) {
      const uploaded = await uploadServerProjectFile(activeProjectId, file);
      nextFileObjectId = uploaded.fileObject?.id;
    }
    if (!nextFileObjectId) throw new Error("Choose a workbook file first.");
    const runResponse = await createServerImportRun(activeProjectId, nextFileObjectId);
    const importRun = runResponse.importRun;
    const approvedBlockIds = scanBlockIds(importRun.scanResult);
    if (!approvedBlockIds.length) throw new Error("No importable workbook blocks were detected.");
    const normalizeResponse = await previewServerImportRunNormalization(importRun.id, { approvedBlockIds });
    const normalizePreview = normalizeResponse.importRun?.normalizePreview || importRun.normalizePreview;
    const normalizeSummary = summarizeNormalizePreview(normalizePreview);

    if (action.type === "upload_supplement") {
      const relationshipPreview = await previewServerImportRelationship(importRun.id, {});
      const aliases = asArray(action.params?.targetExperimentAliases).map((item) => String(item).toLowerCase());
      const proposals = selectableRelationshipProposals(relationshipPreview);
      const proposal = proposals.find((candidate) => (
        aliases.length && asArray(candidate.targetExperimentIds).some((target) => aliases.some((alias) => String(target).toLowerCase().includes(alias)))
      )) || proposals.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0] || null;
      updateActionInHistory(action.actionId, {
        status: proposal ? "ready_to_apply" : "failed",
        importRunId: importRun.id,
        preview: {
          summary: normalizeSummary,
          relationshipProposal: proposal,
          warnings: relationshipPreview.warnings,
        },
        relationshipDecision: proposal,
        error: proposal ? "" : "No supplemental relationship target was found.",
      });
      return;
    }

    if (action.type === "refresh_master_table") {
      const parentCommitId = projectState?.currentDatasetCommit?.id || projectState?.project?.currentDatasetCommitId || action.params?.expectedParentDatasetCommitId || "";
      const targetImport = getMasterImports(dataset)[0];
      if (!parentCommitId || !targetImport?.importId) throw new Error("Refresh requires an active master import.");
      const refreshPreview = await previewServerImportRefresh(importRun.id, {
        replaceImportId: targetImport.importId,
        expectedParentDatasetCommitId: parentCommitId,
      });
      updateActionInHistory(action.actionId, {
        status: refreshPreview.hasChanges ? "ready_to_apply" : "failed",
        importRunId: importRun.id,
        replaceImportId: targetImport.importId,
        expectedParentDatasetCommitId: parentCommitId,
        preview: {
          summary: refreshPreview.summary,
          message: refreshPreview.hasChanges ? "Refresh diff is ready for confirmation." : "No changes detected.",
          warnings: refreshPreview.warnings,
        },
        error: refreshPreview.hasChanges ? "" : "No changes detected in the replacement workbook.",
      });
      return;
    }

    updateActionInHistory(action.actionId, {
      status: "ready_to_apply",
      importRunId: importRun.id,
      preview: { summary: normalizeSummary },
      error: "",
    });
  };
  const executeAgentAction = async (actionId, filePayload = {}) => {
    const action = actionById(actionId);
    if (!action || busyActionId) return;
    setBusyActionId(actionId);
    updateActionInHistory(actionId, { status: action.requiresFile ? "previewing" : "executing", error: "" });
    try {
      if (action.requiresFile) {
        await createImportRunFromAgentFile(action, filePayload);
      } else if (action.type === "resolve_data_query") {
        const response = await resolveServerProjectDataQuery(activeProjectId, { prompt: action.params?.prompt || "" });
        updateActionInHistory(actionId, {
          status: "completed",
          preview: {
            summary: {
              experiments: response.retrievedContext?.experiments?.length || 0,
              fields: response.retrievedContext?.fields?.length || 0,
              imports: response.retrievedContext?.imports?.length || 0,
            },
            message: response.viewIntentDraft?.title || response.clarification?.message || "Data query resolved.",
            warnings: response.warnings,
          },
        });
      } else if (action.type === "propose_charts") {
        const response = await proposeServerProjectCharts(activeProjectId, { userGoal: action.params?.userGoal || "" });
        updateActionInHistory(actionId, {
          status: "completed",
          preview: {
            summary: response.summary || { proposals: response.proposalSet?.proposals?.length || 0 },
            message: `Created chart proposal set ${response.chartProposalSet?.id || ""}.`,
            warnings: response.warnings,
          },
        });
        await reloadProjectAfterAgentAction();
      } else if (action.type === "interpret_chart") {
        const response = await interpretServerProjectChart(activeProjectId, {
          prompt: action.params?.prompt || "",
          persistAsProposal: true,
        });
        const chartProposalSet = response.chartProposalSet || null;
        const proposalPayload = chartProposalSet?.payload || null;
        const proposal = asArray(proposalPayload?.proposals)[0] || null;
        updateActionInHistory(actionId, {
          status: chartProposalSet ? "completed" : "failed",
          chartProposalSetId: chartProposalSet?.id || "",
          chartProposalSetPayload: proposalPayload ? payloadWithServerId(chartProposalSet, "proposalSetId") : null,
          proposalId: proposal?.proposalId || "",
          proposalStatus: proposal?.status || "proposed",
          preview: {
            chartTitle: proposal?.title || response.chartSpecDraft?.title,
            message: chartProposalSet ? `Queued chart proposal set ${chartProposalSet.id}.` : response.clarification?.message || "Chart could not be drafted.",
            warnings: response.warnings,
          },
          error: chartProposalSet ? "" : response.clarification?.message || "Chart draft requires clarification.",
        });
        if (chartProposalSet) await reloadProjectAfterAgentAction();
      } else if (action.type === "compare_series") {
        const params = action.params || {};
        const viewResponse = await createServerAnalysisView(activeProjectId, {
          viewType: params.viewType || "series_compare",
          title: params.title || "Reaction rate comparison",
          spec: {
            seriesKind: params.seriesKind || "reaction_rate_time_series",
            experimentIds: asArray(params.experimentIds),
            xField: params.xField || "reaction_time_min",
            yField: params.yField || "",
            groupBy: params.groupBy || "experiment",
          },
        });
        if (viewResponse.clarification) {
          updateActionInHistory(actionId, {
            status: "failed",
            preview: {
              message: viewResponse.clarification.message || "Compare request needs clarification.",
              warnings: viewResponse.warnings,
            },
            error: viewResponse.clarification.message || "Compare request needs clarification.",
          });
          return;
        }
        const analysisView = viewResponse.analysisView;
        if (!analysisView?.id) throw new Error("The server did not return an AnalysisView.");
        const chartResponse = await createServerAnalysisViewChartProposal(analysisView.id);
        const chartProposalSet = chartResponse.chartProposalSet || chartResponse.proposalSet || null;
        const proposalPayload = chartProposalSet?.payload || chartResponse.proposalSet || null;
        const proposal = asArray(proposalPayload?.proposals)[0] || null;
        updateActionInHistory(actionId, {
          status: chartProposalSet ? "completed" : "failed",
          analysisViewId: analysisView.id,
          analysisView,
          chartProposalSetId: chartProposalSet?.id || "",
          chartProposalSetPayload: chartProposalSet?.payload ? payloadWithServerId(chartProposalSet, "proposalSetId") : proposalPayload,
          proposalId: proposal?.proposalId || "",
          proposalStatus: proposal?.status || "proposed",
          preview: {
            chartTitle: proposal?.title || analysisView.title,
            message: chartProposalSet ? `Queued chart proposal set ${chartProposalSet.id}.` : "Compare chart proposal could not be created.",
            warnings: chartResponse.warnings,
          },
          error: chartProposalSet ? "" : "Compare chart proposal could not be created.",
        });
        if (chartProposalSet) await reloadProjectAfterAgentAction();
      } else if (action.type === "create_chart_spec_from_proposal") {
        if (!action.params?.chartProposalSetId || !action.params?.proposalId) throw new Error("No accepted proposal is available for ChartSpec creation.");
        updateActionInHistory(actionId, { status: "ready_to_create" });
      }
    } catch (err) {
      updateActionInHistory(actionId, { status: "failed", error: err.message || String(err) });
    } finally {
      setBusyActionId("");
    }
  };
  const confirmAgentAction = async (actionId) => {
    const action = actionById(actionId);
    if (!action || busyActionId) return;
    setBusyActionId(actionId);
    updateActionInHistory(actionId, { status: "executing", error: "" });
    try {
      if (action.type === "upload_master_table") {
        await applyServerImportRun(action.importRunId, {
          applyMode: "append",
          reviewNote: "Applied master table from LabRat chat action.",
        });
        await reloadProjectAfterAgentAction();
      } else if (action.type === "upload_supplement") {
        if (!action.relationshipDecision) throw new Error("Supplement relationship preview is missing.");
        await applyServerImportRun(action.importRunId, {
          applyMode: "supplement_import",
          relationshipDecision: action.relationshipDecision,
          reviewNote: "Applied supplemental workbook from LabRat chat action.",
        });
        await reloadProjectAfterAgentAction();
      } else if (action.type === "refresh_master_table") {
        await applyServerImportRun(action.importRunId, {
          applyMode: "replace_import",
          replaceImportId: action.replaceImportId,
          expectedParentDatasetCommitId: action.expectedParentDatasetCommitId,
          reviewNote: "Applied master table refresh from LabRat chat action.",
        });
        await reloadProjectAfterAgentAction();
      } else if (action.type === "create_chart_spec_from_proposal") {
        await createServerChartSpecFromProposal(activeProjectId, {
          chartProposalSetId: action.params?.chartProposalSetId,
          proposalId: action.params?.proposalId,
        });
        await reloadProjectAfterAgentAction();
      }
      updateActionInHistory(actionId, { status: "completed", error: "" });
    } catch (err) {
      updateActionInHistory(actionId, { status: "failed", error: err.message || String(err) });
    } finally {
      setBusyActionId("");
    }
  };
  const chooseFileForAgentAction = (actionId) => {
    setPendingFileActionId(actionId);
    fileActionInputRef.current?.click();
  };
  const onAgentFileSelected = async (event) => {
    const file = event.target.files?.[0];
    const actionId = pendingFileActionId;
    event.target.value = "";
    setPendingFileActionId("");
    if (file && actionId) await executeAgentAction(actionId, { file });
  };
  const appendStreamDelta = (streamId, delta) => {
    setHistory((current) => current.map((message) => (
      message.streamId === streamId ? { ...message, text: `${message.text || ""}${delta}` } : message
    )));
  };
  const finishStreamMessage = (streamId, patch = {}) => {
    setHistory((current) => current.map((message) => {
      if (message.streamId !== streamId) return message;
      const { streaming, streamId: _streamId, ...rest } = message;
      return { ...rest, ...patch };
    }));
  };
  const readAnthropicStream = async (body, onText) => {
    if (!body) throw new Error("Streaming response body is unavailable.");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const handleEvent = (rawEvent) => {
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      const event = JSON.parse(data);
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        onText(event.delta.text || "");
      }
      if (event.type === "error") {
        throw new Error(event.error?.message || "Streaming request failed.");
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      parts.forEach((part) => part.trim() && handleEvent(part));
      if (done) break;
    }
    if (buffer.trim()) handleEvent(buffer);
  };
  const send = async (prefill, meta = null) => {
    const text = (prefill ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const next = [...history.map(({ streaming, streamId, ...message }) => message), { role: "user", text, meta }];
    setHistory(next);
    if (serverAgentEnabled && !meta?.source) {
      setBusy(true);
      try {
        const plan = await planServerProjectAgent(activeProjectId, {
          message: text,
          conversation: next.slice(-10).map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            text: message.text,
          })),
          selectedContext: {
            tab: selectedChartContext ? "manuscript_chart" : "project",
            selectedExperimentLabel: selected?.label || "",
            selectedChartTitle: selectedChartContext?.title || "",
          },
        });
        const actions = asArray(plan.actions);
        setHistory([...next, {
          role: "assistant",
          text: plan.reply || (actions.length ? "I prepared a project action for review." : "I could not identify a project action yet."),
          actions,
        }]);
      } catch (err) {
        setHistory([...next, { role: "assistant", text: `Project agent failed: ${err.message || String(err)}` }]);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!apiKey) {
      setHistory([...next, { role: "assistant", text: "Add an Anthropic API key in settings to enable live answers. I can already see the selected chart context locally." }]);
      return;
    }
    const streamId = uid();
    let streamedText = "";
    setHistory([...next, { role: "assistant", text: "", meta, streaming: true, streamId }]);
    setBusy(true);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          stream: true,
          system: `You are LabRat, a concise research assistant for HDPE hydroconversion over Ru/TiO2. Use the JSON context and experiment CSV. Do not invent mechanisms or values. Match the user's saved writing voice when examples are provided, use the project background for scope, and obey house rules. Context:\n${JSON.stringify(context())}`,
          messages: next.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text })),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      await readAnthropicStream(resp.body, (delta) => {
        streamedText += delta;
        appendStreamDelta(streamId, delta);
      });
      finishStreamMessage(streamId, { text: streamedText || "No text response.", meta });
    } catch (err) {
      const failure = `Request failed: ${err.message}`;
      finishStreamMessage(streamId, { text: streamedText ? `${streamedText}\n\n${failure}` : failure, meta });
    } finally {
      setBusy(false);
    }
  };
  const selectedChartMeta = selectedChartContext
    ? { source: "chart", chartBlockId: selectedChartContext.blockId, chartBox: selectedChartContext.block }
    : null;
  const chartPrompt = (task) => {
    if (!selectedChartContext) return;
    const chartJson = JSON.stringify(selectedChartContext);
    const plainTextRule = "Return plain text only. Do not use Markdown headings, bold text, bullet points, numbered lists, tables, labels, or section headers.";
    const prompts = {
      describe: `Describe the selected chart for insertion into a manuscript text box. Write one polished paragraph of 80-130 words. Focus on what is plotted, the major trend, and any caveats visible from the data. Avoid inventing mechanisms. ${plainTextRule} Selected chart JSON:\n${chartJson}`,
      trend: `Summarize the key trend in the selected chart for insertion into a manuscript text box. Write 2-3 concise plain sentences. Mention experiment labels and values when useful. Avoid overclaiming. ${plainTextRule} Selected chart JSON:\n${chartJson}`,
      caption: `Draft a manuscript-style figure caption for insertion into a manuscript text box. Write 1-2 concise plain sentences. Include chart type, compared experiments, plotted quantities, and a neutral takeaway. ${plainTextRule} Selected chart JSON:\n${chartJson}`,
    };
    send(prompts[task], selectedChartMeta);
  };
  useEffect(() => {
    if (!pendingChartAnalysis || busy) return;
    if (pendingChartAnalysis.blockId !== selectedChartContext?.blockId) return;
    onChartAnalysisHandled?.(pendingChartAnalysis.nonce);
    chartPrompt("describe");
  }, [pendingChartAnalysis?.nonce, pendingChartAnalysis?.blockId, selectedChartContext?.blockId, busy]);
  const cleanAssistantText = (text) => String(text || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const insertAssistantText = (message) => {
    const box = message.meta?.chartBox || selectedChartContext?.block;
    const id = uid();
    const cleanedText = cleanAssistantText(message.text);
    setBlocks((currentBlocks) => {
      const current = Array.isArray(currentBlocks) ? currentBlocks : [];
      return [...current, {
        id,
        kind: "text",
        x: Math.max(0, box?.x ?? 120),
        y: Math.max(0, (box?.y ?? 120) + (box?.h ?? 220) + 24),
        w: Math.max(360, Math.min(box?.w ?? 520, 700)),
        h: 180,
        html: cleanedText,
        fontSize: 14,
      }];
    });
  };
  const logoSrc = `${import.meta.env.BASE_URL}labrat-logo.png`;
  const closeAgent = () => {
    setExpanded(false);
    setOpen(false);
  };
  return <>
  <aside className={`agent ${open ? "open" : ""} ${expanded ? "expanded" : ""}`}>
    <div className="agent-head">
      <div className="agent-title">
        <img src={logoSrc} alt="" />
        <span>the lab rat</span>
      </div>
      <div className="agent-head-actions">
        <button type="button" aria-label={expanded ? "Collapse Lab Rat panel" : "Expand Lab Rat panel"} title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded((value) => !value)}>{expanded ? "\u2199" : "\u2197"}</button>
        <button type="button" className={settingsOpen ? "active" : ""} aria-label="Settings" title="Settings" onClick={openSettings}>&#9881;</button>
        <button type="button" aria-label="Reset chat" title="Reset chat" onClick={() => setHistory([])}>&#8635;</button>
        <button type="button" aria-label="Close Lab Rat panel" title="Close" onClick={closeAgent}>&times;</button>
      </div>
    </div>
    <div className="agent-context">Manuscript 路 {blocks.length} blocks on canvas 路 focused: {selected?.label || "none"} 路 {selectedChartContext ? "1 chart selected" : "0 charts selected"}</div>
    {selectedChartContext && (
      <div className="agent-chart-context">
        <img className="agent-chart-avatar" src={logoSrc} alt="" />
        <div className="agent-chart-copy">
          <button type="button" className="agent-chart-callout" disabled={busy} onClick={() => chartPrompt("describe")}>Want help writing about this chart?</button>
          <span>Selected chart: {selectedChartContext.title}</span>
          <div className="agent-chart-actions">
            <button disabled={busy} onClick={() => chartPrompt("describe")}>Analysis</button>
            <button disabled={busy} onClick={() => chartPrompt("trend")}>Trend</button>
            <button disabled={busy} onClick={() => chartPrompt("caption")}>Caption</button>
          </div>
        </div>
      </div>
    )}
    <div className="messages">
      {!history.length && <div className="welcome">
        <img className="welcome-avatar" src={logoSrc} alt="" />
        <span>Hi! I'm the lab rat.</span>
        <p>I can read all your experiments, the manuscript canvas, and references. Ask me anything: analyze a chart, compare experiments, draft a paragraph, or explain a result.</p>
        <button onClick={() => send("Give me a one-paragraph overview of the trends across all experiments.")}>Overview of all experiments</button>
        <button onClick={() => send("Which experiment has the highest liquid selectivity, and why?")}>Highest liquid selectivity?</button>
        <button onClick={() => send("Compare reaction time vs selectivity across the experiments. Highlight the main trend and any caveats.")}>Reaction time vs selectivity</button>
      </div>}
      {history.map((m, i) => <div key={i} className={`msg ${m.role}`}>
        {m.role === "assistant" ? <img className="msg-avatar" src={logoSrc} alt="" /> : <span className="msg-avatar user">You</span>}
        <div className="msg-body">
          <span>{m.role === "user" ? "You" : "the lab rat"}</span>
          <p>{m.text}</p>
          {asArray(m.actions).map((action) => (
            <AgentActionCard
              key={action.actionId}
              action={action}
              projectState={projectState}
              busyActionId={busyActionId}
              onChooseFile={chooseFileForAgentAction}
              onUseExistingFile={(actionId, fileObjectId) => executeAgentAction(actionId, { fileObjectId })}
              onExecute={executeAgentAction}
              onConfirm={confirmAgentAction}
              onAcceptChartProposal={acceptAgentChartProposal}
              onCreateChartSpec={createAgentChartSpec}
              onInsertChartSpec={onInsertChartSpec}
            />
          ))}
          {m.role === "assistant" && m.meta?.source === "chart" && m.text && !m.streaming && !m.text.startsWith("Request failed:") && <button className="insert-chat-text" onClick={() => insertAssistantText(m)}>Insert as text box</button>}
        </div>
      </div>)}
      {busy && !history.some((m) => m.role === "assistant" && m.streaming && m.text) && <div className="typing">Thinking...</div>}
    </div>
    <div className="agent-foot">
      <button type="button" className="agent-tool" aria-label="Attach reference">+</button>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask the rat about your data, charts, or manuscript..." />
      <button type="button" className="agent-send" onClick={() => send()}>&#8593;</button>
      <input ref={fileActionInputRef} className="agent-file-input" type="file" accept=".xlsx,.xls" onChange={onAgentFileSelected} />
    </div>
  </aside>
  {settingsOpen && (
    <div className="settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancelSettings()}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="labrat-settings-title">
        <div className="settings-head">
          <h2 id="labrat-settings-title">Lab rat settings</h2>
          <button type="button" aria-label="Close settings" onClick={cancelSettings}>&times;</button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <h3>API</h3>
            <label className="settings-field">
              <span>Anthropic API key</span>
              <input type="password" value={settingsDraft.apiKey} onChange={(e) => updateSettingsDraft("apiKey", e.target.value)} />
            </label>
            <p className="settings-help">Get a key at <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a> - API Keys. Stored only in your browser's local storage. New accounts get free credits.</p>
            <label className="settings-field">
              <span>Model</span>
              <select value={settingsDraft.model} onChange={(e) => updateSettingsDraft("model", e.target.value)}>
                {settingsDraft.model && !["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-3-5"].includes(settingsDraft.model) && (
                  <option value={settingsDraft.model}>{settingsDraft.model}</option>
                )}
                <option value="claude-sonnet-4-5">Claude Sonnet 4.5 (recommended)</option>
                <option value="claude-opus-4-1">Claude Opus 4.1</option>
                <option value="claude-haiku-3-5">Claude Haiku 3.5</option>
              </select>
            </label>
          </section>
          <section className="settings-section">
            <h3>Voice &amp; Context</h3>
            <p className="settings-help">Anything you put here is included in every chat. The agent picks up your writing voice from the examples, learns your project from the background, and obeys the house rules.</p>
            <div className="settings-textarea-head">
              <label htmlFor="writing-examples">Your writing examples</label>
              <button type="button" disabled>Load from file...</button>
            </div>
            <textarea id="writing-examples" className="settings-large-textarea" value={settingsDraft.writingExamples} onChange={(e) => updateSettingsDraft("writingExamples", e.target.value)} placeholder="Paste 2-4 paragraphs you've written before (analysis paragraphs from previous papers, discussion sections, captions). The agent will match this voice." />
            <div className="settings-textarea-head">
              <label htmlFor="project-background">Lab / project background</label>
              <button type="button" disabled>Load from file...</button>
            </div>
            <textarea id="project-background" className="settings-medium-textarea" value={settingsDraft.projectBackground} onChange={(e) => updateSettingsDraft("projectBackground", e.target.value)} placeholder="What's the broader study about? What catalysts, polymers, or systems are in scope? Any terminology specific to your lab the agent should know." />
            <div className="settings-textarea-head">
              <label htmlFor="house-rules">House rules</label>
              <button type="button" disabled>Load from file...</button>
            </div>
            <textarea id="house-rules" className="settings-medium-textarea" value={settingsDraft.houseRules} onChange={(e) => updateSettingsDraft("houseRules", e.target.value)} placeholder="Conventions, e.g.: use SI units; selectivity reported as % with one decimal; never say 'highly significant'; cite as Author (year)." />
          </section>
        </div>
        <div className="settings-actions">
          <button type="button" onClick={cancelSettings}>Cancel</button>
          <button type="button" className="settings-save" onClick={saveSettings}>Save</button>
        </div>
      </section>
    </div>
  )}
  </>;
}

function App() {
  const [tab, setTab] = useState("overview");
  const [workspaceMode, setWorkspaceMode] = useState("dashboard");
  const [dataset, setDataset] = useState(() => emptyDataset());
  const [sourceName, setSourceName] = useState(BLANK_PROJECT_SOURCE_NAME);
  const [sourceError, setSourceError] = useState("");
  const [loadingSource, setLoadingSource] = useState(false);
  const [staged, setStaged] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [pages, setPages] = useState(null);
  const [pageOrientationPreference, setPageOrientationPreference] = useState(null);
  const [chartTemplates, setChartTemplates] = useState([]);
  const [references, setReferences] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedChartContext, setSelectedChartContext] = useState(null);
  const [pendingChartAnalysis, setPendingChartAnalysis] = useState(null);
  const [chartSpecInsertRequest, setChartSpecInsertRequest] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [authState, setAuthState] = useState({ checking: true, loading: false, user: null, labs: [], error: "" });
  const [labs, setLabs] = useState([]);
  const [activeLabId, setActiveLabId] = useState("");
  const [projectList, setProjectList] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [projectState, setProjectState] = useState(null);
  const [projectStateLoading, setProjectStateLoading] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectBusy, setNewProjectBusy] = useState(false);
  const [newProjectError, setNewProjectError] = useState("");
  const [deleteProjectTarget, setDeleteProjectTarget] = useState(null);
  const [deleteProjectBusy, setDeleteProjectBusy] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState("");
  const [activeImportRun, setActiveImportRun] = useState(null);
  const [profileChatOpen, setProfileChatOpen] = useState(false);
  const [importReviewOpen, setImportReviewOpen] = useState(false);
  const [mappingReviewOpen, setMappingReviewOpen] = useState(false);
  const [chartReviewOpen, setChartReviewOpen] = useState(false);
  const [focusedChartProposalId, setFocusedChartProposalId] = useState("");
  const [chartReviewStatusFilter, setChartReviewStatusFilter] = useState("");
  const [supplementManagerOpen, setSupplementManagerOpen] = useState(false);
  const [compareSeriesState, setCompareSeriesState] = useState({ open: false, loading: false, error: "", clarification: null });
  const [supplementalBatchState, setSupplementalBatchState] = useState(() => emptySupplementalBatchState());
  const [importReviewMode, setImportReviewMode] = useState("append");
  const [refreshDraft, setRefreshDraft] = useState(() => emptyRefreshDraft());
  const [relationshipDraft, setRelationshipDraft] = useState(() => emptyRelationshipDraft());
  const [importSession, setImportSession] = useState(null);
  const [backendScanState, setBackendScanState] = useState({ loading: false, result: null, error: "", fileName: "" });
  const [backendBlockReview, setBackendBlockReview] = useState(() => createBlockReviewState());
  const [backendNormalizeState, setBackendNormalizeState] = useState({ loading: false, result: null, error: "" });
  const [backendMappingState, setBackendMappingState] = useState({ loading: false, result: null, error: "" });
  const [backendChartProposalState, setBackendChartProposalState] = useState({ loading: false, result: null, error: "" });
  const [backendChartInterpretState, setBackendChartInterpretState] = useState({ loading: false, result: null, error: "" });
  const [fieldRoleOverrides, setFieldRoleOverrides] = useState({});
  const supplementFileInputRef = useRef(null);
  const resetReviewState = () => {
    setBackendScanState({ loading: false, result: null, error: "", fileName: "" });
    setBackendBlockReview(createBlockReviewState());
    setBackendNormalizeState({ loading: false, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setFieldRoleOverrides({});
    setActiveImportRun(null);
    setImportReviewMode("append");
    setRefreshDraft(emptyRefreshDraft());
    setRelationshipDraft(emptyRelationshipDraft());
    setMappingReviewOpen(false);
    setChartReviewOpen(false);
    setFocusedChartProposalId("");
    setChartReviewStatusFilter("");
    setCompareSeriesState({ open: false, loading: false, error: "", clarification: null });
  };
  const resetImportReviewState = () => {
    setBackendScanState({ loading: false, result: null, error: "", fileName: "" });
    setBackendBlockReview(createBlockReviewState());
    setBackendNormalizeState({ loading: false, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setFieldRoleOverrides({});
    setActiveImportRun(null);
    setRelationshipDraft(emptyRelationshipDraft());
  };

  const applyProjectShellState = (state) => {
    setSourceName(state?.project?.name || BLANK_PROJECT_SOURCE_NAME);
    setProjectLoaded(true);
  };

  const applyDatasetState = (state) => {
    const nextDataset = datasetFromServerProjectState(state);
    setDataset(nextDataset);
  };

  const applyReviewState = (state) => {
    const latestMapping = latestItem(state?.mappingSets);
    const latestChartProposal = latestItem(state?.chartProposalSets);
    setBackendMappingState(latestMapping?.payload ? {
      loading: false,
      result: { mappingSet: payloadWithServerId(latestMapping, "mappingSetId") },
      error: "",
    } : { loading: false, result: null, error: "" });
    setBackendChartProposalState(latestChartProposal?.payload ? {
      loading: false,
      result: {
        chartProposalSet: latestChartProposal,
        proposalSet: payloadWithServerId(latestChartProposal, "proposalSetId"),
      },
      error: "",
    } : { loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
  };

  const applyManuscriptState = (state) => {
    const firstManuscript = asArray(state?.manuscripts)[0] || null;
    setBlocks(asArray(firstManuscript?.blocks));
    setPages(firstManuscript?.pages || null);
    setReferences(asArray(firstManuscript?.references));
    setCanvasHeight(firstManuscript?.canvasState?.canvasHeight || 0);
    setPageOrientationPreference(firstManuscript?.canvasState?.pageOrientationPreference || null);
    setDirty(false);
  };

  const applyProjectState = (state) => {
    setChartSpecInsertRequest(null);
    setProjectState(state);
    applyProjectShellState(state);
    applyDatasetState(state);
    applyReviewState(state);
    applyManuscriptState(state);
  };

  const applyProjectWorkspaceRefresh = (state) => {
    setProjectState((current) => mergeProjectStateForWorkspaceRefresh(current, state, { preserveManuscripts: true }));
    applyProjectShellState(state);
    applyDatasetState(state);
    applyReviewState(state);
  };

  const mergeSupplementalBatchIntoState = (batch) => {
    if (!batch?.id) return;
    setSupplementalBatchState((current) => ({ ...current, activeBatchId: batch.id, batch, error: "" }));
    setProjectState((current) => {
      if (!current) return current;
      const batches = asArray(current.supplementalImportBatches);
      const nextBatches = batches.some((item) => item.id === batch.id)
        ? batches.map((item) => item.id === batch.id ? batch : item)
        : [batch, ...batches];
      return { ...current, supplementalImportBatches: nextBatches };
    });
  };

  const refreshProjectWorkspace = async () => {
    if (!activeProjectId) return null;
    const state = await getServerProjectState(activeProjectId);
    applyProjectWorkspaceRefresh(state);
    return state;
  };

  const loadProjectState = async (projectId) => {
    if (!projectId) return;
    setProjectStateLoading(true);
    setSourceError("");
    try {
      resetReviewState();
      const state = await getServerProjectState(projectId);
      setActiveProjectId(projectId);
      setSelectedProjectId(projectId);
      setWorkspaceMode("project");
      setTab("overview");
      setSupplementalBatchState(emptySupplementalBatchState());
      applyProjectState(state);
    } catch (err) {
      setSourceError(err.message || String(err));
    } finally {
      setProjectStateLoading(false);
    }
  };

  const reloadActiveProjectState = async () => {
    if (!activeProjectId) return;
    await loadProjectState(activeProjectId);
    setImportReviewOpen(false);
  };

  const requestChartSpecManuscriptInsert = (chartSpecId) => {
    if (!chartSpecId) return;
    setChartSpecInsertRequest({ chartSpecId, requestId: uid() });
    setTab("manuscript");
  };

  const clearChartSpecManuscriptInsertRequest = (requestId) => {
    setChartSpecInsertRequest((current) => {
      if (!current) return null;
      if (requestId && current.requestId !== requestId) return current;
      return null;
    });
  };

  const loadProjectsForLab = async (labId, preferredProjectId = "", { openPreferred = false } = {}) => {
    if (!labId) return;
    const response = await listServerProjects({ labId });
    const projects = response.projects || [];
    setProjectList(projects);
    const nextProjectId = preferredProjectId && projects.some((project) => project.id === preferredProjectId)
      ? preferredProjectId
      : projects[0]?.id || "";
    setSelectedProjectId(nextProjectId);
    if (openPreferred && nextProjectId) {
      await loadProjectState(nextProjectId);
    } else {
      setActiveProjectId("");
      setProjectState(null);
      setDataset(emptyDataset());
      setProjectLoaded(true);
      setWorkspaceMode("dashboard");
      resetReviewState();
    }
  };

  const loadLabsAndProjects = async (preferredLabId = "", preferredProjectId = "") => {
    const labResponse = await listServerLabs();
    const nextLabs = labResponse.labs || [];
    setLabs(nextLabs);
    const nextLabId = preferredLabId && nextLabs.some((lab) => (lab.id || lab.labId) === preferredLabId)
      ? preferredLabId
      : (nextLabs[0]?.id || nextLabs[0]?.labId || "");
    setActiveLabId(nextLabId);
    if (nextLabId) await loadProjectsForLab(nextLabId, preferredProjectId);
  };

  useEffect(() => {
    let cancelled = false;
    getServerSession()
      .then(async (session) => {
        if (cancelled) return;
        setAuthState({ checking: false, loading: false, user: session.user, labs: session.labs || [], error: "" });
        await loadLabsAndProjects(session.labs?.[0]?.labId || session.labs?.[0]?.id || "");
      })
      .catch((err) => {
        if (!cancelled) {
          setAuthState({ checking: false, loading: false, user: null, labs: [], error: err.status === 401 ? "" : (err.message || String(err)) });
          setProjectLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (projectLoaded) setDirty(true);
  }, [staged, blocks, pages, references, canvasHeight, pageOrientationPreference, chartTemplates]);
  useEffect(() => {
    const batchId = supplementalBatchState.activeBatchId;
    if (!activeProjectId || !batchId) return undefined;
    let cancelled = false;
    let eventSource = null;
    let pollingTimer = null;
    const isTerminalBatch = (batch) => batch && !["queued", "processing"].includes(batch.status);
    const handleBatch = (batch) => {
      if (!batch || cancelled) return;
      mergeSupplementalBatchIntoState(batch);
      if (isTerminalBatch(batch)) {
        setSupplementalBatchState((current) => ({ ...current, uploading: false, usePolling: false }));
        refreshProjectWorkspace().catch((err) => {
          setSupplementalBatchState((current) => ({ ...current, error: err.message || String(err) }));
        });
        if (eventSource) eventSource.close();
        if (pollingTimer) window.clearInterval(pollingTimer);
      }
    };
    const poll = async () => {
      try {
        const response = await getServerSupplementalImportBatch(activeProjectId, batchId);
        handleBatch(response.batch);
      } catch (err) {
        if (!cancelled) setSupplementalBatchState((current) => ({ ...current, error: err.message || String(err) }));
      }
    };
    if (supplementalBatchState.usePolling || typeof EventSource !== "function") {
      poll();
      pollingTimer = window.setInterval(poll, 3000);
      return () => {
        cancelled = true;
        if (pollingTimer) window.clearInterval(pollingTimer);
      };
    }
    eventSource = new EventSource(supplementalImportBatchEventsUrl(activeProjectId, batchId), { withCredentials: true });
    const onMessage = (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        handleBatch(payload.batch);
      } catch (err) {
        setSupplementalBatchState((current) => ({ ...current, error: err.message || String(err) }));
      }
    };
    ["snapshot", "batch", "item", "item_ready", "item_failed", "complete"].forEach((eventName) => {
      eventSource.addEventListener(eventName, onMessage);
    });
    eventSource.onerror = () => {
      setSupplementalBatchState((current) => {
        const failures = current.sseFailures + 1;
        return {
          ...current,
          sseFailures: failures,
          usePolling: failures >= 2,
          error: failures >= 2 ? "Live progress disconnected; falling back to periodic refresh." : current.error,
        };
      });
    };
    return () => {
      cancelled = true;
      if (eventSource) eventSource.close();
    };
  }, [activeProjectId, supplementalBatchState.activeBatchId, supplementalBatchState.usePolling]);
  useEffect(() => {
    const runningBatch = latestItem(asArray(projectState?.supplementalImportBatches).filter((batch) => (
      batch && ["queued", "processing"].includes(batch.status)
    )));
    if (!runningBatch || supplementalBatchState.activeBatchId) return;
    setSupplementalBatchState((current) => ({
      ...current,
      activeBatchId: runningBatch.id,
      batch: runningBatch,
      error: "",
      usePolling: false,
      sseFailures: 0,
    }));
  }, [projectState?.project?.id, projectState?.supplementalImportBatches, supplementalBatchState.activeBatchId]);
  const currentProject = () => buildProjectRecord({ dataset, sourceName, staged, blocks, pages, canvasHeight, pageOrientationPreference, chartTemplates, references });
  const save = async () => {
    try {
      if (activeProjectId) {
        const currentManuscript = asArray(projectState?.manuscripts)[0] || null;
        const request = {
          title: currentManuscript?.title || "Manuscript",
          blocks,
          pages: Array.isArray(pages) ? pages : [],
          canvasState: { canvasHeight, pageOrientationPreference },
          references,
        };
        const response = currentManuscript?.id
          ? await patchServerManuscript(currentManuscript.id, request)
          : await createServerManuscript(activeProjectId, request);
        setProjectState((current) => {
          if (!current) return current;
          const savedManuscript = response.manuscript;
          const currentManuscripts = asArray(current.manuscripts);
          const manuscripts = currentManuscripts.some((manuscript) => manuscript.id === savedManuscript.id)
            ? currentManuscripts.map((manuscript) => manuscript.id === savedManuscript.id ? savedManuscript : manuscript)
            : [savedManuscript, ...currentManuscripts];
          return { ...current, manuscripts };
        });
      } else {
        await saveActiveProject(currentProject());
      }
      setSourceError("");
      setDirty(false);
    } catch (err) {
      setSourceError(`Save failed: ${err.message}`);
    }
  };
  const applyProject = (project) => {
    setDataset(project.dataset);
    setSourceName(project.sourceName);
    setStaged(project.staged);
    setBlocks(project.blocks);
    setPages(project.pages);
    setCanvasHeight(project.canvasHeight);
    setPageOrientationPreference(project.pageOrientationPreference);
    setChartTemplates(project.chartTemplates);
    setReferences(project.references);
    setSelected(null);
    setSelectedChartContext(null);
  };
  const exportProject = () => {
    const project = currentProject();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `labrat-project-${date}.labrat.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const importProject = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const project = normalizeProjectRecord(JSON.parse(text), dataset);
      await saveActiveProject(project);
      applyProject(project);
      setSourceError("");
      setDirty(false);
    } catch (err) {
      setSourceError(`Import failed: ${err.message}`);
    }
  };
  const login = async ({ username, password }) => {
    setAuthState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const session = await loginToServer({ username, password });
      setAuthState({ checking: false, loading: false, user: session.user, labs: session.labs || [], error: "" });
      await loadLabsAndProjects(session.labs?.[0]?.labId || session.labs?.[0]?.id || "");
    } catch (err) {
      setAuthState({ checking: false, loading: false, user: null, labs: [], error: err.message || String(err) });
    }
  };
  const logout = async () => {
    try {
      await logoutFromServer();
    } catch {
      // The local UI still clears its session state if the server already forgot it.
    }
    setAuthState({ checking: false, loading: false, user: null, labs: [], error: "" });
    setLabs([]);
    setActiveLabId("");
    setProjectList([]);
    setSelectedProjectId("");
    setActiveProjectId("");
    setProjectState(null);
    setWorkspaceMode("dashboard");
    setDataset(emptyDataset());
    setSourceName(BLANK_PROJECT_SOURCE_NAME);
    resetReviewState();
  };
  const changeLab = async (labId) => {
    setActiveLabId(labId);
    setProjectList([]);
    setSelectedProjectId("");
    setActiveProjectId("");
    setProjectState(null);
    setWorkspaceMode("dashboard");
    setDataset(emptyDataset());
    await loadProjectsForLab(labId);
  };
  const openNewProjectModal = () => {
    setNewProjectError("");
    setNewProjectOpen(true);
  };
  const createProject = async ({ name, description = "" } = {}) => {
    if (!activeLabId) return;
    if (!name?.trim()) return;
    setSourceError("");
    setNewProjectError("");
    setNewProjectBusy(true);
    try {
      const response = await createServerProject({
        labId: activeLabId,
        name: name.trim(),
        description: description.trim(),
        projectProfile: {},
      });
      setNewProjectOpen(false);
      await loadProjectsForLab(activeLabId, response.project.id, { openPreferred: true });
      setProfileChatOpen(true);
    } catch (err) {
      const message = err.message || String(err);
      setSourceError(message);
      setNewProjectError(message);
    } finally {
      setNewProjectBusy(false);
    }
  };
  const requestDeleteProject = (project) => {
    if (!project?.id) return;
    setDeleteProjectError("");
    setDeleteProjectTarget(project);
  };
  const closeDeleteProjectModal = () => {
    if (deleteProjectBusy) return;
    setDeleteProjectTarget(null);
    setDeleteProjectError("");
  };
  const confirmDeleteProject = async (project = deleteProjectTarget) => {
    if (!project?.id || !activeLabId) return;
    setDeleteProjectBusy(true);
    setDeleteProjectError("");
    setSourceError("");
    try {
      await deleteServerProject(project.id);
      const response = await listServerProjects({ labId: activeLabId });
      const nextProjects = response.projects || [];
      const nextSelectedProjectId = nextProjects[0]?.id || "";
      setProjectList(nextProjects);
      setSelectedProjectId(nextSelectedProjectId);
      if (activeProjectId === project.id) {
        setActiveProjectId("");
        setProjectState(null);
        setDataset(emptyDataset());
        setSourceName(BLANK_PROJECT_SOURCE_NAME);
        setBlocks([]);
        setPages(null);
        setReferences([]);
        setCanvasHeight(0);
        setPageOrientationPreference(null);
        setDirty(false);
        setWorkspaceMode("dashboard");
        setTab("overview");
        resetReviewState();
      }
      setDeleteProjectTarget(null);
    } catch (err) {
      const message = err.message || String(err);
      setDeleteProjectError(message);
      setSourceError(message);
    } finally {
      setDeleteProjectBusy(false);
    }
  };
  const openProjectDashboard = () => {
    setWorkspaceMode("dashboard");
    setImportReviewOpen(false);
    setMappingReviewOpen(false);
    setChartReviewOpen(false);
    setFocusedChartProposalId("");
    setChartReviewStatusFilter("");
    setProfileChatOpen(false);
    setSelectedProjectId(activeProjectId || selectedProjectId || projectList[0]?.id || "");
  };
  const saveProjectProfile = async (projectProfile) => {
    if (!activeProjectId) return null;
    const response = await patchServerProjectProfile(activeProjectId, projectProfile);
    setProjectState((current) => current ? {
      ...current,
      project: response.project || current.project,
      projectProfile: response.projectProfile || projectProfile,
    } : current);
    return response;
  };
  const loadFolder = async (files) => {
    if (!files?.length) return;
    setLoadingSource(true);
    setSourceError("");
    try {
      const next = await parseLocalExcelFolder(files);
      let nextImportSession = null;
      try {
        const scan = await scanExcelFolder(files);
        const proposals = proposeExcelMappingsFromScan(scan);
        nextImportSession = {
          createdAt: new Date().toISOString(),
          scan,
          proposals,
          confirmedProposalIds: [],
          rejectedProposalIds: [],
        };
      } catch (scanErr) {
        nextImportSession = {
          createdAt: new Date().toISOString(),
          scan: { workbookCount: 0, scannedWorkbooks: [] },
          proposals: {
            parserStatus: "stub",
            generatedAt: new Date().toISOString(),
            parserName: "future-ai-parser",
            proposals: [],
            notes: `Scanner unavailable: ${scanErr.message || String(scanErr)}`,
          },
          confirmedProposalIds: [],
          rejectedProposalIds: [],
        };
      }
      setDataset(next);
      setSourceName(`local folder (${next.experiments.length} experiments)`);
      setStaged([]);
      setBlocks([]);
      setPages([]);
      setCanvasHeight(0);
      setPageOrientationPreference(null);
      await saveActiveProject(buildProjectRecord({
        dataset: next,
        sourceName: `local folder (${next.experiments.length} experiments)`,
        staged: [],
        blocks: [],
        pages: [],
        canvasHeight: 0,
        pageOrientationPreference: null,
        chartTemplates,
        references,
      }));
      setImportSession(nextImportSession);
      setDirty(false);
    } catch (err) {
      setSourceError(err.message || String(err));
    } finally {
      setLoadingSource(false);
    }
  };
  const stage = (label) => setStaged((s) => s.includes(label) ? s.filter((x) => x !== label) : [...s, label]);
  const currentDatasetCommitId = () => projectState?.currentDatasetCommit?.id || projectState?.project?.currentDatasetCommitId || null;
  const currentServerMappingSetId = () => backendMappingState.result?.mappingSet?.serverId || latestItem(projectState?.mappingSets)?.id || null;
  const currentMappingSetRecord = () => mappingSetForDatasetCommit(projectState, currentDatasetCommitId());
  const openMappingReview = () => {
    if (!activeProjectId || !currentDatasetCommitId() || !hasMasterImport(dataset)) return;
    setMappingReviewOpen(true);
  };
  const openChartReview = (options = "") => {
    const isOptionsObject = options && typeof options === "object" && !("currentTarget" in options);
    setFocusedChartProposalId(typeof options === "string" ? options : (isOptionsObject && typeof options.proposalId === "string" ? options.proposalId : ""));
    setChartReviewStatusFilter(isOptionsObject && options.statusFilter === "active" ? "active" : "");
    setChartReviewOpen(true);
  };
  const openCompareSeries = () => {
    setSupplementManagerOpen(false);
    setCompareSeriesState({ open: true, loading: false, error: "", clarification: null });
  };
  const closeCompareSeries = () => {
    if (compareSeriesState.loading) return;
    setCompareSeriesState({ open: false, loading: false, error: "", clarification: null });
  };
  const closeChartReview = () => {
    setChartReviewOpen(false);
    setFocusedChartProposalId("");
    setChartReviewStatusFilter("");
  };
  const createCompareSeriesProposal = async (request) => {
    if (!activeProjectId || !currentDatasetCommitId()) {
      setCompareSeriesState((current) => ({
        ...current,
        loading: false,
        error: "Open a server project with a committed dataset before comparing series.",
      }));
      return;
    }
    setCompareSeriesState((current) => ({ ...current, loading: true, error: "", clarification: null }));
    try {
      const viewResult = await createServerAnalysisView(activeProjectId, {
        viewType: "series_compare",
        title: request.title,
        spec: {
          seriesKind: request.seriesKind,
          experimentIds: request.experimentIds || [],
          xField: request.xField,
          yField: request.yField,
          groupBy: request.groupBy || "experiment",
        },
      });
      if (viewResult.clarification) {
        setCompareSeriesState((current) => ({
          ...current,
          loading: false,
          clarification: viewResult.clarification,
          error: "",
        }));
        return;
      }
      const analysisView = viewResult.analysisView;
      if (!analysisView?.id) throw new Error("The server did not return an AnalysisView.");
      const chartResult = await createServerAnalysisViewChartProposal(analysisView.id);
      const chartProposalSet = chartResult.chartProposalSet || chartResult.proposalSet || null;
      const proposalSet = chartProposalSet?.payload
        ? payloadWithServerId(chartProposalSet, "proposalSetId")
        : chartResult.proposalSet;
      if (!proposalSet) throw new Error("The server did not return a chart proposal set.");
      setBackendChartProposalState({
        loading: false,
        result: { ...chartResult, analysisView, chartProposalSet, proposalSet },
        error: "",
      });
      setDataset((current) => upsertGenericChartProposalSet(current, proposalSet));
      setProjectState((current) => current ? {
        ...current,
        analysisViews: upsertServerRecordById(current.analysisViews, analysisView),
        chartProposalSets: chartProposalSet?.id
          ? upsertServerRecordById(current.chartProposalSets, chartProposalSet)
          : asArray(current.chartProposalSets),
      } : current);
      const firstProposalId = asArray(proposalSet.proposals)[0]?.proposalId || "";
      setCompareSeriesState({ open: false, loading: false, error: "", clarification: null });
      setFocusedChartProposalId(firstProposalId);
      setChartReviewStatusFilter("");
      setChartReviewOpen(true);
      setDirty(true);
    } catch (err) {
      setCompareSeriesState((current) => ({
        ...current,
        loading: false,
        error: err.message || String(err),
        clarification: null,
      }));
    }
  };
  const saveMappingReviewDraft = async (mappingSetRecord, mappingPayload) => {
    if (!mappingSetRecord?.id) throw new Error("Generate mappings before saving changes.");
    const saved = await patchServerMappingSet(mappingSetRecord.id, {
      status: "proposed",
      payload: mappingPayload,
      decisionSummary: decisionSummary(mappingPayload.mappings),
    });
    const state = await getServerProjectState(activeProjectId);
    applyProjectWorkspaceRefresh(state);
    const savedRecord = state.mappingSets?.find((set) => set.id === saved.mappingSet.id) || saved.mappingSet;
    return savedRecord;
  };
  const generateMappingReviewMappings = async () => {
    const datasetCommitId = currentDatasetCommitId();
    const genericImports = getMasterImports(dataset);
    if (!activeProjectId || !datasetCommitId || !genericImports.length) {
      throw new Error("Generate mappings requires a committed master table.");
    }
    const result = await proposeSemanticMappingsWithBackend({
      genericImports,
      selectedImportIds: genericImports.map((item) => item.importId).filter(Boolean),
      scanSummary: null,
      priorDecisions: (dataset.genericMappingSets || []).flatMap((set) => set.mappings || []),
    });
    const existingCurrentRecord = latestItem(asArray(projectState?.mappingSets).filter((set) => set?.datasetCommitId === datasetCommitId));
    const request = {
      importRunId: existingCurrentRecord?.importRunId || null,
      datasetCommitId,
      schemaVersion: result.schemaVersion,
      status: "proposed",
      payload: result.mappingSet,
      decisionSummary: decisionSummary(result.mappingSet.mappings),
    };
    const saved = existingCurrentRecord?.id
      ? await patchServerMappingSet(existingCurrentRecord.id, request)
      : await createServerMappingSet(activeProjectId, request);
    const state = await getServerProjectState(activeProjectId);
    applyProjectWorkspaceRefresh(state);
    const savedId = saved.mappingSet?.id;
    return state.mappingSets?.find((set) => set.id === savedId) || saved.mappingSet;
  };
  const openAppendImportReview = () => {
    setImportReviewMode("append");
    setRefreshDraft(emptyRefreshDraft());
    setRelationshipDraft(emptyRelationshipDraft());
    setImportReviewOpen(true);
  };
  const openRefreshWorkbook = () => {
    const committedImports = getMasterImports(dataset).filter((item) => item?.importId);
    const parentCommitId = currentDatasetCommitId();
    if (!activeProjectId || !parentCommitId || !committedImports.length) return;
    resetImportReviewState();
    const targetImport = latestItem(committedImports);
    setImportReviewMode("refresh");
    setRefreshDraft({
      ...emptyRefreshDraft(),
      open: true,
      replaceImportId: targetImport.importId,
      expectedParentDatasetCommitId: parentCommitId,
      targetImport,
    });
  };
  const openSupplementWorkbook = () => {
    if (!activeProjectId || !currentDatasetCommitId() || !hasMasterImport(dataset)) return;
    supplementFileInputRef.current?.click();
  };
  const startSupplementalBatch = async (fileObjectIds) => {
    if (!activeProjectId || !fileObjectIds?.length) return null;
    setSupplementalBatchState((current) => ({ ...current, uploading: true, error: "", usePolling: false, sseFailures: 0 }));
    const response = await createServerSupplementalImportBatch(activeProjectId, { fileObjectIds });
    const batch = response.batch;
    mergeSupplementalBatchIntoState(batch);
    setSupplementalBatchState((current) => ({
      ...current,
      activeBatchId: batch.id,
      batch,
      uploading: false,
      error: "",
      usePolling: false,
      sseFailures: 0,
    }));
    setSupplementManagerOpen(true);
    return batch;
  };
  const handleSupplementFilesSelected = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !activeProjectId || !currentDatasetCommitId() || !hasMasterImport(dataset)) return;
    if (files.length === 1) {
      resetImportReviewState();
      setImportReviewMode("supplement");
      setRefreshDraft(emptyRefreshDraft());
      setRelationshipDraft(emptyRelationshipDraft());
      setImportReviewOpen(true);
      await runBackendScan(files[0], { mode: "supplement" });
      return;
    }
    setSupplementManagerOpen(true);
    setSupplementalBatchState({
      ...emptySupplementalBatchState(),
      uploading: true,
    });
    try {
      const { fileObjects, batch } = await uploadSupplementalFilesAsBatch({
        projectId: activeProjectId,
        files,
        concurrency: 3,
      });
      setProjectState((current) => current ? {
        ...current,
        fileObjects: [...asArray(current.fileObjects), ...fileObjects],
      } : current);
      mergeSupplementalBatchIntoState(batch);
      setSupplementalBatchState((current) => ({
        ...current,
        activeBatchId: batch.id,
        batch,
        uploading: false,
        error: "",
        usePolling: false,
        sseFailures: 0,
      }));
    } catch (err) {
      setSupplementalBatchState((current) => ({
        ...current,
        uploading: false,
        error: err.message || String(err),
      }));
    }
  };
  const openSupplementImportRunReview = async (importRunId) => {
    let run = asArray(projectState?.importRuns).find((item) => item?.id === importRunId);
    let stateForRun = projectState;
    if (!run && activeProjectId) {
      try {
        stateForRun = await refreshProjectWorkspace();
        run = asArray(stateForRun?.importRuns).find((item) => item?.id === importRunId);
      } catch {
        run = null;
      }
    }
    if (!run) {
      setSourceError("Supplemental import run was not found. Reload the project and try again.");
      return;
    }
    const fileObject = asArray(stateForRun?.fileObjects).find((item) => item?.id === run.fileObjectId);
    const fileName = fileObject?.originalName || run.scanResult?.file?.name || "";
    setSupplementManagerOpen(false);
    setImportReviewMode("supplement");
    setRefreshDraft(emptyRefreshDraft());
    setActiveImportRun(run);
    setBackendScanState({
      loading: false,
      result: run.scanResult || null,
      error: run.scanResult ? "" : "This supplemental import run does not have scan details.",
      fileName,
    });
    setBackendBlockReview(createBlockReviewState(run.scanResult, run.reviewDecisions || {}));
    setBackendNormalizeState({ loading: false, result: run.normalizePreview || null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setFieldRoleOverrides({});
    setRelationshipDraft(emptyRelationshipDraft());
    setImportReviewOpen(true);
    if (run.status === "normalized_preview" && run.normalizePreview) {
      setRelationshipDraft((current) => ({ ...current, preview: null, selectedProposalId: "", loading: true, error: "" }));
      try {
        const relationshipPreview = await previewServerImportRelationship(run.id, {});
        const selected = selectableRelationshipProposals(relationshipPreview)
          .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0] || null;
        setRelationshipDraft({
          preview: relationshipPreview,
          selectedProposalId: selected?.relationshipProposalId || "",
          loading: false,
          error: "",
        });
      } catch (err) {
        setRelationshipDraft({
          ...emptyRelationshipDraft(),
          error: err.message || String(err),
        });
      }
    }
  };
  const retrySupplementalBatchItem = async (fileObjectId) => {
    if (!fileObjectId) return;
    try {
      await startSupplementalBatch([fileObjectId]);
    } catch (err) {
      setSupplementalBatchState((current) => ({ ...current, error: err.message || String(err), uploading: false }));
    }
  };
  const applySelectedSupplementalBatchItems = async (items = []) => {
    const readyItems = asArray(items).filter(batchItemReadyForApply);
    if (!readyItems.length || !activeProjectId) return;
    const ok = window.confirm(`Apply ${readyItems.length} reviewed supplemental workbook(s) to the active dataset?`);
    if (!ok) return;
    setSupplementalBatchState((current) => ({ ...current, applying: true, error: "" }));
    try {
      for (const item of readyItems) {
        const relationshipDecision = selectableRelationshipForBatchItem(item);
        await applyServerImportRun(item.importRunId, {
          applyMode: "supplement_import",
          relationshipDecision,
          reviewNote: "Applied supplemental workbook from batch.",
        });
      }
      const state = await getServerProjectState(activeProjectId);
      applyProjectWorkspaceRefresh(state);
      setSupplementalBatchState((current) => ({ ...current, applying: false, error: "" }));
    } catch (err) {
      setSupplementalBatchState((current) => ({
        ...current,
        applying: false,
        error: err.message || String(err),
      }));
    }
  };
  const closeRefreshWorkbookModal = () => {
    setImportReviewMode("append");
    setRefreshDraft(emptyRefreshDraft());
  };
  const setBackendFieldOverride = (fieldId, patch) => {
    setFieldRoleOverrides((current) => ({
      ...current,
      [fieldId]: { ...(current[fieldId] || {}), ...patch },
    }));
    setBackendNormalizeState({ loading: false, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setRelationshipDraft(emptyRelationshipDraft());
    if (importReviewMode === "refresh") {
      setRefreshDraft((current) => ({ ...current, preview: null, loading: false, error: "" }));
    }
  };
  const requestChartAnalysis = (blockId) => {
    setAgentOpen(true);
    setPendingChartAnalysis({ blockId, nonce: Date.now() });
  };
  const clearChartAnalysisRequest = (nonce) => {
    setPendingChartAnalysis((request) => request?.nonce === nonce ? null : request);
  };
  const approveImportProposal = (proposalId) => {
    setImportSession((current) => current ? {
      ...current,
      confirmedProposalIds: current.confirmedProposalIds.includes(proposalId) ? current.confirmedProposalIds : [...current.confirmedProposalIds, proposalId],
      rejectedProposalIds: current.rejectedProposalIds.filter((id) => id !== proposalId),
    } : current);
  };
  const rejectImportProposal = (proposalId) => {
    setImportSession((current) => current ? {
      ...current,
      rejectedProposalIds: current.rejectedProposalIds.includes(proposalId) ? current.rejectedProposalIds : [...current.rejectedProposalIds, proposalId],
      confirmedProposalIds: current.confirmedProposalIds.filter((id) => id !== proposalId),
    } : current);
  };
  const runBackendScan = async (file, options = {}) => {
    if (!file) return;
    const scanMode = options.mode || importReviewMode;
    setBackendScanState({ loading: true, result: null, error: "", fileName: file.name });
    setBackendBlockReview(createBlockReviewState());
    setBackendNormalizeState({ loading: false, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setFieldRoleOverrides({});
    setRelationshipDraft(emptyRelationshipDraft());
    if (scanMode === "refresh") {
      setRefreshDraft((current) => ({ ...current, preview: null, loading: false, error: "" }));
    }
    try {
      let result;
      if (activeProjectId) {
        const upload = await uploadServerProjectFile(activeProjectId, file);
        const run = await createServerImportRun(activeProjectId, upload.fileObject.id);
        setActiveImportRun(run.importRun);
        result = run.importRun.scanResult;
        setProjectState((current) => current ? {
          ...current,
          fileObjects: [...asArray(current.fileObjects), upload.fileObject],
          importRuns: [...asArray(current.importRuns), run.importRun],
        } : current);
      } else {
        result = await scanWorkbookWithBackend(file);
      }
      setBackendScanState({ loading: false, result, error: "", fileName: file.name });
      setBackendBlockReview(createBlockReviewState(result));
      setBackendNormalizeState({ loading: false, result: null, error: "" });
      setBackendMappingState({ loading: false, result: null, error: "" });
      setBackendChartProposalState({ loading: false, result: null, error: "" });
      setBackendChartInterpretState({ loading: false, result: null, error: "" });
      setRelationshipDraft(emptyRelationshipDraft());
      if (scanMode === "refresh") {
        setRefreshDraft((current) => ({ ...current, preview: null, loading: false, error: "" }));
      }
    } catch (err) {
      setBackendScanState({
        loading: false,
        result: null,
        error: err.message || String(err),
        fileName: file.name,
      });
      setBackendBlockReview(createBlockReviewState());
      setBackendNormalizeState({ loading: false, result: null, error: "" });
      setBackendMappingState({ loading: false, result: null, error: "" });
      setBackendChartProposalState({ loading: false, result: null, error: "" });
      setBackendChartInterpretState({ loading: false, result: null, error: "" });
      setRelationshipDraft(emptyRelationshipDraft());
      if (scanMode === "refresh") {
        setRefreshDraft((current) => ({ ...current, preview: null, loading: false, error: refreshErrorMessage(err) }));
      }
    }
  };
  const startRefreshWorkbook = async ({ file, replaceImportId, targetImport }) => {
    const parentCommitId = currentDatasetCommitId();
    const selectedImport = targetImport || asArray(dataset.genericImports).find((item) => item?.importId === replaceImportId) || null;
    if (!file || !selectedImport?.importId || !parentCommitId) {
      setRefreshDraft((current) => ({
        ...current,
        error: "Refresh requires a committed dataset import and replacement workbook.",
      }));
      return;
    }
    setImportReviewMode("refresh");
    setRefreshDraft({
      ...emptyRefreshDraft(),
      open: false,
      replaceImportId: selectedImport.importId,
      expectedParentDatasetCommitId: parentCommitId,
      targetImport: selectedImport,
    });
    setImportReviewOpen(true);
    await runBackendScan(file, { mode: "refresh" });
  };
  const setBackendBlockDecision = (blockId, decision) => {
    setBackendBlockReview((current) => setBlockReviewDecision(current, blockId, decision));
    setBackendNormalizeState({ loading: false, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setRelationshipDraft(emptyRelationshipDraft());
    if (importReviewMode === "refresh") {
      setRefreshDraft((current) => ({ ...current, preview: null, loading: false, error: "" }));
    }
  };
  const previewBackendNormalization = async () => {
    if (!backendScanState.result) return;
    setBackendNormalizeState({ loading: true, result: null, error: "" });
    setBackendMappingState({ loading: false, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setRelationshipDraft(emptyRelationshipDraft());
    if (importReviewMode === "refresh") {
      setRefreshDraft((current) => ({ ...current, preview: null, loading: false, error: "" }));
    }
    try {
      let result;
      let normalizedImportRunId = activeImportRun?.id || "";
      if (activeImportRun?.id) {
        const response = await previewServerImportRunNormalization(activeImportRun.id, {
          approvedBlockIds: backendBlockReview.approvedBlockIds,
          fieldRoleOverrides,
        });
        setActiveImportRun(response.importRun);
        normalizedImportRunId = response.importRun?.id || activeImportRun.id;
        result = response.importRun.normalizePreview;
      } else {
        result = await normalizeScanWithBackend({
          scanResult: backendScanState.result,
          approvedBlockIds: backendBlockReview.approvedBlockIds,
          fieldRoleOverrides,
        });
      }
      setBackendNormalizeState({ loading: false, result, error: "" });
      if (importReviewMode === "refresh") {
        if (!normalizedImportRunId || !refreshDraft.replaceImportId || !refreshDraft.expectedParentDatasetCommitId) {
          setRefreshDraft((current) => ({
            ...current,
            preview: null,
            loading: false,
            error: "Refresh requires a server import run, refresh target, and parent dataset commit.",
          }));
          return;
        }
        setRefreshDraft((current) => ({ ...current, preview: null, loading: true, error: "" }));
        try {
          const refreshPreview = await previewServerImportRefresh(normalizedImportRunId, {
            replaceImportId: refreshDraft.replaceImportId,
            expectedParentDatasetCommitId: refreshDraft.expectedParentDatasetCommitId,
          });
          setRefreshDraft((current) => ({ ...current, preview: refreshPreview, loading: false, error: "" }));
        } catch (refreshErr) {
          setRefreshDraft((current) => ({
            ...current,
            preview: null,
            loading: false,
            error: refreshErrorMessage(refreshErr),
          }));
        }
      }
      if (importReviewMode === "supplement") {
        if (!normalizedImportRunId || !activeProjectId) {
          setRelationshipDraft({
            ...emptyRelationshipDraft(),
            error: "Supplemental import requires a server project import run.",
          });
          return;
        }
        setRelationshipDraft((current) => ({ ...current, preview: null, selectedProposalId: "", loading: true, error: "" }));
        try {
          const relationshipPreview = await previewServerImportRelationship(normalizedImportRunId, {});
          const selected = selectableRelationshipProposals(relationshipPreview)
            .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0] || null;
          setRelationshipDraft({
            preview: relationshipPreview,
            selectedProposalId: selected?.relationshipProposalId || "",
            loading: false,
            error: "",
          });
        } catch (relationshipErr) {
          setRelationshipDraft({
            ...emptyRelationshipDraft(),
            error: relationshipErr.message || String(relationshipErr),
          });
        }
      }
    } catch (err) {
      setBackendNormalizeState({ loading: false, result: null, error: err.message || String(err) });
      if (importReviewMode === "refresh") {
        setRefreshDraft((current) => ({ ...current, preview: null, loading: false, error: refreshErrorMessage(err) }));
      }
      if (importReviewMode === "supplement") {
        setRelationshipDraft({
          ...emptyRelationshipDraft(),
          error: err.message || String(err),
        });
      }
    }
  };
  const applyBackendNormalization = async () => {
    const datasetPatch = backendNormalizeState.result?.datasetPatch;
    if (!datasetPatch?.genericImports?.length) return;
    const isRefreshMode = importReviewMode === "refresh";
    const isSupplementMode = importReviewMode === "supplement";
    if (isRefreshMode) {
      if (!activeImportRun?.id || !activeProjectId) {
        setRefreshDraft((current) => ({ ...current, error: "Refresh apply requires a server project import run." }));
        return;
      }
      if (!refreshDraft.preview) {
        setRefreshDraft((current) => ({ ...current, error: "Review the refresh diff before applying." }));
        return;
      }
      if (!refreshDraft.preview.hasChanges) {
        setRefreshDraft((current) => ({ ...current, error: "No changes detected." }));
        return;
      }
    }
    let selectedRelationship = null;
    if (isSupplementMode) {
      if (!activeImportRun?.id || !activeProjectId) {
        setRelationshipDraft((current) => ({ ...current, error: "Supplemental apply requires a server project import run." }));
        return;
      }
      selectedRelationship = selectableRelationshipProposals(relationshipDraft.preview)
        .find((proposal) => proposal.relationshipProposalId === relationshipDraft.selectedProposalId) || null;
      if (!selectedRelationship) {
        setRelationshipDraft((current) => ({ ...current, error: "Select a supplement relationship before applying." }));
        return;
      }
    }
    const ok = window.confirm(isRefreshMode
      ? `Apply this workbook refresh and replace ${genericImportLabel(refreshDraft.targetImport)}?`
      : isSupplementMode
        ? "Attach this supplemental workbook to the selected experiment data?"
        : "Apply normalized generic import data to this project?");
    if (!ok) return;
    try {
      if (activeImportRun?.id && activeProjectId) {
        await applyServerImportRun(activeImportRun.id, isRefreshMode ? {
          applyMode: "replace_import",
          replaceImportId: refreshDraft.replaceImportId,
          expectedParentDatasetCommitId: refreshDraft.expectedParentDatasetCommitId,
          reviewNote: "Applied workbook refresh.",
        } : isSupplementMode ? {
          applyMode: "supplement_import",
          relationshipDecision: selectedRelationship,
          reviewNote: "Applied supplemental workbook.",
        } : {
          applyMode: "append",
          reviewNote: "Approved normalized master table from Import review.",
        });
        const state = await getServerProjectState(activeProjectId);
        applyProjectWorkspaceRefresh(state);
        if (isRefreshMode || isSupplementMode) {
          resetReviewState();
          setImportReviewOpen(false);
          return;
        }
      } else {
        setDataset((current) => applyGenericImportPatch(current, datasetPatch));
        setDirty(true);
      }
      setBackendNormalizeState((current) => ({ ...current, applied: true }));
    } catch (err) {
      if (isRefreshMode) {
        setRefreshDraft((current) => ({ ...current, error: refreshErrorMessage(err) }));
      } else if (isSupplementMode) {
        setRelationshipDraft((current) => ({ ...current, error: err.message || String(err) }));
      } else {
        setBackendNormalizeState((current) => ({ ...current, error: err.message || String(err) }));
      }
    }
  };
  const currentPhase3GenericImports = () => {
    const previewImports = backendNormalizeState.result?.datasetPatch?.genericImports;
    return previewImports?.length ? previewImports : (dataset.genericImports || []);
  };
  const proposeBackendMappings = async () => {
    const genericImports = currentPhase3GenericImports();
    if (!genericImports.length) return;
    setBackendMappingState({ loading: true, result: null, error: "" });
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    try {
      const result = await proposeSemanticMappingsWithBackend({
        genericImports,
        selectedImportIds: genericImports.map((item) => item.importId).filter(Boolean),
        scanSummary: backendScanState.result?.summary || null,
        priorDecisions: (dataset.genericMappingSets || []).flatMap((set) => set.mappings || []),
      });
      let mappingSet = result.mappingSet;
      if (activeProjectId && currentDatasetCommitId()) {
        const saved = await createServerMappingSet(activeProjectId, {
          importRunId: activeImportRun?.id || null,
          datasetCommitId: currentDatasetCommitId(),
          schemaVersion: result.schemaVersion,
          status: "proposed",
          payload: mappingSet,
          decisionSummary: decisionSummary(mappingSet.mappings),
        });
        mappingSet = payloadWithServerId(saved.mappingSet, "mappingSetId");
        setProjectState((current) => current ? {
          ...current,
          mappingSets: [...asArray(current.mappingSets), saved.mappingSet],
        } : current);
      }
      setBackendMappingState({ loading: false, result: { ...result, mappingSet }, error: "" });
      setDataset((current) => upsertGenericMappingSet(current, mappingSet));
      setDirty(true);
    } catch (err) {
      setBackendMappingState({ loading: false, result: null, error: err.message || String(err) });
    }
  };
  const setBackendMappingDecision = async (mappingId, status) => {
    const mappingSet = backendMappingState.result?.mappingSet;
    if (!mappingSet) return;
    const nextMappingSet = setMappingStatus(mappingSet, mappingId, status);
    setBackendMappingState((current) => current.result ? ({
      ...current,
      result: { ...current.result, mappingSet: nextMappingSet },
    }) : current);
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setDataset((current) => upsertGenericMappingSet(current, nextMappingSet));
    if (nextMappingSet.serverId) {
      try {
        const saved = await patchServerMappingSet(nextMappingSet.serverId, {
          status: "proposed",
          payload: nextMappingSet,
          decisionSummary: decisionSummary(nextMappingSet.mappings),
        });
        setProjectState((current) => current ? {
          ...current,
          mappingSets: asArray(current.mappingSets).map((set) => set.id === saved.mappingSet.id ? saved.mappingSet : set),
        } : current);
      } catch (err) {
        setBackendMappingState((current) => ({ ...current, error: err.message || String(err) }));
      }
    }
    setDirty(true);
  };
  const proposeBackendCharts = async () => {
    const genericImports = currentPhase3GenericImports();
    const mappingSet = backendMappingState.result?.mappingSet;
    if (!genericImports.length) return;
    setBackendChartProposalState({ loading: true, result: null, error: "" });
    try {
      const result = activeProjectId && currentDatasetCommitId()
        ? await proposeServerProjectCharts(activeProjectId, {
          selectedImportIds: genericImports.map((item) => item.importId).filter(Boolean),
          userGoal: projectState?.projectProfile?.researchGoal || "",
        })
        : await proposeChartsWithBackend({
          genericImports,
          selectedImportIds: genericImports.map((item) => item.importId).filter(Boolean),
          mappingSets: mappingSet ? [mappingSet] : [],
          priorDecisions: (dataset.genericChartProposals || []).flatMap((set) => set.proposals || []),
        });
      const proposalSet = result.chartProposalSet
        ? payloadWithServerId(result.chartProposalSet, "proposalSetId")
        : result.proposalSet;
      setBackendChartProposalState({ loading: false, result: { ...result, proposalSet }, error: "" });
      setDataset((current) => upsertGenericChartProposalSet(current, proposalSet));
      if (result.chartProposalSet) {
        setProjectState((current) => current ? {
          ...current,
          chartProposalSets: upsertServerRecordById(current.chartProposalSets, result.chartProposalSet),
        } : current);
      }
      setDirty(true);
    } catch (err) {
      setBackendChartProposalState({ loading: false, result: null, error: err.message || String(err) });
    }
  };
  const interpretBackendChart = async (prompt) => {
    const genericImports = currentPhase3GenericImports();
    if (!genericImports.length) return;
    setBackendChartInterpretState({ loading: true, result: null, error: "" });
    try {
      const result = activeProjectId && currentDatasetCommitId()
        ? await interpretServerProjectChart(activeProjectId, {
          prompt,
          selectedImportIds: genericImports.map((item) => item.importId).filter(Boolean),
          persistAsProposal: true,
        })
        : await interpretChartWithBackend({
          prompt,
          genericImports,
          selectedImportIds: genericImports.map((item) => item.importId).filter(Boolean),
          mappingSets: [
            ...(dataset.genericMappingSets || []),
            ...(backendMappingState.result?.mappingSet ? [backendMappingState.result.mappingSet] : []),
          ],
          priorDecisions: (dataset.genericChartProposals || []).flatMap((set) => set.proposals || []),
        });
      setBackendChartInterpretState({ loading: false, result, error: "" });
      if (result.chartProposalSet) {
        const proposalSet = payloadWithServerId(result.chartProposalSet, "proposalSetId");
        setBackendChartProposalState({
          loading: false,
          result: { ...result, chartProposalSet: result.chartProposalSet, proposalSet },
          error: "",
        });
        setDataset((current) => upsertGenericChartProposalSet(current, proposalSet));
        setProjectState((current) => current ? {
          ...current,
          chartProposalSets: upsertServerRecordById(current.chartProposalSets, result.chartProposalSet),
        } : current);
        setDirty(true);
      }
    } catch (err) {
      setBackendChartInterpretState({ loading: false, result: null, error: err.message || String(err) });
    }
  };
  const setBackendChartProposalDecision = async (proposalId, status) => {
    const proposalSet = backendChartProposalState.result?.proposalSet;
    if (!proposalSet) return;
    const nextProposalSet = setChartProposalStatus(proposalSet, proposalId, status);
    setBackendChartProposalState((current) => current.result ? ({
      ...current,
      result: { ...current.result, proposalSet: nextProposalSet },
    }) : current);
    setDataset((current) => upsertGenericChartProposalSet(current, nextProposalSet));
    if (nextProposalSet.serverId) {
      try {
        const saved = await patchServerChartProposalSet(nextProposalSet.serverId, {
          status: "proposed",
          payload: nextProposalSet,
          decisionSummary: decisionSummary(nextProposalSet.proposals),
        });
        setProjectState((current) => current ? {
          ...current,
          chartProposalSets: asArray(current.chartProposalSets).map((set) => set.id === saved.chartProposalSet.id ? saved.chartProposalSet : set),
        } : current);
      } catch (err) {
        setBackendChartProposalState((current) => ({ ...current, error: err.message || String(err) }));
      }
    }
    setDirty(true);
  };
  const createChartSpecFromProposal = async (chartProposalSetId, proposalId) => {
    if (!activeProjectId || !chartProposalSetId || !proposalId) return;
    setBackendChartProposalState((current) => ({ ...current, error: "" }));
    try {
      await createServerChartSpecFromProposal(activeProjectId, {
        chartProposalSetId,
        proposalId,
        datasetCommitId: currentDatasetCommitId(),
      });
      const state = await getServerProjectState(activeProjectId);
      applyProjectWorkspaceRefresh(state);
    } catch (err) {
      setBackendChartProposalState((current) => ({ ...current, error: err.message || String(err) }));
    }
  };
  const compareSeriesGroups = buildCompareSeriesGroups(projectState);
  const compareSeriesEnabled = compareSeriesGroups.some((group) => group.series.length >= 2);
  const compareSeriesTitle = compareSeriesEnabled
    ? "Create a reviewable cross-experiment compare chart from active supplemental observation series"
    : "Need at least two compatible active supplemental observation series";
  if (authState.checking) {
    return (
      <main className="server-login">
        <section className="server-login-panel">
          <div className="typing">Loading workspace...</div>
        </section>
      </main>
    );
  }
  if (!authState.user) {
    return <ServerLogin loading={authState.loading} error={authState.error} onLogin={login} />;
  }
  if (workspaceMode === "dashboard" || !activeProjectId) {
    return (
      <>
        <Topbar
          tab={tab}
          setTab={setTab}
          workspaceMode="dashboard"
          onOpenDashboard={openProjectDashboard}
          dirty={dirty}
          onSave={save}
          onAgent={() => setAgentOpen(true)}
          dataset={dataset}
          sourceName={sourceError || sourceName}
          sourceError={sourceError}
          loadingSource={loadingSource}
          onOpenImportReview={openAppendImportReview}
          hasImportReview={false}
          blankMode={BLANK_MODE}
          user={authState.user}
          labs={labs}
          activeLabId={activeLabId}
          onLabChange={changeLab}
          projects={projectList}
          activeProjectId={activeProjectId}
          onProjectChange={loadProjectState}
          onCreateProject={openNewProjectModal}
          onOpenProfile={() => setProfileChatOpen(true)}
          onLogout={logout}
        />
        <ProjectDashboard
          user={authState.user}
          labs={labs}
          activeLabId={activeLabId}
          onLabChange={changeLab}
          projects={projectList}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onOpenProject={loadProjectState}
          onCreateProject={openNewProjectModal}
          onRequestDeleteProject={requestDeleteProject}
          activeProjectId={activeProjectId}
          projectState={projectState}
          projectStateLoading={projectStateLoading}
          sourceError={sourceError}
        />
        <NewProjectModal
          open={newProjectOpen}
          loading={newProjectBusy}
          error={newProjectError}
          onCreate={createProject}
          onClose={() => setNewProjectOpen(false)}
        />
        <DeleteProjectModal
          open={!!deleteProjectTarget}
          project={deleteProjectTarget}
          loading={deleteProjectBusy}
          error={deleteProjectError}
          onConfirm={confirmDeleteProject}
          onClose={closeDeleteProjectModal}
        />
      </>
    );
  }
  return (
    <>
      <Topbar tab={tab} setTab={setTab} dirty={dirty} onSave={save} onAgent={() => setAgentOpen(true)}
        workspaceMode={workspaceMode}
        onOpenDashboard={openProjectDashboard}
        dataset={dataset}
        sourceName={sourceName}
        sourceError={sourceError || (projectStateLoading ? "Loading project..." : "")}
        loadingSource={loadingSource}
        onOpenImportReview={openAppendImportReview}
        hasImportReview={!!activeProjectId}
        blankMode={BLANK_MODE}
        user={authState.user}
        labs={labs}
        activeLabId={activeLabId}
        onLabChange={changeLab}
        projects={projectList}
        activeProjectId={activeProjectId}
        onProjectChange={loadProjectState}
        onCreateProject={openNewProjectModal}
        onOpenProfile={() => setProfileChatOpen(true)}
        onLogout={logout}
      />
      {tab === "overview" && <ProjectOverview
        projectState={projectState}
        dataset={dataset}
        onOpenProfile={() => setProfileChatOpen(true)}
        onOpenImportReview={openAppendImportReview}
        onOpenRefreshWorkbook={openRefreshWorkbook}
        onOpenSupplementWorkbook={openSupplementWorkbook}
        onOpenSupplementManager={() => setSupplementManagerOpen(true)}
        onOpenCompareSeries={openCompareSeries}
        onOpenMappingReview={openMappingReview}
        onOpenChartReview={openChartReview}
        onGoManuscript={() => setTab("manuscript")}
      />}
      {tab === "browser" && <Browser
        dataset={dataset}
        sourceName={sourceError || sourceName}
        setSelected={setSelected}
        blankMode={BLANK_MODE}
        onOpenImportReview={openAppendImportReview}
        onOpenMappingReview={openMappingReview}
        onOpenCompareSeries={openCompareSeries}
        compareSeriesEnabled={compareSeriesEnabled}
        compareSeriesTitle={compareSeriesTitle}
        onOpenProfile={() => setProfileChatOpen(true)}
        projectProfile={projectState?.projectProfile}
        templateLinks={blankTemplateLinks()}
        projectId={activeProjectId}
      />}
      {tab === "manuscript" && <ManuscriptCanvas dataset={dataset} blocks={blocks} setBlocks={setBlocks} staged={staged} setStaged={setStaged} references={references} chartTemplates={chartTemplates} setChartTemplates={setChartTemplates} chartSpecs={activeChartSpecsForProject(projectState)} pages={pages} setPages={setPages} canvasHeight={canvasHeight} setCanvasHeight={setCanvasHeight} pageOrientationPreference={pageOrientationPreference} setPageOrientationPreference={setPageOrientationPreference} chartSpecInsertRequest={chartSpecInsertRequest} onChartSpecInsertRequestHandled={clearChartSpecManuscriptInsertRequest} onSelectedChartContextChange={setSelectedChartContext} onRequestChartAnalysis={requestChartAnalysis} onSaveProject={save} />}
      {tab === "reference" && <ReferenceLibrary references={references} setReferences={setReferences} />}
      <DetailModal exp={selected} onClose={() => setSelected(null)} onStage={stage} />
      {importReviewOpen && <ImportReviewModal
        mode={importReviewMode}
        refreshDraft={refreshDraft}
        relationshipDraft={relationshipDraft}
        backendScanState={backendScanState}
        backendBlockReview={backendBlockReview}
        backendNormalizeState={backendNormalizeState}
        backendMappingState={backendMappingState}
        genericImports={dataset.genericImports || []}
        fieldRoleOverrides={fieldRoleOverrides}
        onBackendScanFile={runBackendScan}
        onBlockReviewDecision={setBackendBlockDecision}
        onFieldRoleOverride={setBackendFieldOverride}
        onPreviewNormalize={previewBackendNormalization}
        onApplyNormalize={applyBackendNormalization}
        onRelationshipProposalSelect={(proposalId) => setRelationshipDraft((current) => ({
          ...current,
          selectedProposalId: proposalId,
          error: "",
        }))}
        onProposeMappings={proposeBackendMappings}
        onMappingDecision={setBackendMappingDecision}
        onReloadProjectState={reloadActiveProjectState}
        onClose={() => setImportReviewOpen(false)}
      />}
      <MappingReviewModal
        open={mappingReviewOpen}
        currentDatasetCommitId={currentDatasetCommitId()}
        mappingSetRecord={currentMappingSetRecord()}
        genericImports={dataset.genericImports || []}
        onGenerateMappings={generateMappingReviewMappings}
        onSaveMappings={saveMappingReviewDraft}
        onClose={() => setMappingReviewOpen(false)}
      />
      <ChartReviewModal
        open={chartReviewOpen}
        genericImports={dataset.genericImports || []}
        mappingState={backendMappingState}
        chartProposalState={backendChartProposalState}
        chartInterpretState={backendChartInterpretState}
        chartSpecs={activeChartSpecsForProject(projectState)}
        focusProposalId={focusedChartProposalId}
        statusFilter={chartReviewStatusFilter}
        onProposeCharts={proposeBackendCharts}
        onChartProposalDecision={setBackendChartProposalDecision}
        onInterpretChart={interpretBackendChart}
        onCreateChartSpec={createChartSpecFromProposal}
        onOpenImportReview={openAppendImportReview}
        onClose={closeChartReview}
      />
      <RefreshWorkbookModal
        open={refreshDraft.open}
        imports={dataset.genericImports || []}
        defaultImportId={refreshDraft.replaceImportId}
        loading={backendScanState.loading}
        error={refreshDraft.error}
        onStartRefresh={startRefreshWorkbook}
        onClose={closeRefreshWorkbookModal}
      />
      <SupplementalWorkbooksModal
        open={supplementManagerOpen}
        projectState={projectState}
        dataset={dataset}
        activeBatch={supplementalBatchState.batch}
        batchUploading={supplementalBatchState.uploading}
        batchApplying={supplementalBatchState.applying}
        batchError={supplementalBatchState.error}
        onAddSupplemental={() => {
          openSupplementWorkbook();
        }}
        onCompareSeries={openCompareSeries}
        onContinueReview={openSupplementImportRunReview}
        onRetryBatchItem={retrySupplementalBatchItem}
        onApplyBatchItems={applySelectedSupplementalBatchItems}
        onClose={() => setSupplementManagerOpen(false)}
      />
      <CompareSeriesModal
        open={compareSeriesState.open}
        projectState={projectState}
        loading={compareSeriesState.loading}
        error={compareSeriesState.error}
        clarification={compareSeriesState.clarification}
        onCreateCompare={createCompareSeriesProposal}
        onClose={closeCompareSeries}
      />
      <input
        ref={supplementFileInputRef}
        className="agent-file-input"
        type="file"
        accept=".xlsx,.xls"
        multiple
        onChange={handleSupplementFilesSelected}
      />
      <ProjectProfileChat
        open={profileChatOpen}
        project={projectState?.project}
        projectProfile={projectState?.projectProfile}
        onSaveProfile={saveProjectProfile}
        onClose={() => setProfileChatOpen(false)}
      />
      <NewProjectModal
        open={newProjectOpen}
        loading={newProjectBusy}
        error={newProjectError}
        onCreate={createProject}
        onClose={() => setNewProjectOpen(false)}
      />
      <AgentPanel
        open={agentOpen}
        setOpen={setAgentOpen}
        dataset={dataset}
        blocks={blocks}
        setBlocks={setBlocks}
        references={references}
        selected={selected}
        selectedChartContext={selectedChartContext}
        pendingChartAnalysis={pendingChartAnalysis}
        onChartAnalysisHandled={clearChartAnalysisRequest}
        activeProjectId={activeProjectId}
        projectState={projectState}
        onProjectStateLoaded={applyProjectWorkspaceRefresh}
        onInsertChartSpec={requestChartSpecManuscriptInsert}
      />
    </>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

