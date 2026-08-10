import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useCallback } from "react";
import { DataGrid } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { makePlot } from "./charts/makePlot";
import { ChartReviewPanel } from "./components/BackendScanPanel";
import { ProjectOnboarding } from "./components/ProjectOnboarding.jsx";
import { ProjectProfileChat } from "./components/ProjectProfileChat.jsx";
import { ServerLogin } from "./components/ServerLogin.jsx";
import { ThinkingIndicator } from "./components/ThinkingIndicator.jsx";
import { WorkbookReviewDock } from "./components/WorkbookReviewDock.jsx";
import { ExperimentBrowser } from "./components/ExperimentBrowser.jsx";
import { AnalysisConversationCard } from "./components/AnalysisConversationCard.jsx";
import { AnalysisReviewWorkspace } from "./components/AnalysisReviewWorkspace.jsx";
import {
  getAnalysisThread,
  getProjectAnalysisCapabilities,
  listAnalysisThreads,
  publishAcceptedAnalysisChart,
  publishAcceptedExperimentData,
  retryAnalysisThread,
} from "./data/analysisApi.js";
import { Plot } from "./charts/Plot";
import { ManuscriptCanvas } from "./components/ManuscriptCanvas";
import { BLANK_PROJECT_SOURCE_NAME, blankTemplateLinks, isBlankDataMode } from "./data/appMode.js";
import { emptyDataset } from "./data/loadEmbeddedDataset.js";
import {
  createServerAgentRun,
  createServerManuscript,
  createServerProject,
  createServerWorkbookReviewSession,
  deleteServerWorkbookReviewSession,
  deleteServerProject,
  getServerChartSpec,
  getServerProjectState,
  getServerSession,
  getServerWorkbookReviewSession,
  listServerSourceDocuments,
  listServerLabs,
  listServerProjects,
  loginToServer,
  logoutFromServer,
  patchServerManuscript,
  patchServerProjectProfile,
  reviseServerWorkbookReviewRegion,
  readServerSourceDocumentRange,
  confirmServerWorkbookReviewRegion,
  createServerWorkbookReviewRegion,
  interpretServerWorkbookReviewRegion,
  ignoreServerWorkbookReviewRegion,
  deleteServerWorkbookReviewRegion,
  uploadServerProjectFile,
} from "./data/serverApi.js";
import { ls } from "./storage/localStorage";
import { experimentDateSortValue, formatExperimentDateForDisplay } from "./utils/date.js";
import { fmt, uid } from "./utils/format";
import {
  boundsContainCell,
  getWorkbookTileCacheEntry,
  rememberWorkbookTileCacheEntry,
  WORKBOOK_SCROLL_DEBOUNCE_MS,
  workbookAllTileBounds,
  workbookPrioritizedTileBounds,
  workbookTileCacheKey,
  workbookVisibleTileBounds,
} from "./data/workbookRangeTiles.js";
import { useWorkbookRegionInterpretationQueue } from "./hooks/useWorkbookRegionInterpretationQueue.js";
import { shouldShowProjectOnboarding } from "./data/projectOnboardingState.js";
import "./styles.css";

const BLANK_MODE = isBlankDataMode();
const ONBOARDING_EXPERIMENT_PLAN_REQUEST = "Use the confirmed master table to build reviewed Experiment Browser records.";
const ONBOARDING_PLAN_DRAFT_STALE_MS = 6 * 60_000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function workbookSuggestionRange(region) {
  return region?.range || region?.rangeRef || region?.range_ref || "";
}

function workbookSuggestionSheet(region) {
  return region?.sheetName || region?.sheet_name || region?.sheet || "";
}

function excelColumnLabelToIndex(label) {
  const text = String(label || "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(text)) return null;
  let index = 0;
  for (let i = 0; i < text.length; i += 1) {
    index = index * 26 + (text.charCodeAt(i) - 64);
  }
  return index - 1;
}

function excelIndexToColumnLabel(index) {
  let value = Number(index) + 1;
  if (!Number.isFinite(value) || value <= 0) return "";
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function parseExcelCellAddress(address) {
  const match = String(address || "").trim().match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const col = excelColumnLabelToIndex(match[1]);
  const row = Number(match[2]) - 1;
  if (col == null || !Number.isInteger(row) || row < 0) return null;
  return { row, col };
}

function normalizeExcelBounds(bounds) {
  if (!bounds) return null;
  const startRow = Math.min(bounds.startRow, bounds.endRow);
  const endRow = Math.max(bounds.startRow, bounds.endRow);
  const startCol = Math.min(bounds.startCol, bounds.endCol);
  const endCol = Math.max(bounds.startCol, bounds.endCol);
  if ([startRow, endRow, startCol, endCol].some((value) => !Number.isInteger(value) || value < 0)) return null;
  return { startRow, endRow, startCol, endCol };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseExcelA1Range(range) {
  const text = String(range || "").trim();
  if (!text) return null;
  const plainRange = text.includes("!") ? text.slice(text.lastIndexOf("!") + 1) : text;
  const [startText, endText = startText] = plainRange.split(":").map((part) => part.trim());
  const start = parseExcelCellAddress(startText);
  const end = parseExcelCellAddress(endText);
  if (!start || !end) return null;
  return normalizeExcelBounds({
    startRow: start.row,
    endRow: end.row,
    startCol: start.col,
    endCol: end.col,
  });
}

function formatExcelA1Range(bounds) {
  const normalized = normalizeExcelBounds(bounds);
  if (!normalized) return "";
  const start = `${excelIndexToColumnLabel(normalized.startCol)}${normalized.startRow + 1}`;
  const end = `${excelIndexToColumnLabel(normalized.endCol)}${normalized.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

function excelRangeBoundsFromSheet(sheet) {
  const usedBounds = parseExcelA1Range(sheet?.usedRange);
  if (usedBounds) return usedBounds;
  const rowCount = Number(sheet?.rowCount);
  const columnCount = Number(sheet?.columnCount);
  if (Number.isFinite(rowCount) && rowCount > 0 && Number.isFinite(columnCount) && columnCount > 0) {
    return { startRow: 0, endRow: rowCount - 1, startCol: 0, endCol: columnCount - 1 };
  }
  return { startRow: 0, endRow: 24, startCol: 0, endCol: 7 };
}

function excelCellsFromRangeResult(rangeResult) {
  const cells = [
    ...asArray(rangeResult?.cells),
    ...asArray(rangeResult?.rows).flatMap((row) => asArray(row)),
  ];
  const map = new Map();
  cells.forEach((cell) => {
    if (!Number.isInteger(cell?.row) || !Number.isInteger(cell?.col)) return;
    map.set(`${cell.row}:${cell.col}`, cell);
  });
  return map;
}

function cellInAnyWorkbookRegion(row, col, regions = []) {
  return asArray(regions).some((region) => {
    const bounds = parseExcelA1Range(region.range || region.rangeRef);
    if (!bounds) return false;
    return row >= bounds.startRow && row <= bounds.endRow && col >= bounds.startCol && col <= bounds.endCol;
  });
}

function upsertDraftWorkbookRegion(regions, nextRegion) {
  const values = asArray(regions);
  const nextId = nextRegion.draftRegionId || nextRegion.clientRegionId || "";
  if (nextId) {
    const existingIdIndex = values.findIndex((region) => (
      region.draftRegionId === nextId || region.clientRegionId === nextId
    ));
    if (existingIdIndex >= 0) {
      return values.map((region, index) => (index === existingIdIndex ? { ...region, ...nextRegion } : region));
    }
  }
  const key = `${nextRegion.sourceDocumentId}:${nextRegion.sheetName}:${nextRegion.range}`;
  const existingIndex = values.findIndex((region) => (
    `${region.sourceDocumentId}:${region.sheetName}:${region.range}` === key
  ));
  if (existingIndex >= 0) {
    return values.map((region, index) => (index === existingIndex ? { ...region, ...nextRegion } : region));
  }
  return [...values, nextRegion];
}

function workbookDraftRegionId(sourceDocumentId, sheetName, range) {
  return `draft_${sourceDocumentId}_${sheetName}_${range}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function findWorkbookDraftRegionById(regions, id) {
  const targetId = String(id || "");
  if (!targetId) return null;
  return asArray(regions).find((region) => (
    region.id === targetId || region.draftRegionId === targetId || region.clientRegionId === targetId
  )) || null;
}

const WORKBOOK_EXCEL_CELL_WIDTH = 112;
const WORKBOOK_EXCEL_ROW_HEIGHT = 30;
const WORKBOOK_EXCEL_EDGE_SCROLL_ZONE = 36;
const WORKBOOK_EXCEL_EDGE_SCROLL_INTERVAL_MS = 80;
const WORKBOOK_BACKGROUND_CONCURRENCY = 3;

function workbookSheetCacheKey(sourceDocumentId, sheetName) {
  return `${sourceDocumentId}::${sheetName}`;
}

function getOrCreateWorkbookSheetCache(cache, key) {
  if (!cache.has(key)) {
    cache.set(key, {
      cells: new Map(),
      completed: new Set(),
      failed: new Map(),
    });
  }
  return cache.get(key);
}

function workbookEdgeScrollDirection(clientX, clientY, rect) {
  if (!rect) return { x: 0, y: 0 };
  const x = clientX >= rect.right - WORKBOOK_EXCEL_EDGE_SCROLL_ZONE
    ? 1
    : clientX <= rect.left + WORKBOOK_EXCEL_EDGE_SCROLL_ZONE
      ? -1
      : 0;
  const y = clientY >= rect.bottom - WORKBOOK_EXCEL_EDGE_SCROLL_ZONE
    ? 1
    : clientY <= rect.top + WORKBOOK_EXCEL_EDGE_SCROLL_ZONE
      ? -1
      : 0;
  return { x, y };
}

function datasetFromServerProjectState() {
  return emptyDataset();
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

function isActiveChartSpecForProject(chartSpec) {
  if (!chartSpec) return false;
  if (chartSpec.isStale || chartSpec.status === "stale") return false;
  const spec = chartSpec.spec && typeof chartSpec.spec === "object" ? chartSpec.spec : chartSpec;
  return spec?.origin === "analysis_result";
}

export function activeChartSpecsForProject(projectState) {
  return asArray(projectState?.chartSpecs).filter((chartSpec) => isActiveChartSpecForProject(chartSpec, projectState));
}

function staleChartSpecCountForProject(projectState) {
  return asArray(projectState?.chartSpecs).filter((chartSpec) => chartSpec && !isActiveChartSpecForProject(chartSpec, projectState)).length;
}

function projectWorkflowSummary(project, state = null) {
  const projectProfile = state?.projectProfile || project?.projectProfile || {};
  const serverSummary = project?.workflowSummary || {};
  const profileCount = completedProfileFields(projectProfile);
  const publishedExperimentCount = state
    ? asArray(state.experimentSnapshotHeads).length
    : Number(serverSummary.publishedExperimentCount) || 0;
  const hasPublishedData = publishedExperimentCount > 0;
  const importRuns = asArray(state?.importRuns);
  const latestImportRun = latestItem(importRuns);
  const analysisThreads = asArray(state?.analysisThreads);
  const pendingAnalyses = analysisThreads.filter((thread) => !["completed", "cancelled"].includes(thread?.status)).length;
  const chartSpecs = activeChartSpecsForProject(state);
  const chartSpecCount = state
    ? chartSpecs.length
    : Number(serverSummary.chartSpecCount) || 0;
  const staleChartSpecs = staleChartSpecCountForProject(state);
  const manuscripts = asArray(state?.manuscripts);
  return {
    profileCount,
    profileComplete: profileCount >= 3,
    hasPublishedData,
    publishedExperimentCount,
    importStatus: latestImportRun?.status || (hasPublishedData ? "published" : "not started"),
    analysisCount: analysisThreads.length,
    pendingAnalysisCount: pendingAnalyses,
    chartSpecCount,
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
                <span>{rowSummary.hasPublishedData ? `${rowSummary.publishedExperimentCount} experiments` : "No published data"}</span>
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
              <div><strong>{summary.publishedExperimentCount}</strong><span>Published experiments</span></div>
              <div><strong>{summary.chartSpecCount}</strong><span>Chart specs</span></div>
              <div><strong>{summary.manuscriptCount}</strong><span>Manuscripts</span></div>
            </div>
            <div className="project-flow-stack">
              <ProjectFlowItem done={summary.profileComplete} label="Project background" detail={summary.profileComplete ? "Ready for AI context" : "Needs more context"} />
              <ProjectFlowItem done={summary.hasPublishedData} label="Experiment Browser" detail={summary.hasPublishedData ? `${summary.publishedExperimentCount} accepted experiment records` : "Review and publish workbook experiments"} />
              <ProjectFlowItem done={summary.chartSpecCount > 0} label="Approved charts" detail={summary.chartSpecCount ? `${summary.chartSpecCount} chart specs` : `${summary.pendingAnalysisCount} analyses need review`} />
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

function workbookReviewSessionFileName(session, sourceDocuments = []) {
  const sourceDocument = asArray(sourceDocuments)
    .find((document) => document?.id === session?.sourceDocumentId);
  return session?.workbookSummary?.workbookName
    || sourceDocument?.metadata?.workbookName
    || sourceDocument?.fileName
    || "Workbook";
}

function WorkbookReviewSessionDialog({
  open,
  sessions = [],
  sourceDocuments = [],
  regions = [],
  deletingSessionId = "",
  deleteError = "",
  onOpenSession,
  onDeleteSession,
  onClose,
}) {
  if (!open) return null;
  const activeRegions = asArray(regions).filter((region) => !region?.disposition || region.disposition === "active");
  const orderedSessions = [...asArray(sessions)].sort((left, right) => (
    new Date(right?.updatedAt || right?.createdAt || 0).getTime()
      - new Date(left?.updatedAt || left?.createdAt || 0).getTime()
  ));
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="modal workbook-session-browser-modal" role="dialog" aria-modal="true" aria-label="Uploaded workbooks">
        <div className="modal-head">
          <div>
            <h2>Uploaded workbooks</h2>
            <p>Select a workbook to review its source regions.</p>
          </div>
          <button type="button" aria-label="Close uploaded workbooks" onClick={onClose}>x</button>
        </div>
        {deleteError && <p className="workbook-session-browser-error" role="alert">{deleteError}</p>}
        <div className="workbook-session-browser-list">
          {orderedSessions.map((session) => {
            const sessionRegions = activeRegions.filter((region) => region?.workbookReviewSessionId === session.id);
            const confirmedCount = sessionRegions.filter((region) => region?.reviewStatus === "accepted").length;
            const pendingCount = sessionRegions.length - confirmedCount;
            const fileName = workbookReviewSessionFileName(session, sourceDocuments);
            const deleting = deletingSessionId === session.id;
            return (
              <div
                className="workbook-session-browser-row"
                key={session.id}
              >
                <button
                  type="button"
                  className="workbook-session-browser-main"
                  aria-label={`Open ${fileName}`}
                  disabled={deleting}
                  onClick={() => onOpenSession?.(session)}
                >
                  <span className="workbook-session-browser-file">
                    <strong>{fileName}</strong>
                    <small>
                      {session?.workbookSummary?.sheetCount || 0} sheets
                      {session?.updatedAt || session?.createdAt ? ` - Updated ${formatShortDate(session.updatedAt || session.createdAt)}` : ""}
                    </small>
                  </span>
                  <span className="workbook-session-browser-counts">
                    <span>{confirmedCount} confirmed</span>
                    <span>{pendingCount} need review</span>
                  </span>
                  <span className="workbook-session-browser-open" aria-hidden="true">Open</span>
                </button>
                <button
                  type="button"
                  className="workbook-session-browser-delete"
                  aria-label={`Delete ${fileName}`}
                  disabled={deleting}
                  onClick={() => onDeleteSession?.(session, fileName)}
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            );
          })}
          {!orderedSessions.length && <p className="browser-muted">No uploaded workbooks are available.</p>}
        </div>
      </section>
    </div>
  );
}

export function ProjectOverview({
  projectState,
  onAskLabRat,
  onOpenProfile,
  onUploadWorkbook,
  onDeleteWorkbook,
  onGoBrowser,
  onOpenChartReview,
  onGoManuscript,
}) {
  const [workbookListOpen, setWorkbookListOpen] = useState(false);
  const [deletingWorkbookSessionId, setDeletingWorkbookSessionId] = useState("");
  const [deleteWorkbookError, setDeleteWorkbookError] = useState("");
  const summary = projectWorkflowSummary(projectState?.project, projectState);
  const workbookReviewSessions = asArray(projectState?.workbookReviewSessions)
    .filter((session) => session?.status !== "deleted");
  const activeWorkbookReviewRegions = asArray(projectState?.workbookReviewRegions)
    .filter((region) => !region?.disposition || region.disposition === "active");
  const pendingWorkbookReviewRegions = activeWorkbookReviewRegions
    .filter((region) => region?.reviewStatus !== "accepted");
  const confirmedWorkbookReviewRegions = activeWorkbookReviewRegions
    .filter((region) => region?.reviewStatus === "accepted");
  const openWorkbookList = () => setWorkbookListOpen(true);
  const openWorkbookSession = (session) => {
    setWorkbookListOpen(false);
    onUploadWorkbook?.(session);
  };
  const deleteWorkbookSession = async (session, fileName) => {
    if (!session?.id || typeof onDeleteWorkbook !== "function") return;
    const confirmed = window.confirm(
      `Delete ${fileName} from workbook review? Its source history and existing downstream data or charts will be retained.`,
    );
    if (!confirmed) return;
    setDeletingWorkbookSessionId(session.id);
    setDeleteWorkbookError("");
    try {
      await onDeleteWorkbook(session);
    } catch (error) {
      setDeleteWorkbookError(error?.message || String(error));
    } finally {
      setDeletingWorkbookSessionId("");
    }
  };
  const chartReviewDetail = summary.pendingAnalysisCount
    ? `${summary.pendingAnalysisCount} analysis request${summary.pendingAnalysisCount === 1 ? "" : "s"} still need review`
    : "Describe a chart, review the exact source ranges and processing plan, then run it";
  const manageChartDetail = summary.staleChartSpecCount
    ? `${summary.chartSpecCount} active ChartSpecs. Some older specs are hidden until regenerated.`
    : summary.chartSpecCount
      ? `${summary.chartSpecCount} active ChartSpecs are available for Manuscript insertion`
      : "Accepted analysis results become durable ChartSpecs after review";
  const nextAction = !summary.profileComplete
    ? { label: "Edit profile", action: onOpenProfile }
    : pendingWorkbookReviewRegions.length
      ? { label: "Review workbook regions", action: openWorkbookList }
      : !workbookReviewSessions.length
        ? { label: "Upload workbook", action: onAskLabRat }
        : summary.hasPublishedData
          ? { label: "Open Experiment Browser", action: onGoBrowser }
          : confirmedWorkbookReviewRegions.length
            ? { label: "View confirmed regions", action: openWorkbookList }
            : workbookReviewSessions.length
              ? { label: "Review workbook", action: openWorkbookList }
              : !summary.chartSpecCount
        ? { label: "Create chart", action: onOpenChartReview }
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
        <ProjectOverviewCard
          title="Ask LabRat"
          value="Assistant"
          detail="Conversational help for guided workflows and questions; actions still land in review surfaces"
          action="Open Ask LabRat"
          onClick={onAskLabRat}
        />
        <ProjectOverviewCard title="Project profile" value={`${summary.profileCount}/7`} detail={summary.profileComplete ? "Enough context for chart AI" : "Add research goal, materials, methods, and analysis notes"} action="Edit profile" onClick={onOpenProfile} />
        <ProjectOverviewCard
          title="Workbook review"
          value={`${workbookReviewSessions.length} uploaded workbook${workbookReviewSessions.length === 1 ? "" : "s"}`}
          detail={pendingWorkbookReviewRegions.length
            ? `${pendingWorkbookReviewRegions.length} ${pendingWorkbookReviewRegions.length === 1 ? "region needs" : "regions need"} review. ${confirmedWorkbookReviewRegions.length} confirmed.`
            : confirmedWorkbookReviewRegions.length
              ? `${confirmedWorkbookReviewRegions.length} confirmed region${confirmedWorkbookReviewRegions.length === 1 ? "" : "s"}.${summary.hasPublishedData ? ` ${summary.publishedExperimentCount} experiments are published.` : " Confirmed selections are ready for data planning."}`
              : workbookReviewSessions.length
                ? "No active region has been confirmed. Open the workbook to select or review source regions."
                : "Upload any Excel workbook and review detected source regions before extracting data."}
          action={pendingWorkbookReviewRegions.length
            ? "Review regions"
            : confirmedWorkbookReviewRegions.length
              ? "View confirmed regions"
              : workbookReviewSessions.length
                ? "Review workbook"
                : "Upload workbook"}
          onClick={workbookReviewSessions.length ? openWorkbookList : onAskLabRat}
          actionTitle={workbookReviewSessions.length
            ? "Choose an uploaded workbook and review its regions"
            : "Open Ask LabRat, then use the + button to attach a spreadsheet"}
        />
        <ProjectOverviewCard
          title="Experiment Browser"
          value={`${summary.publishedExperimentCount} published experiments`}
          detail="Browse accepted records, save views, compare scalar values, and inspect full source-backed details."
          action="Open Experiment Browser"
          onClick={onGoBrowser}
          actionDisabled={!summary.hasPublishedData}
          actionTitle={summary.hasPublishedData ? "Open accepted experiment records" : "Publish reviewed workbook experiments first"}
        />
        <ProjectOverviewCard title="Create and review charts" value={`${summary.analysisCount} analyses`} detail={chartReviewDetail} action="Create chart" onClick={onOpenChartReview} />
        <ProjectOverviewCard title="Manage approved charts" value={`${summary.chartSpecCount} specs`} detail={manageChartDetail} action="Manage approved charts" onClick={() => onOpenChartReview?.({ statusFilter: "active" })} />
        <ProjectOverviewCard title="Manuscript" value={summary.manuscriptCount ? "Draft" : "Not started"} detail={summary.manuscriptUpdatedAt ? `Updated ${formatShortDate(summary.manuscriptUpdatedAt)}. Insert approved ChartSpecs only.` : "Insert approved ChartSpecs or future FigurePackages into the canvas"} action="Insert approved charts" onClick={onGoManuscript} />
      </section>
      <WorkbookReviewSessionDialog
        open={workbookListOpen}
        sessions={workbookReviewSessions}
        sourceDocuments={projectState?.sourceDocuments}
        regions={projectState?.workbookReviewRegions}
        deletingSessionId={deletingWorkbookSessionId}
        deleteError={deleteWorkbookError}
        onOpenSession={openWorkbookSession}
        onDeleteSession={deleteWorkbookSession}
        onClose={() => setWorkbookListOpen(false)}
      />
    </main>
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

export function WorkbookReviewWorkspace({
  projectId,
  reviewState,
  draftRegions = [],
  activeDraftRegionId = "",
  onDraftRegionsChange,
  onActiveDraftRegionChange,
  onCreateRegion,
  focusSelection = null,
  reviewDock = null,
}) {
  const session = reviewState?.session || reviewState?.workbookReviewSession || null;
  const initialSourceDocument = reviewState?.sourceDocument || null;
  const [resolvedSourceDocument, setResolvedSourceDocument] = useState(initialSourceDocument);
  const [sourceDocumentError, setSourceDocumentError] = useState("");
  const [activeSheetName, setActiveSheetName] = useState("");
  const [rangeState, setRangeState] = useState({ loading: false, error: "" });
  const [scrollState, setScrollState] = useState({ top: 0, left: 0, width: 1100, height: 600 });
  const [settledScrollState, setSettledScrollState] = useState({ top: 0, left: 0, width: 1100, height: 600 });
  const [sheetCacheRevision, setSheetCacheRevision] = useState(0);
  const [hydrationRetryRevision, setHydrationRetryRevision] = useState(0);
  const [dragSelection, setDragSelection] = useState(null);
  const dragSelectionRef = useRef(null);
  const viewportRef = useRef(null);
  const gridScrollRef = useRef(null);
  const rangeCacheRef = useRef(new Map());
  const sheetCellCacheRef = useRef(new Map());
  const hydrationGenerationRef = useRef(0);
  const pendingScrollStateRef = useRef(scrollState);
  const scrollFrameRef = useRef(null);
  const edgeScrollDirectionRef = useRef({ x: 0, y: 0 });
  const appliedFocusKeyRef = useRef("");
  const appliedActiveRegionKeyRef = useRef("");
  const sessionSourceDocumentId = session?.sourceDocumentId || initialSourceDocument?.id || "";
  const sourceDocument = resolvedSourceDocument?.id === sessionSourceDocumentId
    ? resolvedSourceDocument
    : initialSourceDocument;
  const workbookName = sourceDocument?.metadata?.workbookName
    || session?.workbookSummary?.workbookName
    || "Workbook";
  const sheets = asArray(sourceDocument?.metadata?.sheets);
  const activeSheet = sheets.find((sheet) => sheet.name === activeSheetName) || sheets[0] || null;
  const regionsForSheet = asArray(reviewState?.regions)
    .filter((region) => (region.sourceDocumentId || sourceDocument?.id) === sourceDocument?.id)
    .filter((region) => !activeSheetName || workbookSuggestionSheet(region) === activeSheetName)
    .map((region) => ({
      ...region,
      range: workbookSuggestionRange(region),
      sheetName: workbookSuggestionSheet(region),
    }));
  const draftRegionsForSheet = useMemo(
    () => asArray(draftRegions)
      .filter((region) => region.sourceDocumentId === sourceDocument?.id)
      .filter((region) => region.sheetName === activeSheetName),
    [draftRegions, sourceDocument?.id, activeSheetName],
  );
  const reviewedAnalysisInputs = useMemo(
    () => draftRegionsForSheet.filter((region) => region.status === "reviewed_input"),
    [draftRegionsForSheet],
  );
  const highlightedEditableDrafts = useMemo(
    () => draftRegionsForSheet.filter((region) => (
      region.status !== "reviewed_input"
      && region.disposition !== "ignored"
      && (region.id || region.draftRegionId || region.clientRegionId) === activeDraftRegionId
    )),
    [draftRegionsForSheet, activeDraftRegionId],
  );
  const sheetUsedRange = activeSheet?.usedRange
    || formatExcelA1Range(excelRangeBoundsFromSheet(activeSheet));
  const displayBounds = parseExcelA1Range(sheetUsedRange) || excelRangeBoundsFromSheet(activeSheet);
  const visibleTileBounds = useMemo(() => workbookVisibleTileBounds(displayBounds, settledScrollState, {
    rowHeight: WORKBOOK_EXCEL_ROW_HEIGHT,
    columnWidth: WORKBOOK_EXCEL_CELL_WIDTH,
  }), [
    sheetUsedRange,
    activeSheet?.name,
    settledScrollState.top,
    settledScrollState.left,
    settledScrollState.width,
    settledScrollState.height,
  ]);
  const visibleTileKey = visibleTileBounds.map(formatExcelA1Range).join("|");
  const allTileBounds = useMemo(
    () => workbookAllTileBounds(displayBounds),
    [sheetUsedRange, activeSheet?.name],
  );
  const activeSheetCacheKey = workbookSheetCacheKey(sourceDocument?.id || "", activeSheetName);
  const activeSheetCache = sheetCellCacheRef.current.get(activeSheetCacheKey) || null;
  const activeTileKeys = useMemo(
    () => allTileBounds.map((bounds) => workbookTileCacheKey(sourceDocument?.id, activeSheetName, bounds)),
    [allTileBounds, sourceDocument?.id, activeSheetName],
  );
  const loadedTileBounds = useMemo(
    () => allTileBounds.filter((bounds, index) => activeSheetCache?.completed.has(activeTileKeys[index])),
    [allTileBounds, activeSheetCache, activeTileKeys, sheetCacheRevision],
  );
  const cellsByCoord = useMemo(() => {
    return new Map(activeSheetCache?.cells || []);
  }, [activeSheetCache, activeSheetCacheKey, sheetCacheRevision]);
  const completedTileCount = activeTileKeys.filter((key) => activeSheetCache?.completed.has(key)).length;
  const failedTileCount = activeTileKeys.filter((key) => activeSheetCache?.failed.has(key)).length;
  const pendingTileCount = activeTileKeys.filter((key) => (
    rangeCacheRef.current.get(key)?.status === "pending"
  )).length;
  const totalTileCount = allTileBounds.length;
  const rowIndexes = [];
  const colIndexes = [];
  for (let row = displayBounds.startRow; row <= displayBounds.endRow; row += 1) rowIndexes.push(row);
  for (let col = displayBounds.startCol; col <= displayBounds.endCol; col += 1) colIndexes.push(col);

  useEffect(() => {
    setResolvedSourceDocument(initialSourceDocument);
    setSourceDocumentError("");
  }, [initialSourceDocument?.id, session?.id]);

  useEffect(() => {
    if (!projectId || !sessionSourceDocumentId) return undefined;
    let cancelled = false;
    listServerSourceDocuments(projectId)
      .then((body) => {
        if (cancelled) return;
        const exactDocument = asArray(body?.sourceDocuments)
          .find((document) => document.id === sessionSourceDocumentId);
        if (exactDocument) setResolvedSourceDocument(exactDocument);
      })
      .catch((err) => {
        if (!cancelled) setSourceDocumentError(err.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, sessionSourceDocumentId]);

  useEffect(() => {
    if (!sourceDocument?.id) return;
    const nextSheet = activeSheetName && sheets.some((sheet) => sheet.name === activeSheetName)
      ? activeSheetName
      : sheets[0]?.name || "";
    if (nextSheet && nextSheet !== activeSheetName) setActiveSheetName(nextSheet);
  }, [sourceDocument?.id, sheets, activeSheetName]);

  useEffect(() => {
    const activeRegion = findWorkbookDraftRegionById(draftRegions, activeDraftRegionId);
    if (!activeRegion || activeRegion.disposition === "deleted") return;
    if (activeRegion.sourceDocumentId && activeRegion.sourceDocumentId !== sourceDocument?.id) return;
    const activeRegionKey = `${activeDraftRegionId}:${activeRegion.sourceDocumentId || ""}:${activeRegion.sheetName || ""}`;
    if (appliedActiveRegionKeyRef.current === activeRegionKey) return;
    appliedActiveRegionKeyRef.current = activeRegionKey;
    if (activeRegion.sheetName) setActiveSheetName(activeRegion.sheetName);
  }, [draftRegions, activeDraftRegionId, sourceDocument?.id]);

  useEffect(() => {
    const scrollElement = gridScrollRef.current?.getBoundingClientRect
      ? gridScrollRef.current
      : viewportRef.current?.querySelector?.('[role="grid"]')
        || viewportRef.current?.querySelector?.(".rdg")
        || viewportRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTop = 0;
    scrollElement.scrollLeft = 0;
    const nextScrollState = {
      top: 0,
      left: 0,
      width: scrollElement.clientWidth || 1100,
      height: scrollElement.clientHeight || 600,
    };
    pendingScrollStateRef.current = nextScrollState;
    setScrollState(nextScrollState);
    setSettledScrollState(nextScrollState);
    setRangeState((current) => ({ ...current, error: "" }));
  }, [sourceDocument?.id, activeSheetName, sheetUsedRange]);

  useEffect(() => {
    if (!focusSelection?.sourceDocumentId || !focusSelection?.sheetName || !focusSelection?.range) return;
    if (focusSelection.sourceDocumentId !== sourceDocument?.id) return;
    const focusKey = `${focusSelection.requestId || ""}:${focusSelection.sourceDocumentId}:${focusSelection.sheetName}:${focusSelection.range}`;
    if (appliedFocusKeyRef.current === focusKey) return;
    appliedFocusKeyRef.current = focusKey;
    setActiveSheetName(focusSelection.sheetName);
    if (focusSelection.focusOnly || focusSelection.selectionMethod === "red_box_click") return;
    if (onCreateRegion) {
      onCreateRegion({
        sourceDocumentId: focusSelection.sourceDocumentId,
        sheetName: focusSelection.sheetName,
        range: focusSelection.range,
        selectionMethod: focusSelection.selectionMethod || "suggestion_click",
      });
      return;
    }
    const nextRegionId = focusSelection.clientRegionId || focusSelection.draftRegionId || workbookDraftRegionId(focusSelection.sourceDocumentId, focusSelection.sheetName, focusSelection.range);
    onDraftRegionsChange?.(upsertDraftWorkbookRegion(draftRegions, {
      clientRegionId: nextRegionId,
      draftRegionId: nextRegionId,
      sourceDocumentId: focusSelection.sourceDocumentId,
      sheetName: focusSelection.sheetName,
      range: focusSelection.range,
      selectionMethod: focusSelection.selectionMethod || "suggestion_click",
      description: focusSelection.description || focusSelection.label || "",
      status: "draft",
    }));
    onActiveDraftRegionChange?.(nextRegionId);
  }, [
    focusSelection,
    draftRegions,
    onDraftRegionsChange,
    onActiveDraftRegionChange,
    onCreateRegion,
    sourceDocument?.id,
  ]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setSettledScrollState(scrollState);
    }, WORKBOOK_SCROLL_DEBOUNCE_MS);
    return () => window.clearTimeout(timerId);
  }, [scrollState]);

  const loadWorkbookTile = useCallback((bounds) => {
    if (!sourceDocument?.id || !activeSheetName || !bounds) return Promise.resolve(null);
    const cacheKey = workbookTileCacheKey(sourceDocument.id, activeSheetName, bounds);
    const sheetKey = workbookSheetCacheKey(sourceDocument.id, activeSheetName);
    const sheetCache = getOrCreateWorkbookSheetCache(sheetCellCacheRef.current, sheetKey);
    if (sheetCache.completed.has(cacheKey)) return Promise.resolve(null);

    const cached = getWorkbookTileCacheEntry(rangeCacheRef.current, cacheKey);
    if (cached?.status === "pending") return cached.promise;

    const range = formatExcelA1Range(bounds);
    sheetCache.failed.delete(cacheKey);
    let request;
    request = readServerSourceDocumentRange(sourceDocument.id, { sheetName: activeSheetName, range })
      .then((result) => {
        excelCellsFromRangeResult(result).forEach((cell, key) => {
          sheetCache.cells.set(key, cell);
        });
        sheetCache.completed.add(cacheKey);
        sheetCache.failed.delete(cacheKey);
        rememberWorkbookTileCacheEntry(rangeCacheRef.current, cacheKey, {
          status: "fulfilled",
          sourceDocumentId: sourceDocument.id,
          sheetName: activeSheetName,
          bounds,
          range,
          result,
        });
        setSheetCacheRevision((value) => value + 1);
        return result;
      })
      .catch((err) => {
        if (rangeCacheRef.current.get(cacheKey)?.promise === request) {
          rangeCacheRef.current.delete(cacheKey);
        }
        sheetCache.failed.set(cacheKey, err);
        setSheetCacheRevision((value) => value + 1);
        throw err;
      });
    rememberWorkbookTileCacheEntry(rangeCacheRef.current, cacheKey, {
      status: "pending",
      sourceDocumentId: sourceDocument.id,
      sheetName: activeSheetName,
      bounds,
      range,
      promise: request,
    });
    return request;
  }, [sourceDocument?.id, activeSheetName]);

  useEffect(() => {
    if (!sourceDocument?.id || !activeSheetName || !sheetUsedRange || !visibleTileBounds.length) {
      setRangeState({ loading: false, error: "" });
      return undefined;
    }
    let cancelled = false;
    const sheetCache = getOrCreateWorkbookSheetCache(
      sheetCellCacheRef.current,
      workbookSheetCacheKey(sourceDocument.id, activeSheetName),
    );
    const needsLoad = visibleTileBounds.some((bounds) => {
      const cacheKey = workbookTileCacheKey(sourceDocument.id, activeSheetName, bounds);
      return !sheetCache.completed.has(cacheKey);
    });
    setRangeState({ loading: needsLoad, error: "" });
    Promise.all(visibleTileBounds.map((bounds) => loadWorkbookTile(bounds)))
      .then(() => {
        if (!cancelled) setRangeState({ loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setRangeState({ loading: false, error: err.message || String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [sourceDocument?.id, activeSheetName, sheetUsedRange, visibleTileKey, loadWorkbookTile]);

  useEffect(() => {
    if (!sourceDocument?.id || !activeSheetName || !sheetUsedRange || !allTileBounds.length) {
      return undefined;
    }
    const generation = hydrationGenerationRef.current + 1;
    hydrationGenerationRef.current = generation;
    let cancelled = false;
    let cursor = 0;
    let running = 0;
    const queue = workbookPrioritizedTileBounds(
      displayBounds,
      visibleTileBounds,
    );
    const pump = () => {
      if (cancelled || hydrationGenerationRef.current !== generation) return;
      while (running < WORKBOOK_BACKGROUND_CONCURRENCY && cursor < queue.length) {
        const bounds = queue[cursor];
        cursor += 1;
        const cacheKey = workbookTileCacheKey(sourceDocument.id, activeSheetName, bounds);
        const sheetCache = getOrCreateWorkbookSheetCache(
          sheetCellCacheRef.current,
          workbookSheetCacheKey(sourceDocument.id, activeSheetName),
        );
        if (sheetCache.completed.has(cacheKey)) continue;
        running += 1;
        loadWorkbookTile(bounds)
          .catch(() => null)
          .finally(() => {
            running -= 1;
            pump();
          });
      }
    };
    Promise.all(visibleTileBounds.map((bounds) => loadWorkbookTile(bounds).catch(() => null)))
      .finally(pump);
    return () => {
      cancelled = true;
    };
  }, [
    sourceDocument?.id,
    activeSheetName,
    sheetUsedRange,
    hydrationRetryRevision,
    loadWorkbookTile,
  ]);

  const createCellDraftRegion = (row, col, selectionMethod = "cell_context_menu") => {
    if (!sourceDocument?.id || !activeSheetName) return;
    const range = formatExcelA1Range({ startRow: row, endRow: row, startCol: col, endCol: col });
    if (onCreateRegion) {
      onCreateRegion({
        sourceDocumentId: sourceDocument.id,
        sheetName: activeSheetName,
        range,
        selectionMethod,
      });
      return;
    }
    const activeRegion = findWorkbookDraftRegionById(draftRegions, activeDraftRegionId);
    const nextRegionId = activeRegion?.draftRegionId || activeRegion?.clientRegionId || workbookDraftRegionId(sourceDocument.id, activeSheetName, range);
    onDraftRegionsChange?.(upsertDraftWorkbookRegion(draftRegions, {
      ...activeRegion,
      clientRegionId: nextRegionId,
      draftRegionId: nextRegionId,
      sourceDocumentId: sourceDocument.id,
      sheetName: activeSheetName,
      range,
      selectionMethod,
      description: "",
      status: "draft",
    }));
    onActiveDraftRegionChange?.(nextRegionId);
  };
  const createRangeDraftRegion = (start, end, selectionMethod = "drag_select") => {
    if (!sourceDocument?.id || !activeSheetName || !start || !end) return;
    const bounds = normalizeExcelBounds({
      startRow: start.row,
      endRow: end.row,
      startCol: start.col,
      endCol: end.col,
    });
    const range = formatExcelA1Range(bounds);
    if (onCreateRegion) {
      onCreateRegion({
        sourceDocumentId: sourceDocument.id,
        sheetName: activeSheetName,
        range,
        selectionMethod,
      });
      return;
    }
    const activeRegion = findWorkbookDraftRegionById(draftRegions, activeDraftRegionId);
    const replacedRegion = activeRegion;
    const nextRegionId = replacedRegion?.draftRegionId || replacedRegion?.clientRegionId || workbookDraftRegionId(sourceDocument.id, activeSheetName, range);
    onDraftRegionsChange?.(upsertDraftWorkbookRegion(draftRegions, {
      ...replacedRegion,
      clientRegionId: nextRegionId,
      draftRegionId: nextRegionId,
      sourceDocumentId: sourceDocument.id,
      sheetName: activeSheetName,
      range,
      selectionMethod,
      description: "",
      status: "draft",
    }));
    onActiveDraftRegionChange?.(nextRegionId);
  };
  const beginCellDragSelection = (event, row, col) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const nextSelection = {
      active: true,
      start: { row, col },
      end: { row, col },
      additive: Boolean(event.ctrlKey || event.metaKey),
    };
    dragSelectionRef.current = nextSelection;
    setDragSelection(nextSelection);
  };
  const extendCellDragSelection = (row, col) => {
    const current = dragSelectionRef.current;
    if (!current?.active) return;
    const nextSelection = { ...current, end: { row, col } };
    dragSelectionRef.current = nextSelection;
    setDragSelection(nextSelection);
  };
  const workbookGridScrollElement = () => (
    gridScrollRef.current?.getBoundingClientRect
      ? gridScrollRef.current
      : viewportRef.current?.querySelector?.('[role="grid"]')
        || viewportRef.current?.querySelector?.(".rdg")
        || null
  );
  const syncWorkbookScrollState = (element) => {
    if (!element) return;
    const nextScrollState = {
      top: element.scrollTop || 0,
      left: element.scrollLeft || 0,
      width: element.clientWidth || 1100,
      height: element.clientHeight || 600,
    };
    pendingScrollStateRef.current = nextScrollState;
    if (scrollFrameRef.current != null) return;
    const flushScrollState = () => {
      scrollFrameRef.current = null;
      setScrollState(pendingScrollStateRef.current);
    };
    scrollFrameRef.current = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(flushScrollState)
      : window.setTimeout(flushScrollState, 16);
  };
  useEffect(() => {
    if (!focusSelection?.sourceDocumentId || !focusSelection?.sheetName || !focusSelection?.range) return;
    if (focusSelection.sourceDocumentId !== sourceDocument?.id || focusSelection.sheetName !== activeSheetName) return;
    const focusBounds = parseExcelA1Range(focusSelection.range);
    const element = workbookGridScrollElement();
    if (!focusBounds || !element) return;
    element.scrollTop = Math.max(
      0,
      (focusBounds.startRow - displayBounds.startRow) * WORKBOOK_EXCEL_ROW_HEIGHT,
    );
    element.scrollLeft = Math.max(
      0,
      (focusBounds.startCol - displayBounds.startCol) * WORKBOOK_EXCEL_CELL_WIDTH,
    );
    syncWorkbookScrollState(element);
  }, [
    focusSelection?.requestId,
    focusSelection?.sourceDocumentId,
    focusSelection?.sheetName,
    focusSelection?.range,
    sourceDocument?.id,
    activeSheetName,
    sheetUsedRange,
  ]);
  useEffect(() => () => {
    if (scrollFrameRef.current == null) return;
    if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(scrollFrameRef.current);
    else window.clearTimeout(scrollFrameRef.current);
    scrollFrameRef.current = null;
  }, []);
  const applyWorkbookEdgeScroll = () => {
    const direction = edgeScrollDirectionRef.current || { x: 0, y: 0 };
    if (!direction.x && !direction.y) return;
    const element = workbookGridScrollElement();
    if (!element) return;
    const maxLeft = Math.max(0, (element.scrollWidth || 0) - (element.clientWidth || 0));
    const maxTop = Math.max(0, (element.scrollHeight || 0) - (element.clientHeight || 0));
    element.scrollLeft = clampNumber(
      (element.scrollLeft || 0) + direction.x * WORKBOOK_EXCEL_CELL_WIDTH,
      0,
      maxLeft,
    );
    element.scrollTop = clampNumber(
      (element.scrollTop || 0) + direction.y * WORKBOOK_EXCEL_ROW_HEIGHT,
      0,
      maxTop,
    );
    syncWorkbookScrollState(element);
    setDragSelection((current) => {
      if (!current?.active) return current;
      const nextEnd = {
        row: clampNumber(current.end.row + direction.y, displayBounds.startRow, displayBounds.endRow),
        col: clampNumber(current.end.col + direction.x, displayBounds.startCol, displayBounds.endCol),
      };
      if (nextEnd.row === current.end.row && nextEnd.col === current.end.col) return current;
      const nextSelection = { ...current, end: nextEnd };
      dragSelectionRef.current = nextSelection;
      return nextSelection;
    });
  };
  const finishCellDragSelection = () => {
    edgeScrollDirectionRef.current = { x: 0, y: 0 };
    const current = dragSelectionRef.current;
    dragSelectionRef.current = null;
    setDragSelection(null);
    if (current?.active) {
      createRangeDraftRegion(current.start, current.end, "drag_select");
    }
  };
  useEffect(() => {
    if (!dragSelection?.active) return undefined;
    window.addEventListener("mouseup", finishCellDragSelection);
    return () => window.removeEventListener("mouseup", finishCellDragSelection);
  }, [
    dragSelection?.active,
    draftRegions,
    sourceDocument?.id,
    activeSheetName,
    activeDraftRegionId,
    onDraftRegionsChange,
    onActiveDraftRegionChange,
    onCreateRegion,
  ]);
  useEffect(() => {
    if (!dragSelection?.active) return undefined;
    const updateEdgeScrollDirection = (event) => {
      const element = workbookGridScrollElement();
      const rect = element?.getBoundingClientRect?.();
      edgeScrollDirectionRef.current = workbookEdgeScrollDirection(event.clientX, event.clientY, rect);
    };
    window.addEventListener("mousemove", updateEdgeScrollDirection);
    const intervalId = window.setInterval(applyWorkbookEdgeScroll, WORKBOOK_EXCEL_EDGE_SCROLL_INTERVAL_MS);
    return () => {
      edgeScrollDirectionRef.current = { x: 0, y: 0 };
      window.removeEventListener("mousemove", updateEdgeScrollDirection);
      window.clearInterval(intervalId);
    };
  }, [
    dragSelection?.active,
    displayBounds.startRow,
    displayBounds.endRow,
    displayBounds.startCol,
    displayBounds.endCol,
  ]);
  const workbookCellIsLoading = (row, col) => (
    rangeState.loading
    && visibleTileBounds.some((bounds) => boundsContainCell(bounds, row, col))
    && !loadedTileBounds.some((bounds) => boundsContainCell(bounds, row, col))
  );
  const gridRows = useMemo(() => rowIndexes.map((row) => {
    const item = { __rowIndex: row, __rowNumber: row + 1 };
    colIndexes.forEach((col) => {
      const cell = cellsByCoord.get(`${row}:${col}`) || {};
      item[`col_${col}`] = cell.formattedValue ?? cell.rawValue ?? "";
    });
    return item;
  }), [rowIndexes, colIndexes, cellsByCoord]);
  const gridColumns = useMemo(() => [
    {
      key: "__rowNumber",
      name: "",
      width: 52,
      minWidth: 52,
      frozen: true,
      resizable: false,
      headerCellClass: "workbook-data-grid-corner",
      cellClass: "workbook-data-grid-row-number",
      renderCell: ({ row }) => row.__rowNumber,
    },
    ...colIndexes.map((col) => ({
      key: `col_${col}`,
      name: excelIndexToColumnLabel(col),
      width: WORKBOOK_EXCEL_CELL_WIDTH,
      minWidth: 72,
      resizable: true,
      cellClass: (row) => {
        const classes = [];
        if (cellInAnyWorkbookRegion(row.__rowIndex, col, regionsForSheet)) classes.push("is-detected");
        if (cellInAnyWorkbookRegion(row.__rowIndex, col, reviewedAnalysisInputs)) classes.push("is-analysis-input");
        if (cellInAnyWorkbookRegion(row.__rowIndex, col, highlightedEditableDrafts)) classes.push("is-draft");
        if (dragSelection?.active) {
          const selectionBounds = normalizeExcelBounds({
            startRow: dragSelection.start.row,
            endRow: dragSelection.end.row,
            startCol: dragSelection.start.col,
            endCol: dragSelection.end.col,
          });
          if (row.__rowIndex >= selectionBounds.startRow
            && row.__rowIndex <= selectionBounds.endRow
            && col >= selectionBounds.startCol
            && col <= selectionBounds.endCol) {
            classes.push("is-selecting");
          }
        }
        return classes.join(" ");
      },
      renderCell: ({ row }) => {
        const address = `${excelIndexToColumnLabel(col)}${row.__rowIndex + 1}`;
        const loadingCell = workbookCellIsLoading(row.__rowIndex, col);
        return (
          <div
            className={`workbook-data-grid-cell-value${loadingCell ? " is-loading" : ""}`}
            aria-label={`Cell ${address}`}
            onMouseDown={(event) => beginCellDragSelection(event, row.__rowIndex, col)}
            onMouseEnter={() => extendCellDragSelection(row.__rowIndex, col)}
            onMouseUp={finishCellDragSelection}
          >
            {loadingCell ? <span className="workbook-cell-skeleton" aria-hidden="true" /> : row[`col_${col}`]}
          </div>
        );
      },
    })),
  ], [
    colIndexes,
    dragSelection,
    highlightedEditableDrafts,
    loadedTileBounds,
    rangeState.loading,
    regionsForSheet,
    reviewedAnalysisInputs,
    visibleTileKey,
  ]);
  const retryFailedWorkbookTiles = () => {
    const sheetCache = getOrCreateWorkbookSheetCache(
      sheetCellCacheRef.current,
      activeSheetCacheKey,
    );
    sheetCache.failed.clear();
    setSheetCacheRevision((value) => value + 1);
    setHydrationRetryRevision((value) => value + 1);
  };
  const sheetLoadLabel = failedTileCount > 0
    && completedTileCount + failedTileCount >= totalTileCount
    && pendingTileCount === 0
    ? `Sheet incomplete: ${completedTileCount}/${totalTileCount} ranges`
    : completedTileCount === totalTileCount && totalTileCount > 0
      ? `Sheet loaded: ${completedTileCount}/${totalTileCount} ranges`
      : `Loading sheet: ${completedTileCount}/${totalTileCount} ranges`;

  return (
    <main className="workbook-review-workspace">
      <section className="workbook-excel-toolbar" aria-label="Workbook controls">
        <strong>{workbookName}</strong>
        <div className="workbook-sheet-tabs" aria-label="Workbook sheets">
          {sheets.map((sheet) => (
            <button
              type="button"
              className={sheet.name === activeSheetName ? "active" : ""}
              key={sheet.name}
              onClick={() => setActiveSheetName(sheet.name)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
        <input
          aria-label="Sheet range"
          value={sheetUsedRange}
          readOnly
        />
        {!!sourceDocument && (
          <div className="workbook-sheet-load-status" role="status" aria-live="polite">
            <span>{sheetLoadLabel}</span>
            {!!failedTileCount && (
              <button type="button" onClick={retryFailedWorkbookTiles}>
                Retry failed ranges
              </button>
            )}
          </div>
        )}
      </section>
      <div className={`workbook-review-layout${reviewDock ? " has-review-dock" : ""}`}>
        <section className="workbook-review-main" aria-label="Workbook evidence">
          {reviewState?.error && <p className="import-review-error">{reviewState.error}</p>}
          {sourceDocumentError && <p className="import-review-error">{sourceDocumentError}</p>}
          {rangeState.error && <p className="import-review-error">{rangeState.error}</p>}
          {!sourceDocument && (
            <div className="import-review-empty">Open Ask LabRat and attach a spreadsheet to start workbook review.</div>
          )}
          {sourceDocument && (
            <div
              className="workbook-excel-viewport"
              ref={viewportRef}
            >
              <div className="workbook-data-grid-shell">
                <DataGrid
                  ref={gridScrollRef}
                  aria-label="Workbook sheet preview"
                  className="workbook-data-grid rdg-light"
                  columns={gridColumns}
                  rows={gridRows}
                  rowKeyGetter={(row) => row.__rowIndex}
                  rowHeight={WORKBOOK_EXCEL_ROW_HEIGHT}
                  headerRowHeight={WORKBOOK_EXCEL_ROW_HEIGHT}
                  enableVirtualization={false}
                  defaultColumnOptions={{ resizable: true }}
                  onCellContextMenu={(args, event) => {
                    event.preventDefault();
                    const key = String(args.column.key || "");
                    if (!key.startsWith("col_")) return;
                    const col = Number(key.slice(4));
                    if (!Number.isInteger(col)) return;
                    createCellDraftRegion(args.row.__rowIndex, col);
                  }}
                  onScroll={(event) => {
                    syncWorkbookScrollState(event.currentTarget);
                  }}
                />
              </div>
              {rangeState.loading && (
                <div className="workbook-excel-loading" role="status">
                  Loading visible workbook cells...
                </div>
              )}
            </div>
          )}
        </section>
        {reviewDock}
      </div>
    </main>
  );
}

export function ChartReviewModal({
  open,
  allowAnalysisPrompt = false,
  chartInterpretState,
  chartSpecs,
  statusFilter,
  onInterpretChart,
  onLoadChartSpecDetail,
  onInsertChartSpec,
  onOpenImportReview,
  onClose,
}) {
  const [reviewMode, setReviewMode] = useState(statusFilter === "active" ? "edit" : "review");
  useEffect(() => {
    if (open) setReviewMode(statusFilter === "active" ? "edit" : "review");
  }, [open, statusFilter]);
  if (!open) return null;
  const canReviewCharts = allowAnalysisPrompt;
  const title = statusFilter === "active" ? "Manage approved charts" : "Create and review charts";
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal wide chart-review-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <span>{title}</span>
          <button type="button" aria-label="Close chart review" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <p className="import-review-note">
            Describe a chart, review the exact source ranges and processing plan, then accept the validated result to create a ChartSpec.
          </p>
          <div className="chart-review-mode-tabs" role="tablist" aria-label="Chart review mode">
            <button
              type="button"
              role="tab"
              aria-selected={reviewMode === "review"}
              className={reviewMode === "review" ? "active" : ""}
              onClick={() => setReviewMode("review")}
            >
              Create chart
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reviewMode === "edit"}
              className={reviewMode === "edit" ? "active" : ""}
              onClick={() => setReviewMode("edit")}
            >
              Approved charts
            </button>
          </div>
          {canReviewCharts ? (
            <ChartReviewPanel
              allowAnalysisPrompt={allowAnalysisPrompt}
              chartInterpretState={chartInterpretState}
              chartSpecs={chartSpecs}
              viewMode={reviewMode}
              onInterpretChart={onInterpretChart}
              onLoadChartSpecDetail={onLoadChartSpecDetail}
              onInsertChartSpec={onInsertChartSpec}
            />
          ) : (
            <div className="import-review-empty chart-review-empty">
              <strong>Select a server project first</strong>
              <span>Source-backed chart review requires project-scoped workbook evidence.</span>
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

const AGENT_CHAT_HISTORY_KEY_PREFIX = "labrat_blank_chat_history_v2_project_";
const AGENT_CHAT_HISTORY_LOCAL_KEY = "labrat_blank_chat_history_v2_local";

function agentChatHistoryKey(activeProjectId, projectState) {
  const projectId = String(activeProjectId || projectState?.project?.id || "").trim();
  return projectId
    ? `${AGENT_CHAT_HISTORY_KEY_PREFIX}${encodeURIComponent(projectId)}`
    : AGENT_CHAT_HISTORY_LOCAL_KEY;
}

function sanitizeStoredChatHistory(messages) {
  return asArray(messages).map(({ streaming, streamId, ...message }) => message);
}

function readAgentChatHistory(key) {
  return sanitizeStoredChatHistory(ls.get(key, []));
}

export function AgentPanel({
  open,
  setOpen,
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
  onWorkbookReviewReady,
  onWorkbookReviewLinkOpen,
  onOpenAnalysisReview,
  activeSurface = "project",
  requestedAnalysisOutputTarget = "",
  onRequestedAnalysisTargetHandled,
  requestedDraft = "",
  onRequestedDraftHandled,
}) {
  const chatHistoryKey = useMemo(
    () => agentChatHistoryKey(activeProjectId, projectState),
    [activeProjectId, projectState?.project?.id],
  );
  const [historyState, setHistoryState] = useState(() => ({
    key: chatHistoryKey,
    messages: readAgentChatHistory(chatHistoryKey),
  }));
  const history = historyState.messages;
  const setHistory = (updater) => {
    setHistoryState((current) => ({
      ...current,
      messages: typeof updater === "function" ? updater(current.messages) : updater,
    }));
  };
  const [writingExamples, setWritingExamples] = useState(() => localStorage.getItem("labrat_blank_writing_examples_v1") || "");
  const [projectBackground, setProjectBackground] = useState(() => localStorage.getItem("labrat_blank_project_background_v1") || "");
  const [houseRules, setHouseRules] = useState(() => localStorage.getItem("labrat_blank_house_rules_v1") || "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyOperation, setBusyOperation] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingSpreadsheetFile, setPendingSpreadsheetFile] = useState(null);
  const [analysisCapabilitiesState, setAnalysisCapabilitiesState] = useState({
    loading: false,
    error: "",
    value: null,
  });
  const [retryingAnalysisThreadId, setRetryingAnalysisThreadId] = useState("");
  const [openingWorkbookReviewSessionId, setOpeningWorkbookReviewSessionId] = useState("");
  const acceptedDataStateKey = `${asArray(projectState?.dataSnapshots).length}:${asArray(projectState?.experimentSnapshotHeads).length}:${asArray(projectState?.regionUnderstandings).length}`;
  const messagesRef = useRef(null);
  const activeProjectIdRef = useRef(activeProjectId);
  const chatScrollInitializedRef = useRef(false);
  const lastChatScrollTopRef = useRef(0);
  const fileActionInputRef = useRef(null);
  const agentRequestAbortRef = useRef(null);
  const [settingsDraft, setSettingsDraft] = useState({
    writingExamples,
    projectBackground,
    houseRules,
  });
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);
  useEffect(() => {
    if (!open || !requestedDraft) return;
    setInput(requestedDraft);
    onRequestedDraftHandled?.();
  }, [onRequestedDraftHandled, open, requestedDraft]);
  useEffect(() => {
    if (!busyOperation) return undefined;
    const updateElapsed = () => {
      setBusyOperation((current) => current ? {
        ...current,
        elapsedSeconds: Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000)),
      } : current);
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [busyOperation?.startedAt]);
  useEffect(() => () => agentRequestAbortRef.current?.abort(), []);
  useEffect(() => {
    ["key_v1", "model_v1"].forEach((suffix) => {
      localStorage.removeItem(`labrat_blank_anthropic_${suffix}`);
    });
  }, []);
  useEffect(() => {
    setHistoryState((current) => {
      if (current.key === chatHistoryKey) return current;
      chatScrollInitializedRef.current = false;
      lastChatScrollTopRef.current = 0;
      return {
        key: chatHistoryKey,
        messages: readAgentChatHistory(chatHistoryKey),
      };
    });
  }, [chatHistoryKey]);
  useEffect(() => {
    ls.set(historyState.key, sanitizeStoredChatHistory(historyState.messages));
  }, [historyState]);
  useEffect(() => {
    if (!open || !activeProjectId) {
      setAnalysisCapabilitiesState({ loading: false, error: "", value: null });
      return undefined;
    }
    let cancelled = false;
    setAnalysisCapabilitiesState({ loading: true, error: "", value: null });
    getProjectAnalysisCapabilities(activeProjectId)
      .then((value) => {
        if (!cancelled) setAnalysisCapabilitiesState({ loading: false, error: "", value });
      })
      .catch((error) => {
        if (!cancelled) setAnalysisCapabilitiesState({ loading: false, error: error?.message || String(error), value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [acceptedDataStateKey, activeProjectId, open]);
  useEffect(() => {
    if (!open) return undefined;
    const schedule = typeof window.requestAnimationFrame === "function"
      ? (callback) => window.requestAnimationFrame(callback)
      : (callback) => window.setTimeout(callback, 0);
    const cancel = typeof window.cancelAnimationFrame === "function"
      ? (handle) => window.cancelAnimationFrame(handle)
      : (handle) => window.clearTimeout(handle);
    const handle = schedule(() => {
      const messages = messagesRef.current;
      if (!messages) return;
      const maxScrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
      const nextScrollTop = chatScrollInitializedRef.current
        ? Math.min(lastChatScrollTopRef.current, maxScrollTop)
        : maxScrollTop;
      messages.scrollTop = nextScrollTop;
      lastChatScrollTopRef.current = messages.scrollTop;
      chatScrollInitializedRef.current = true;
    });
    return () => cancel(handle);
  }, [open]);
  const rememberChatScroll = () => {
    if (!messagesRef.current) return;
    lastChatScrollTopRef.current = messagesRef.current.scrollTop;
  };
  const resetChat = () => {
    setHistory([]);
    setPendingSpreadsheetFile(null);
    chatScrollInitializedRef.current = false;
    lastChatScrollTopRef.current = 0;
    if (messagesRef.current) messagesRef.current.scrollTop = 0;
  };
  const openSettings = () => {
    setSettingsDraft({ writingExamples, projectBackground, houseRules });
    setSettingsOpen(true);
  };
  const cancelSettings = () => {
    setSettingsDraft({ writingExamples, projectBackground, houseRules });
    setSettingsOpen(false);
  };
  const saveSettings = () => {
    const next = {
      writingExamples: settingsDraft.writingExamples,
      projectBackground: settingsDraft.projectBackground,
      houseRules: settingsDraft.houseRules,
    };
    setWritingExamples(next.writingExamples);
    setProjectBackground(next.projectBackground);
    setHouseRules(next.houseRules);
    localStorage.setItem("labrat_blank_writing_examples_v1", next.writingExamples);
    localStorage.setItem("labrat_blank_project_background_v1", next.projectBackground);
    localStorage.setItem("labrat_blank_house_rules_v1", next.houseRules);
    setSettingsOpen(false);
  };
  const updateSettingsDraft = (key, value) => setSettingsDraft((draft) => ({ ...draft, [key]: value }));
  const serverAgentEnabled = Boolean(activeProjectId);
  const reloadProjectAfterAgentAction = async () => {
    if (!activeProjectId) return null;
    const state = await getServerProjectState(activeProjectId);
    onProjectStateLoaded?.(state);
    return state;
  };
  const retryAnalysisWithPublishedData = async (thread) => {
    if (!thread?.id || retryingAnalysisThreadId) return;
    if (analysisCapabilitiesState.loading || analysisCapabilitiesState.value?.model?.configured !== true) return;
    const acceptedEvidenceCount = (analysisCapabilitiesState.value?.acceptedData?.activeExperimentHeadCount || 0)
      + (analysisCapabilitiesState.value?.acceptedData?.confirmedRegionCount || 0);
    if (acceptedEvidenceCount < 1) return;
    const requestedProjectId = activeProjectId;
    const requestedHistoryKey = chatHistoryKey;
    setRetryingAnalysisThreadId(thread.id);
    try {
      const response = await retryAnalysisThread(thread.id, {
        idempotencyKey: `retry_analysis_${thread.id}_${uid()}`,
      });
      const analysisThread = response?.analysisThread || thread;
      const currentPlanRevision = response?.currentPlanRevision || response?.analysisPlanRevision || null;
      setHistoryState((current) => current.key !== requestedHistoryKey ? current : ({
        ...current,
        messages: [...current.messages, {
          role: "assistant",
            text: currentPlanRevision?.id
              ? "I drafted a new plan from the current confirmed evidence. Review it before execution."
              : "I retried planning with the current confirmed evidence.",
          analysisThread,
          currentPlanRevision,
          agentRun: response?.agentRun || null,
        }],
      }));
      if (activeProjectIdRef.current === requestedProjectId && analysisThread?.id && currentPlanRevision?.id) {
        onOpenAnalysisReview?.({ thread: analysisThread, revision: currentPlanRevision });
      }
    } catch (error) {
      setHistoryState((current) => current.key !== requestedHistoryKey ? current : ({
        ...current,
        messages: [...current.messages, {
          role: "assistant",
          text: `Analysis retry failed: ${error?.message || String(error)}`,
        }],
      }));
    } finally {
      setRetryingAnalysisThreadId("");
    }
  };
  const createWorkbookReviewSessionFromChatAttachment = async (file) => {
    if (!activeProjectId) throw new Error("Select a server project first.");
    if (!file) throw new Error("Choose a workbook file first.");
    const uploaded = await uploadServerProjectFile(activeProjectId, file);
    const fileObjectId = uploaded.fileObject?.id;
    if (!fileObjectId) throw new Error("The server did not return an uploaded file id.");
    const response = await createServerWorkbookReviewSession(activeProjectId, { fileObjectId });
    const session = response.workbookReviewSession || response.session || null;
    const sourceDocument = response.sourceDocument || null;
    if (!session?.id) throw new Error("The server did not return a workbook review session id.");
    const workbookName = sourceDocument?.metadata?.workbookName
      || session?.workbookSummary?.workbookName
      || file.name
      || "workbook";
    const workbookReviewLink = {
      workbookReviewSessionId: session.id,
      sourceDocumentId: sourceDocument?.id || session.sourceDocumentId || "",
      workbookName,
      regionCount: asArray(response.reviewRegions).length || asArray(response.regions).length,
    };
    onWorkbookReviewReady?.({
      response,
      session,
      sourceDocument,
      regions: asArray(response.regions),
      file,
    });
    await reloadProjectAfterAgentAction();
    return {
      response,
      session,
      sourceDocument,
      workbookReviewLink,
    };
  };
  const openWorkbookReviewLink = async (link) => {
    const sessionId = String(link?.workbookReviewSessionId || "").trim();
    if (!sessionId) {
      setHistory((current) => [...current, {
        role: "assistant",
        text: "This workbook link is missing its review session and cannot be opened.",
      }]);
      return;
    }
    if (!onWorkbookReviewLinkOpen) {
      setHistory((current) => [...current, {
        role: "assistant",
        text: "Workbook review is not available in the current workspace.",
      }]);
      return;
    }
    if (openingWorkbookReviewSessionId) return;
    setOpeningWorkbookReviewSessionId(sessionId);
    try {
      await onWorkbookReviewLinkOpen(link);
    } catch (error) {
      setHistory((current) => [...current, {
        role: "assistant",
        text: `Workbook review could not be opened: ${error?.message || String(error)}`,
      }]);
    } finally {
      setOpeningWorkbookReviewSessionId("");
    }
  };
  const chooseSpreadsheetAttachment = () => {
    fileActionInputRef.current?.click();
  };
  const onAgentFileSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingSpreadsheetFile(file);
  };
  const send = async (prefill, meta = null) => {
    const text = (prefill ?? input).trim();
    if (!text || busy) return;
    const spreadsheetAttachment = pendingSpreadsheetFile;
    setInput("");
    if (spreadsheetAttachment) setPendingSpreadsheetFile(null);
    const next = [...history.map(({ streaming, streamId, ...message }) => message), {
      role: "user",
      text,
      meta,
      attachments: spreadsheetAttachment ? [{ name: spreadsheetAttachment.name, kind: "spreadsheet" }] : [],
    }];
    setHistory(next);
    if (serverAgentEnabled && spreadsheetAttachment && !meta?.source) {
      setBusy(true);
      try {
        const result = await createWorkbookReviewSessionFromChatAttachment(spreadsheetAttachment);
        const workbookReviewLink = result.workbookReviewLink;
        const workbookName = workbookReviewLink.workbookName;
        const regionCount = workbookReviewLink.regionCount;
        setHistory([...next, {
          role: "assistant",
          text: regionCount
            ? `I indexed ${workbookName} and created ${regionCount} potentially useful ${regionCount === 1 ? "region" : "regions"}. AI is understanding them in Workbook Review.`
            : `I indexed ${workbookName}. You can inspect the workbook in the preview; select a range and describe it if you want LabRat to revise its understanding.`,
          workbookReviewLink,
        }]);
      } catch (err) {
        setPendingSpreadsheetFile(spreadsheetAttachment);
        setHistory([...next, { role: "assistant", text: `Workbook upload failed: ${err.message || String(err)}` }]);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (serverAgentEnabled) {
      const requestAbortController = new AbortController();
      agentRequestAbortRef.current = requestAbortController;
      setBusyOperation({
        stage: "Routing request and drafting a reviewable plan",
        startedAt: Date.now(),
        elapsedSeconds: 0,
        cancelling: false,
      });
      setBusy(true);
      try {
        const requestSurface = requestedAnalysisOutputTarget === "experiment_browser"
          ? "experiment_browser"
          : selectedChartContext
            ? "manuscript_chart"
            : activeSurface || "project";
        const response = await createServerAgentRun(activeProjectId, {
          message: text,
          conversation: next.slice(-10).map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            text: message.text,
          })),
          selectedContext: {
            tab: requestSurface,
            activeSurface: requestSurface,
            ...(requestedAnalysisOutputTarget
              ? { analysisOutputTarget: requestedAnalysisOutputTarget }
              : {}),
            selectedExperimentLabel: selected?.label || "",
            selectedChartTitle: selectedChartContext?.title || "",
            selectedChartBlockId: selectedChartContext?.blockId || "",
            selectedChartView: selectedChartContext?.chartView || null,
            assistantProfile: {
              writingExamples,
              projectBackground,
              houseRules,
            },
          },
        }, { signal: requestAbortController.signal });
        onRequestedAnalysisTargetHandled?.();
        const agentRun = response.agentRun || {};
        const warningText = asArray(agentRun.warnings).map((warning) => warning.message || warning.code).filter(Boolean).join(" ");
        const reply = response.reply || warningText || "I need more detail before I can answer or prepare an analysis plan.";
        const analysisThread = response.analysisThread || null;
        const currentPlanRevision = response.currentPlanRevision || null;
        setHistory([...next, {
          role: "assistant",
          text: reply,
          agentRun,
          analysisThread,
          currentPlanRevision,
        }]);
        if (analysisThread?.id && currentPlanRevision?.id) {
          onOpenAnalysisReview?.({
            thread: analysisThread,
            revision: currentPlanRevision,
          });
        }
      } catch (err) {
        if (isAbortError(err)) {
          setHistory([...next, { role: "assistant", text: "Request cancelled." }]);
          return;
        }
        setHistory([...next, {
          role: "assistant",
          text: `LabRat could not create a reviewable plan or action: ${err.message || String(err)} No plan or chart was created.`,
        }]);
      } finally {
        if (agentRequestAbortRef.current === requestAbortController) {
          agentRequestAbortRef.current = null;
        }
        setBusyOperation(null);
        setBusy(false);
      }
      return;
    }
    setHistory([...next, {
      role: "assistant",
      text: "Select a server project before asking LabRat. Model access is configured on the backend.",
    }]);
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
  const cancelBusyOperation = () => {
    if (!agentRequestAbortRef.current) return;
    setBusyOperation((current) => current ? {
      ...current,
      stage: "Cancelling request",
      cancelling: true,
    } : current);
    agentRequestAbortRef.current.abort();
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
        <button type="button" aria-label="Reset chat" title="Reset chat" onClick={resetChat}>&#8635;</button>
        <button type="button" aria-label="Close Lab Rat panel" title="Close" onClick={closeAgent}>&times;</button>
      </div>
    </div>
    <div className="agent-context">Manuscript - {blocks.length} blocks on canvas - focused: {selected?.label || "none"} - {selectedChartContext ? "1 chart selected" : "0 charts selected"}</div>
    {activeProjectId && (
      <div className="analysis-runtime-status" role="status" aria-label="Analysis runtime status">
        {analysisCapabilitiesState.loading && <span>Analysis runtime: checking...</span>}
        {!analysisCapabilitiesState.loading && analysisCapabilitiesState.value && (
          <>
            <span>
              Model: {analysisCapabilitiesState.value.model?.configured
                ? `${analysisCapabilitiesState.value.model?.provider || "configured"} / ${analysisCapabilitiesState.value.model?.model || "default"} ready`
                : "unavailable"}
            </span>
            <span>
              Python: {analysisCapabilitiesState.value.executor?.configured
                ? `${analysisCapabilitiesState.value.executor?.adapter || "configured"} ready`
                : "unavailable"}
            </span>
            <span>
              Evidence: {analysisCapabilitiesState.value.acceptedData?.confirmedRegionCount || 0} confirmed regions, {analysisCapabilitiesState.value.acceptedData?.acceptedSnapshotCount || 0} snapshots, {analysisCapabilitiesState.value.acceptedData?.activeExperimentHeadCount || 0} active heads
            </span>
          </>
        )}
        {!analysisCapabilitiesState.loading && analysisCapabilitiesState.error && <span>Analysis runtime: unavailable</span>}
      </div>
    )}
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
    <div className="messages" ref={messagesRef} onScroll={rememberChatScroll}>
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
          {!!asArray(m.attachments).length && (
            <div className="agent-attachments">
              {asArray(m.attachments).map((attachment, attachmentIndex) => (
                <span className="agent-attachment-chip" key={`${attachment.name || "attachment"}-${attachmentIndex}`}>
                  {attachment.name || "Attached file"}
                </span>
              ))}
            </div>
          )}
          {m.workbookReviewLink && (
            <div className="agent-workbook-link">
              <button
                type="button"
                disabled={openingWorkbookReviewSessionId === m.workbookReviewLink.workbookReviewSessionId}
                onClick={() => openWorkbookReviewLink(m.workbookReviewLink)}
              >
                {m.workbookReviewLink.workbookName || "Open workbook"}
              </button>
            </div>
          )}
          {m.agentRun?.visibleSteps?.length > 0 && (
            <div className="backend-workflow-steps agent-run-steps">
              {m.agentRun.visibleSteps.map((step, stepIndex) => (
                <div className="backend-workflow-step is-done" key={step.stepId || `${step.label}-${stepIndex}`}>
                  <span>{step.label}</span>
                  {step.details && Object.keys(step.details).length > 0 && (
                    <small>{Object.entries(step.details).slice(0, 3).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value ?? "")}`).join(" | ")}</small>
                  )}
                </div>
              ))}
            </div>
          )}
          {m.analysisThread?.id && (
            <AnalysisConversationCard
              thread={m.analysisThread}
              revision={m.currentPlanRevision}
              run={m.analysisRun}
              result={m.analysisResult}
              evidenceBlocked={asArray(m.agentRun?.warnings).some((warning) => warning?.code === "analysis_evidence_required")}
              modelAvailable={!analysisCapabilitiesState.loading && analysisCapabilitiesState.value?.model?.configured === true}
              acceptedDataAvailable={!analysisCapabilitiesState.loading && (
                (analysisCapabilitiesState.value?.acceptedData?.activeExperimentHeadCount || 0)
                + (analysisCapabilitiesState.value?.acceptedData?.confirmedRegionCount || 0)
              ) > 0}
              retrying={retryingAnalysisThreadId === m.analysisThread.id}
              onRetry={retryAnalysisWithPublishedData}
              onOpen={onOpenAnalysisReview}
            />
          )}
          {m.role === "assistant" && m.meta?.source === "chart" && m.text && !m.streaming && !m.text.startsWith("Request failed:") && <button className="insert-chat-text" onClick={() => insertAssistantText(m)}>Insert as text box</button>}
        </div>
      </div>)}
      {busy && !history.some((m) => m.role === "assistant" && m.streaming && m.text) && (
        busyOperation ? (
          <div className="agent-busy-operation" role="status" aria-label="LabRat request status">
            <div>
              <strong>{busyOperation.stage}</strong>
              <span>{busyOperation.elapsedSeconds}s elapsed</span>
            </div>
            <button type="button" onClick={cancelBusyOperation} disabled={busyOperation.cancelling}>
              {busyOperation.cancelling ? "Cancelling" : "Cancel"}
            </button>
          </div>
        ) : <div className="typing">Working...</div>
      )}
    </div>
    <div className="agent-foot">
      {pendingSpreadsheetFile && (
        <div className="agent-pending-attachment">
          <span>{pendingSpreadsheetFile.name}</span>
          <button type="button" aria-label="Remove attached spreadsheet" onClick={() => setPendingSpreadsheetFile(null)}>
            x
          </button>
        </div>
      )}
      <button type="button" className="agent-tool" aria-label="Attach spreadsheet" title="Attach spreadsheet" onClick={chooseSpreadsheetAttachment}>+</button>
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
  const [requestedAnalysisOutputTarget, setRequestedAnalysisOutputTarget] = useState("");
  const [requestedAgentDraft, setRequestedAgentDraft] = useState("");
  const [onboardingRenderVersion, setOnboardingRenderVersion] = useState(0);
  const [analysisReviewState, setAnalysisReviewState] = useState(null);
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
  const [profileChatOpen, setProfileChatOpen] = useState(false);
  const [chartReviewOpen, setChartReviewOpen] = useState(false);
  const [chartReviewStatusFilter, setChartReviewStatusFilter] = useState("");
  const [workbookReviewState, setWorkbookReviewState] = useState({ loading: false, error: "", revisionLoading: false, confirmLoading: false, revisionError: "", clarification: null, session: null, sourceDocument: null, regions: [] });
  const [workbookReviewDraftRegions, setWorkbookReviewDraftRegions] = useState([]);
  const [activeWorkbookReviewDraftRegionId, setActiveWorkbookReviewDraftRegionId] = useState("");
  const [workbookReviewFocusSelection, setWorkbookReviewFocusSelection] = useState(null);
  const [browserSelectedExperimentIds, setBrowserSelectedExperimentIds] = useState([]);
  const [browserInitialViewId, setBrowserInitialViewId] = useState("");
  const [backendChartInterpretState, setBackendChartInterpretState] = useState({ loading: false, result: null, error: "" });
  const resetReviewState = () => {
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setChartReviewStatusFilter("");
    setWorkbookReviewState({ loading: false, error: "", revisionLoading: false, confirmLoading: false, revisionError: "", clarification: null, session: null, sourceDocument: null, regions: [] });
    setWorkbookReviewDraftRegions([]);
    setActiveWorkbookReviewDraftRegionId("");
    setWorkbookReviewFocusSelection(null);
    setBrowserSelectedExperimentIds([]);
    setBrowserInitialViewId("");
    setRequestedAnalysisOutputTarget("");
    setAnalysisReviewState(null);
  };

  const applyProjectShellState = (state) => {
    setSourceName(state?.project?.name || BLANK_PROJECT_SOURCE_NAME);
    setProjectLoaded(true);
  };

  const applyDatasetState = (state) => {
    const nextDataset = datasetFromServerProjectState(state);
    setDataset(nextDataset);
  };

  const applyReviewState = () => {
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
    setProjectList((current) => current.map((project) => project.id === state?.project?.id ? {
      ...project,
      workflowSummary: {
        publishedExperimentCount: asArray(state?.experimentSnapshotHeads).length,
        chartSpecCount: activeChartSpecsForProject(state).length,
      },
    } : project));
  };

  const applyProjectWorkspaceRefresh = (state) => {
    setProjectState((current) => mergeProjectStateForWorkspaceRefresh(current, state, { preserveManuscripts: true }));
    applyProjectShellState(state);
    applyDatasetState(state);
    applyReviewState(state);
    setProjectList((current) => current.map((project) => project.id === state?.project?.id ? {
      ...project,
      workflowSummary: {
        publishedExperimentCount: asArray(state?.experimentSnapshotHeads).length,
        chartSpecCount: activeChartSpecsForProject(state).length,
      },
    } : project));
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
      applyProjectState(state);
    } catch (err) {
      setSourceError(err.message || String(err));
    } finally {
      setProjectStateLoading(false);
    }
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
      setProfileChatOpen(false);
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
    setChartReviewOpen(false);
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
  const stage = (label) => setStaged((s) => s.includes(label) ? s.filter((x) => x !== label) : [...s, label]);
  const openChartReview = (options = "") => {
    const isOptionsObject = options && typeof options === "object" && !("currentTarget" in options);
    setChartReviewStatusFilter(isOptionsObject && options.statusFilter === "active" ? "active" : "");
    setChartReviewOpen(true);
  };
  const closeChartReview = () => {
    setChartReviewOpen(false);
    setChartReviewStatusFilter("");
  };
  const openWorkbookUpload = () => {
    if (!activeProjectId) {
      setSourceError("Select or create a server project before uploading a workbook.");
      return;
    }
    setAgentOpen(true);
  };
  const uploadOnboardingWorkbook = async (file) => {
    if (!activeProjectId) throw new Error("Select or create a server project before uploading a workbook.");
    const uploaded = await uploadServerProjectFile(activeProjectId, file);
    const fileObjectId = uploaded.fileObject?.id;
    if (!fileObjectId) throw new Error("The server did not return an uploaded file id.");
    const response = await createServerWorkbookReviewSession(activeProjectId, { fileObjectId });
    const state = await getServerProjectState(activeProjectId);
    applyProjectWorkspaceRefresh(state);
    handleWorkbookReviewReadyFromAgent({ response, navigate: false });
    return {
      ...response,
      session: response.workbookReviewSession || response.session || null,
    };
  };
  const openExperimentBrowserDataRequest = () => {
    if (!activeProjectId) {
      setSourceError("Select or create a server project before preparing experiment data.");
      return;
    }
    setRequestedAnalysisOutputTarget("experiment_browser");
    setAgentOpen(true);
  };
  const createOnboardingExperimentPlan = async (options = {}) => {
    if (!activeProjectId) throw new Error("Select a project before preparing experiment data.");
    return createServerAgentRun(activeProjectId, {
      message: ONBOARDING_EXPERIMENT_PLAN_REQUEST,
      conversation: [],
      selectedContext: {
        tab: "experiment_browser",
        activeSurface: "experiment_browser",
        analysisOutputTarget: "experiment_browser",
      },
    }, { signal: options.signal });
  };
  const recoverOnboardingExperimentPlan = async () => {
    if (!activeProjectId) return null;
    const response = await listAnalysisThreads(activeProjectId, { limit: 100 });
    const candidate = asArray(response?.analysisThreads)
      .filter((thread) => (
        thread?.outputTarget === "experiment_browser"
        && thread?.originalRequest === ONBOARDING_EXPERIMENT_PLAN_REQUEST
        && !["completed", "cancelled"].includes(thread?.status)
        && !(
          ["planning", "retry_drafting", "plan_drafting"].includes(thread?.status)
          && Number.isFinite(Date.parse(thread?.updatedAt || ""))
          && Date.now() - Date.parse(thread.updatedAt) > ONBOARDING_PLAN_DRAFT_STALE_MS
        )
      ))
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0];
    if (!candidate?.id) return null;
    const threadResponse = await getAnalysisThread(candidate.id);
    const currentPlanRevision = asArray(threadResponse?.planRevisions)
      .findLast((revision) => ["awaiting_review", "accepted"].includes(revision?.status))
      || null;
    if (!threadResponse?.analysisThread?.id) return null;
    return {
      ...threadResponse,
      currentPlanRevision,
    };
  };
  const openAppendImportReview = () => {
    openWorkbookUpload();
  };
  const openRefreshWorkbook = () => {
    openWorkbookUpload();
  };
  const openSupplementWorkbook = () => {
    openWorkbookUpload();
  };
  const handleWorkbookReviewReadyFromAgent = ({ response, session, sourceDocument, regions = [], navigate = true } = {}) => {
    const nextSession = session || response?.workbookReviewSession || response?.session || null;
    const nextSourceDocument = sourceDocument || response?.sourceDocument || null;
    const nextReviewRegions = asArray(response?.reviewRegions);
    const nextActiveRegion = nextReviewRegions.find((region) => region.disposition === "active") || nextReviewRegions[0];
    const nextActiveRegionId = nextActiveRegion?.id || "";
    setWorkbookReviewDraftRegions(nextReviewRegions);
    setActiveWorkbookReviewDraftRegionId(nextActiveRegionId);
    setWorkbookReviewFocusSelection(null);
    setWorkbookReviewState({
      loading: false,
      error: "",
      revisionLoading: false,
      confirmLoading: false,
      revisionError: "",
      clarification: null,
      session: nextSession,
      sourceDocument: nextSourceDocument,
      regions: asArray(regions.length ? regions : response?.regions),
      reviewRegions: nextReviewRegions,
    });
    if (navigate) {
      setTab("workbook_review");
      setAgentOpen(false);
    }
  };
  const continueWorkbookReview = async (requestedSession = null) => {
    const session = requestedSession?.id
      ? requestedSession
      : latestItem(projectState?.workbookReviewSessions);
    if (!session?.id) {
      openWorkbookUpload();
      return;
    }
    setWorkbookReviewState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await getServerWorkbookReviewSession(session.id);
      handleWorkbookReviewReadyFromAgent({ response });
    } catch (error) {
      setWorkbookReviewState((current) => ({
        ...current,
        loading: false,
        error: error?.message || String(error),
      }));
    }
  };
  const hydrateOnboardingWorkbookReview = async (requestedSession) => {
    if (!requestedSession?.id) return null;
    const response = await getServerWorkbookReviewSession(requestedSession.id);
    handleWorkbookReviewReadyFromAgent({ response, navigate: false });
    return response;
  };
  const deleteWorkbookReviewSessionFromProject = async (session) => {
    if (!session?.id) throw new Error("Select a workbook before deleting it.");
    await deleteServerWorkbookReviewSession(session.id, {
      expectedVersion: session.version,
      reason: "Deleted from Uploaded workbooks.",
    });
    await refreshProjectWorkspace();
  };
  const handleWorkbookReviewLinkOpen = async (link) => {
    const sessionId = String(link?.workbookReviewSessionId || "").trim();
    if (!sessionId) throw new Error("Workbook review session is missing.");
    setWorkbookReviewState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await getServerWorkbookReviewSession(sessionId);
      handleWorkbookReviewReadyFromAgent({ response });
    } catch (error) {
      setWorkbookReviewState((current) => ({
        ...current,
        loading: false,
        error: error?.message || String(error),
      }));
      throw error;
    }
  };
  const handleWorkbookReviewRegionActivate = (regionId) => {
    setActiveWorkbookReviewDraftRegionId(regionId);
    const region = findWorkbookDraftRegionById(workbookReviewDraftRegions, regionId);
    if (!region) return;
    setWorkbookReviewFocusSelection({
      ...region,
      range: region.range || region.rangeRef,
      requestId: uid(),
      selectionMethod: "red_box_click",
    });
  };
  const applyWorkbookReviewRegionResponse = (response, { activate = true } = {}) => {
    const nextRegion = response?.region || null;
    if (!nextRegion?.id) return response;
    setProjectState((current) => {
      if (!current) return current;
      const nextRegions = (
        asArray(current.workbookReviewRegions).some((region) => region.id === nextRegion.id)
          ? asArray(current.workbookReviewRegions).map((region) => region.id === nextRegion.id ? nextRegion : region)
          : [...asArray(current.workbookReviewRegions), nextRegion]
      ).filter((region) => region.disposition !== "deleted");
      return { ...current, workbookReviewRegions: nextRegions };
    });
    setWorkbookReviewDraftRegions((currentRegions) => {
      const existingRegions = asArray(currentRegions);
      const nextRegions = (
        existingRegions.some((region) => region.id === nextRegion.id)
          ? existingRegions.map((region) => region.id === nextRegion.id ? nextRegion : region)
          : [...existingRegions, nextRegion]
      ).filter((region) => region.disposition !== "deleted");
      setWorkbookReviewState((current) => ({
        ...current,
        reviewRegions: nextRegions,
        revisionError: "",
        clarification: null,
      }));
      return nextRegions;
    });
    if (nextRegion.disposition === "active" && activate) {
      setActiveWorkbookReviewDraftRegionId(nextRegion.id);
      setWorkbookReviewFocusSelection({
        sourceDocumentId: nextRegion.sourceDocumentId,
        sheetName: nextRegion.sheetName,
        range: nextRegion.rangeRef,
        requestId: uid(),
        selectionMethod: "red_box_click",
      });
    } else if (nextRegion.disposition !== "active") {
      setActiveWorkbookReviewDraftRegionId((currentId) => (currentId === nextRegion.id ? "" : currentId));
    }
    return response;
  };
  const markWorkbookReviewRegionInterpretationFailed = (region, error, context = {}) => {
    const reconcileFromServer = [
      "stale_workbook_review_region",
      "workbook_review_region_not_pending",
    ].includes(error?.code);
    if (reconcileFromServer && context.sessionId) {
      getServerWorkbookReviewSession(context.sessionId)
        .then((response) => {
          const currentSessionId = workbookReviewState.session?.id
            || workbookReviewState.workbookReviewSession?.id
            || "";
          if (currentSessionId !== context.sessionId) return;
          const latestRegion = asArray(response?.reviewRegions)
            .find((candidate) => candidate.id === region?.id);
          if (latestRegion) applyWorkbookReviewRegionResponse({ region: latestRegion }, { activate: false });
        })
        .catch(() => {
          // A later explicit reopen will reload the authoritative region state.
        });
      return;
    }
    const superseded = [
      "workbook_review_region_inactive",
      "workbook_review_region_not_found",
      "workbook_review_session_not_found",
    ].includes(error?.code);
    if (superseded || !region?.id) return;
    const warning = {
      code: error?.code || "region_interpretation_request_failed",
      message: error?.message || String(error),
    };
    setWorkbookReviewDraftRegions((currentRegions) => {
      const nextRegions = asArray(currentRegions).map((candidate) => (
        candidate.id === region.id
          && candidate.disposition === "active"
          && candidate.reviewStatus === "interpreting"
          ? { ...candidate, reviewStatus: "interpretation_failed", warnings: [warning] }
          : candidate
      ));
      setWorkbookReviewState((current) => ({
        ...current,
        reviewRegions: nextRegions,
        revisionError: "",
      }));
      return nextRegions;
    });
  };
  const workbookReviewSessionId = workbookReviewState.session?.id
    || workbookReviewState.workbookReviewSession?.id
    || "";
  const { retryRegion: queueWorkbookReviewRegionRetry } = useWorkbookRegionInterpretationQueue({
    sessionId: workbookReviewSessionId,
    regions: workbookReviewDraftRegions,
    activeRegionId: activeWorkbookReviewDraftRegionId,
    interpretRegion: ({ sessionId, region, signal }) => interpretServerWorkbookReviewRegion(
      sessionId,
      region.id,
      {
        expectedRegionVersion: region.version,
        idempotencyKey: `interpret_region_${uid()}`,
      },
      { signal },
    ),
    onRegionResult: (response) => applyWorkbookReviewRegionResponse(response, { activate: false }),
    onRegionError: markWorkbookReviewRegionInterpretationFailed,
  });
  const retryWorkbookReviewRegion = (regionId) => {
    const started = queueWorkbookReviewRegionRetry(regionId);
    if (!started) return false;
    setWorkbookReviewDraftRegions((currentRegions) => {
      const nextRegions = asArray(currentRegions).map((region) => (
        region.id === regionId && region.disposition === "active"
          ? { ...region, reviewStatus: "interpreting", warnings: [] }
          : region
      ));
      setWorkbookReviewState((current) => ({
        ...current,
        reviewRegions: nextRegions,
        revisionError: "",
      }));
      return nextRegions;
    });
    return true;
  };
  const createWorkbookReviewRegion = async (input = {}) => {
    const session = workbookReviewState.session || workbookReviewState.workbookReviewSession || null;
    if (!session?.id) throw new Error("Start a workbook review session before selecting a region.");
    try {
      const createdResponse = await createServerWorkbookReviewRegion(session.id, {
        ...input,
        deferInterpretation: true,
        idempotencyKey: `create_region_${uid()}`,
      });
      return applyWorkbookReviewRegionResponse(createdResponse);
    } catch (err) {
      setWorkbookReviewState((current) => ({ ...current, revisionError: err.message || String(err) }));
      throw err;
    }
  };
  const reviseWorkbookReviewRegion = async (regionId, request) => {
    const session = workbookReviewState.session || workbookReviewState.workbookReviewSession || null;
    if (!session?.id) throw new Error("Start a workbook review session before submitting feedback.");
    const response = await reviseServerWorkbookReviewRegion(session.id, regionId, {
      ...request,
      idempotencyKey: `revise_region_${uid()}`,
    });
    return applyWorkbookReviewRegionResponse(response);
  };
  const confirmWorkbookReviewRegion = async (regionId, request) => {
    const session = workbookReviewState.session || workbookReviewState.workbookReviewSession || null;
    if (!session?.id) throw new Error("Start a workbook review session before confirming a region.");
    const response = await confirmServerWorkbookReviewRegion(session.id, regionId, {
      ...request,
      idempotencyKey: `confirm_region_${uid()}`,
    });
    return applyWorkbookReviewRegionResponse(response);
  };
  const ignoreWorkbookReviewRegion = async (regionId, request) => {
    const session = workbookReviewState.session || workbookReviewState.workbookReviewSession || null;
    if (!session?.id) throw new Error("Start a workbook review session before ignoring a region.");
    const response = await ignoreServerWorkbookReviewRegion(session.id, regionId, request);
    return applyWorkbookReviewRegionResponse(response, { activate: false });
  };
  const deleteWorkbookReviewRegion = async (regionId, request) => {
    const session = workbookReviewState.session || workbookReviewState.workbookReviewSession || null;
    if (!session?.id) throw new Error("Start a workbook review session before deleting a region.");
    const response = await deleteServerWorkbookReviewRegion(session.id, regionId, request);
    return applyWorkbookReviewRegionResponse(response, { activate: false });
  };
  const focusExperimentBrowserSource = async (source) => {
    if (!source?.sourceDocumentId || !(source.sheet || source.sheetName) || !(source.range || source.cell)) return;
    const focusSelection = {
      sourceDocumentId: source.sourceDocumentId,
      sheetName: source.sheet || source.sheetName,
      range: source.range || source.cell,
      requestId: uid(),
      selectionMethod: "experiment_browser_source_link",
      focusOnly: true,
    };
    const session = latestItem(projectState?.workbookReviewSessions);
    if (!session?.id) {
      setWorkbookReviewFocusSelection(focusSelection);
      setTab("workbook_review");
      return;
    }
    setWorkbookReviewState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await getServerWorkbookReviewSession(session.id);
      handleWorkbookReviewReadyFromAgent({ response });
      setWorkbookReviewFocusSelection(focusSelection);
    } catch (error) {
      setWorkbookReviewState((current) => ({
        ...current,
        loading: false,
        error: error?.message || String(error),
      }));
      setWorkbookReviewFocusSelection(focusSelection);
      setTab("workbook_review");
    }
  };
  const requestChartAnalysis = (blockId) => {
    setAgentOpen(true);
    setPendingChartAnalysis({ blockId, nonce: Date.now() });
  };
  const clearChartAnalysisRequest = (nonce) => {
    setPendingChartAnalysis((request) => request?.nonce === nonce ? null : request);
  };
  const interpretBackendChart = async (prompt) => {
    if (!activeProjectId) return;
    setBackendChartInterpretState({ loading: true, result: null, error: "" });
    try {
      const response = await createServerAgentRun(activeProjectId, {
        message: prompt,
        conversation: [],
        selectedContext: {
          tab: "chart_review",
          requestedWorkflow: "reviewed_analysis_chart",
        },
      });
      const analysisThread = response.analysisThread || null;
      const currentPlanRevision = response.currentPlanRevision || null;
      if (analysisThread?.id && currentPlanRevision?.id) {
        setBackendChartInterpretState({ loading: false, result: null, error: "" });
        openAnalysisReview({ thread: analysisThread, revision: currentPlanRevision });
        return;
      }
      const warningText = asArray(response.agentRun?.warnings)
        .map((warning) => warning.message || warning.code)
        .filter(Boolean)
        .join(" ");
      throw new Error([
        response.reply || "The backend did not create a reviewable analysis plan.",
        warningText,
      ].filter(Boolean).join(" "));
    } catch (err) {
      setBackendChartInterpretState({ loading: false, result: null, error: err.message || String(err) });
    }
  };
  const save = async () => {
    if (!activeProjectId) return;
    const manuscript = asArray(projectState?.manuscripts)[0] || null;
    const request = {
      title: manuscript?.title || `${projectState?.project?.name || "Untitled"} manuscript`,
      blocks,
      pages: Array.isArray(pages) ? pages : [],
      canvasState: { canvasHeight, pageOrientationPreference },
      references,
    };
    try {
      const response = manuscript?.id
        ? await patchServerManuscript(manuscript.id, request)
        : await createServerManuscript(activeProjectId, request);
      const savedManuscript = response.manuscript;
      if (savedManuscript?.id) {
        setProjectState((current) => current ? {
          ...current,
          manuscripts: upsertServerRecordById(current.manuscripts, savedManuscript),
        } : current);
      }
      setDirty(false);
    } catch (err) {
      setSourceError(err.message || String(err));
    }
  };
  const openAnalysisReview = ({ thread, revision, run = null, result = null }) => {
    if (!thread?.id || !revision?.id) return;
    closeChartReview();
    setAnalysisReviewState({ thread, revision, run, result });
    setAgentOpen(false);
  };
  const closeAnalysisReview = () => {
    setAnalysisReviewState(null);
  };
  const acceptAnalysisResultChart = async ({
    runId,
    analysisResultId,
    defaultVisibleTraceIds,
  }) => {
    if (!activeProjectId || !runId || !analysisResultId) return null;
    const response = await publishAcceptedAnalysisChart(runId, {
      analysisResultId,
      defaultVisibleTraceIds,
    }, {
      idempotencyKey: `publish_analysis_${runId}_${analysisResultId}`,
    });
    const state = await getServerProjectState(activeProjectId);
    const chartSpec = response.chartSpec;
    const chartSpecs = chartSpec
      ? [
        ...asArray(state.chartSpecs).filter((item) => item.id !== chartSpec.id),
        chartSpec,
      ]
      : asArray(state.chartSpecs);
    applyProjectWorkspaceRefresh({ ...state, chartSpecs });
    return response;
  };
  const acceptAnalysisResultExperiments = async ({
    runId,
    analysisResultId,
    identityResolutions,
  }) => {
    if (!activeProjectId || !runId || !analysisResultId) return null;
    const response = await publishAcceptedExperimentData(runId, {
      analysisResultId,
      identityResolutions,
    }, {
      idempotencyKey: `publish_experiments_${runId}_${analysisResultId}`,
    });
    const state = await getServerProjectState(activeProjectId);
    applyProjectWorkspaceRefresh(state);
    setBrowserSelectedExperimentIds(
      asArray(response.experimentSnapshotHeads)
        .map((head) => head.experimentId)
        .filter(Boolean),
    );
    setBrowserInitialViewId(response.browserView?.id || "");
    setTab("browser");
    return response;
  };
  const acceptAnalysisResult = (request) => (
    [
      analysisReviewState?.thread?.outputTarget,
      analysisReviewState?.revision?.outputTarget,
      analysisReviewState?.run?.outputTarget,
      analysisReviewState?.result?.outputTarget,
    ].includes("experiment_browser")
      ? acceptAnalysisResultExperiments(request)
      : acceptAnalysisResultChart(request)
  );
  const loadChartSpecDetailForManuscript = useCallback(async (chartSpecId) => {
    const response = await getServerChartSpec(chartSpecId);
    const chartSpec = response?.chartSpec || null;
    if (!chartSpec?.id) throw new Error("The ChartSpec detail response is incomplete.");
    setProjectState((current) => current ? {
      ...current,
      chartSpecs: upsertServerRecordById(current.chartSpecs, chartSpec),
    } : current);
    return chartSpec;
  }, []);
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
          sourceName={sourceError || sourceName}
          sourceError={sourceError}
          loadingSource={workbookReviewState.loading}
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
  const showProjectOnboarding = shouldShowProjectOnboarding(activeProjectId, projectState)
    && tab !== "workbook_review"
    && !analysisReviewState
    && !agentOpen;
  if (showProjectOnboarding) {
    return (
      <ProjectOnboarding
        key={`${activeProjectId}:${onboardingRenderVersion}`}
        projectId={activeProjectId}
        projectState={projectState}
        onUploadWorkbook={uploadOnboardingWorkbook}
        onHydrateWorkbookReview={hydrateOnboardingWorkbookReview}
        reviewState={workbookReviewState}
        reviewRegions={workbookReviewDraftRegions}
        activeRegionId={activeWorkbookReviewDraftRegionId}
        onActiveRegionChange={handleWorkbookReviewRegionActivate}
        onReviseRegion={reviseWorkbookReviewRegion}
        onConfirmRegion={confirmWorkbookReviewRegion}
        onRetryRegion={retryWorkbookReviewRegion}
        onIgnoreRegion={ignoreWorkbookReviewRegion}
        onDeleteRegion={deleteWorkbookReviewRegion}
        onCreateExperimentPlan={createOnboardingExperimentPlan}
        onRecoverExperimentPlan={recoverOnboardingExperimentPlan}
        onAcceptAnalysisResult={acceptAnalysisResultExperiments}
        onRequestCorrection={(correction) => {
          setRequestedAgentDraft(`The Experiment Browser preview needs this correction: ${correction}`);
          setRequestedAnalysisOutputTarget("experiment_browser");
          setAgentOpen(true);
        }}
        onComplete={() => {
          setOnboardingRenderVersion((value) => value + 1);
          setTab(asArray(projectState?.experimentSnapshotHeads).length ? "browser" : "overview");
        }}
        onExit={openProjectDashboard}
      />
    );
  }
  return (
    <>
      <Topbar tab={tab} setTab={setTab} dirty={dirty} onSave={save} onAgent={() => setAgentOpen(true)}
        workspaceMode={workspaceMode}
        onOpenDashboard={openProjectDashboard}
        sourceName={sourceName}
        sourceError={sourceError || (projectStateLoading ? "Loading project..." : "")}
        loadingSource={workbookReviewState.loading}
        onOpenImportReview={openWorkbookUpload}
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
        onAskLabRat={() => setAgentOpen(true)}
        onOpenProfile={() => setProfileChatOpen(true)}
        onUploadWorkbook={continueWorkbookReview}
        onDeleteWorkbook={deleteWorkbookReviewSessionFromProject}
        onGoBrowser={() => setTab("browser")}
        onOpenChartReview={openChartReview}
        onGoManuscript={() => setTab("manuscript")}
      />}
      {tab === "browser" && <ExperimentBrowser
        projectId={activeProjectId}
        initialSelectedExperimentIds={browserSelectedExperimentIds}
        initialViewId={browserInitialViewId}
        onSelectionChange={setBrowserSelectedExperimentIds}
        onOpenImportReview={openWorkbookUpload}
        onRequestDataChange={openExperimentBrowserDataRequest}
        onOpenSourceRange={focusExperimentBrowserSource}
      />}
      {tab === "workbook_review" && (
        <WorkbookReviewWorkspace
          projectId={activeProjectId}
          reviewState={workbookReviewState}
          draftRegions={workbookReviewDraftRegions}
          activeDraftRegionId={activeWorkbookReviewDraftRegionId}
          onDraftRegionsChange={setWorkbookReviewDraftRegions}
          onActiveDraftRegionChange={setActiveWorkbookReviewDraftRegionId}
          onCreateRegion={createWorkbookReviewRegion}
          focusSelection={workbookReviewFocusSelection}
          reviewDock={(
            <WorkbookReviewDock
              reviewState={workbookReviewState}
              reviewRegions={workbookReviewDraftRegions}
              activeRegionId={activeWorkbookReviewDraftRegionId}
              onActiveRegionChange={handleWorkbookReviewRegionActivate}
              onReviseRegion={reviseWorkbookReviewRegion}
              onConfirmRegion={confirmWorkbookReviewRegion}
              onRetryRegion={retryWorkbookReviewRegion}
              onIgnoreRegion={ignoreWorkbookReviewRegion}
              onDeleteRegion={deleteWorkbookReviewRegion}
              onReviewExtractedExperiments={openExperimentBrowserDataRequest}
            />
          )}
        />
      )}
      {tab === "manuscript" && <ManuscriptCanvas blocks={blocks} setBlocks={setBlocks} staged={staged} setStaged={setStaged} references={references} chartTemplates={chartTemplates} setChartTemplates={setChartTemplates} chartSpecs={activeChartSpecsForProject(projectState)} pages={pages} setPages={setPages} canvasHeight={canvasHeight} setCanvasHeight={setCanvasHeight} pageOrientationPreference={pageOrientationPreference} setPageOrientationPreference={setPageOrientationPreference} chartSpecInsertRequest={chartSpecInsertRequest} onChartSpecInsertRequestHandled={clearChartSpecManuscriptInsertRequest} onLoadChartSpecDetail={loadChartSpecDetailForManuscript} onSelectedChartContextChange={setSelectedChartContext} onRequestChartAnalysis={requestChartAnalysis} onSaveProject={save} />}
      {tab === "reference" && <ReferenceLibrary references={references} setReferences={setReferences} />}
      {analysisReviewState?.thread?.id && (
        <AnalysisReviewWorkspace
          projectId={activeProjectId}
          thread={analysisReviewState.thread}
          revision={analysisReviewState.revision}
          run={analysisReviewState.run}
          result={analysisReviewState.result}
          WorkbookWorkspaceComponent={WorkbookReviewWorkspace}
          onAcceptResult={acceptAnalysisResult}
          onClose={closeAnalysisReview}
          onAccepted={(response) => {
            if (response?.chartSpec) return;
            getServerProjectState(activeProjectId)
              .then(applyProjectWorkspaceRefresh)
              .catch((error) => setSourceError(error?.message || String(error)));
          }}
        />
      )}
      <DetailModal exp={selected} onClose={() => setSelected(null)} onStage={stage} />
      <ChartReviewModal
        open={chartReviewOpen}
        allowAnalysisPrompt={Boolean(activeProjectId)}
        chartInterpretState={backendChartInterpretState}
        chartSpecs={activeChartSpecsForProject(projectState)}
        statusFilter={chartReviewStatusFilter}
        onInterpretChart={interpretBackendChart}
        onLoadChartSpecDetail={loadChartSpecDetailForManuscript}
        onInsertChartSpec={(chartSpecId) => {
          requestChartSpecManuscriptInsert(chartSpecId);
          closeChartReview();
        }}
        onOpenImportReview={openWorkbookUpload}
        onClose={closeChartReview}
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
        onWorkbookReviewReady={handleWorkbookReviewReadyFromAgent}
        onWorkbookReviewLinkOpen={handleWorkbookReviewLinkOpen}
        onOpenAnalysisReview={openAnalysisReview}
        activeSurface={tab}
        requestedAnalysisOutputTarget={requestedAnalysisOutputTarget}
        onRequestedAnalysisTargetHandled={() => setRequestedAnalysisOutputTarget("")}
        requestedDraft={requestedAgentDraft}
        onRequestedDraftHandled={() => setRequestedAgentDraft("")}
      />
    </>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
