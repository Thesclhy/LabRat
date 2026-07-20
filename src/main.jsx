import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useCallback } from "react";
import { DataGrid } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { makePlot } from "./charts/makePlot";
import { ChartReviewPanel } from "./components/BackendScanPanel";
import { BlankOnboarding } from "./components/BlankOnboarding";
import { ProjectProfileChat } from "./components/ProjectProfileChat.jsx";
import { ServerLogin } from "./components/ServerLogin.jsx";
import { ThinkingIndicator } from "./components/ThinkingIndicator.jsx";
import { WorkbookReviewDock } from "./components/WorkbookReviewDock.jsx";
import { DataPlanReviewPanel } from "./components/DataPlanReviewPanel.jsx";
import { ExperimentBrowser } from "./components/ExperimentBrowser.jsx";
import { AnalysisConversationCard } from "./components/AnalysisConversationCard.jsx";
import { AnalysisReviewWorkspace } from "./components/AnalysisReviewWorkspace.jsx";
import { Plot } from "./charts/Plot";
import { ManuscriptCanvas } from "./components/ManuscriptCanvas";
import { BLANK_PROJECT_SOURCE_NAME, blankTemplateLinks, isBlankDataMode } from "./data/appMode.js";
import { interpretProjectChartIntent } from "./data/chartIntentClient.js";
import { removeChartProposal, setChartProposalStatus } from "./data/chartProposalViewState.js";
import { emptyDataset } from "./data/loadEmbeddedDataset.js";
import {
  confirmServerAgentRun,
  createServerAgentRun,
  createServerChartSpecFromProposal,
  createServerManuscript,
  createServerProject,
  createServerWorkbookReviewSession,
  draftServerProjectDataPlan,
  publishServerProjectDataPlan,
  deleteServerProject,
  getServerAgentRun,
  getServerProjectState,
  getServerSession,
  getServerWorkbookReviewSession,
  listServerSourceDocuments,
  listServerLabs,
  listServerProjects,
  loginToServer,
  logoutFromServer,
  patchServerChartProposalSet,
  patchServerManuscript,
  patchServerProjectProfile,
  patchServerSourceExtractProposal,
  planServerProjectAgent,
  reviseServerWorkbookReviewSession,
  readServerSourceDocumentRange,
  confirmServerWorkbookReviewSession,
  createServerSourceExtractChartProposal,
  uploadServerProjectFile,
} from "./data/serverApi.js";
import { ls } from "./storage/localStorage";
import { experimentDateSortValue, formatExperimentDateForDisplay } from "./utils/date.js";
import { fmt, uid } from "./utils/format";
import { initialWorkbookDraftRegions, reconcileWorkbookDraftRegions } from "./data/workbookReviewState.js";
import {
  boundsContainCell,
  getWorkbookTileCacheEntry,
  rememberWorkbookTileCacheEntry,
  WORKBOOK_SCROLL_DEBOUNCE_MS,
  workbookPrefetchTileBounds,
  workbookTileCacheKey,
  workbookVisibleTileBounds,
} from "./data/workbookRangeTiles.js";
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

function workbookSuggestionRange(region) {
  return region?.range || region?.rangeRef || region?.range_ref || "";
}

function workbookSuggestionSheet(region) {
  return region?.sheetName || region?.sheet_name || region?.sheet || "";
}

function workbookReviewSuggestionsFromResponse(response = {}) {
  const sourceDocument = response.sourceDocument || null;
  const sourceDocumentId = sourceDocument?.id || response.workbookReviewSession?.sourceDocumentId || response.session?.sourceDocumentId || "";
  const regionSuggestions = asArray(response.regions)
    .map((region) => {
      const sheetName = workbookSuggestionSheet(region);
      const range = workbookSuggestionRange(region);
      if (!sheetName || !range) return null;
      return {
        sourceDocumentId: region.sourceDocumentId || sourceDocumentId,
        sourceRegionId: region.id || "",
        sheetName,
        range,
        label: region.label || region.kind || "Detected source region",
        confidence: region.confidence ?? null,
        reason: region.kind || "detected_source_region",
        description: region.label || region.kind || "",
        selectionMethod: "suggestion_click",
      };
    })
    .filter(Boolean);
  if (regionSuggestions.length) return regionSuggestions.slice(0, 6);
  const fallbackSheets = asArray(sourceDocument?.metadata?.sheets);
  return fallbackSheets
    .map((sheet) => {
      const sheetName = sheet?.name || "";
      const range = sheet?.usedRange || "";
      if (!sheetName || !range) return null;
      return {
        sourceDocumentId,
        sourceRegionId: "",
        sheetName,
        range,
        label: "Used range",
        confidence: null,
        reason: "sheet_used_range",
        description: "Workbook used range",
        selectionMethod: "suggestion_click",
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function workbookSuggestionButtonLabel(selection) {
  return `Select ${selection.sheetName}!${selection.range}`;
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
    region.draftRegionId === targetId || region.clientRegionId === targetId
  )) || null;
}

const WORKBOOK_EXCEL_CELL_WIDTH = 112;
const WORKBOOK_EXCEL_ROW_HEIGHT = 30;
const WORKBOOK_EXCEL_EDGE_SCROLL_ZONE = 36;
const WORKBOOK_EXCEL_EDGE_SCROLL_INTERVAL_MS = 80;

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

function normalizeAgentRunActionForChat(action, agentRun = {}) {
  const result = action?.result && typeof action.result === "object" ? action.result : {};
  const proposalRefs = asArray(agentRun?.proposalRefs);
  const chartProposalSet = result.chartProposalSet || action?.chartProposalSet || null;
  const chartProposalPayload = chartProposalSet?.payload || action?.chartProposalSetPayload || null;
  const chartProposal = asArray(chartProposalPayload?.proposals)[0] || null;
  const chartProposalSetId = chartProposalSet?.id
    || result.chartProposalSetId
    || action?.chartProposalSetId
    || "";
  const sourceExtractProposal = result.sourceExtractProposal || action?.sourceExtractProposal || null;
  const sourceExtractProposalId = sourceExtractProposal?.id
    || result.sourceExtractProposalId
    || action?.sourceExtractProposalId
    || (action?.type === "create_source_extract_proposal"
      ? proposalRefs.find((ref) => ref?.type === "source_extract_proposal")?.id
      : "")
    || "";
  const warnings = [
    ...asArray(action?.warnings),
    ...asArray(agentRun?.warnings),
    ...asArray(chartProposalPayload?.warnings),
    ...asArray(sourceExtractProposal?.warnings),
  ];
  const previewPatch = {};
  if (chartProposal?.title || sourceExtractProposal?.preview?.chartIntentDraft?.title) {
    previewPatch.chartTitle = chartProposal?.title || sourceExtractProposal?.preview?.chartIntentDraft?.title || "";
  }
  if (chartProposalSetId || sourceExtractProposalId) {
    previewPatch.message = chartProposalSetId
      ? `Queued chart proposal set ${chartProposalSetId}.`
      : `Created source extract proposal ${sourceExtractProposalId}. Review the extracted source data before charting.`;
  }
  if (warnings.length) previewPatch.warnings = warnings;

  return {
    ...action,
    agentRunId: agentRun?.id || action?.agentRunId || "",
    ...(chartProposalSetId ? { chartProposalSetId } : {}),
    ...(chartProposalPayload ? { chartProposalSetPayload: chartProposalSet ? payloadWithServerId(chartProposalSet, "proposalSetId") : chartProposalPayload } : {}),
    ...(chartProposal?.proposalId ? { proposalId: chartProposal.proposalId, proposalStatus: chartProposal.status || "proposed" } : {}),
    ...(sourceExtractProposalId ? { sourceExtractProposalId, sourceExtractProposalStatus: sourceExtractProposal?.status || action?.sourceExtractProposalStatus || "proposed" } : {}),
    ...(sourceExtractProposal ? { sourceExtractProposal } : {}),
    preview: {
      ...(action?.preview || {}),
      ...previewPatch,
    },
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
  return spec?.origin === "source_extract" || Boolean(spec?.sourceSnapshot);
}

export function activeChartSpecsForProject(projectState) {
  return asArray(projectState?.chartSpecs).filter((chartSpec) => isActiveChartSpecForProject(chartSpec, projectState));
}

function staleChartSpecCountForProject(projectState) {
  return asArray(projectState?.chartSpecs).filter((chartSpec) => chartSpec && !isActiveChartSpecForProject(chartSpec, projectState)).length;
}

function projectWorkflowSummary(project, state = null) {
  const projectProfile = state?.projectProfile || project?.projectProfile || {};
  const profileCount = completedProfileFields(projectProfile);
  const publishedExperimentCount = asArray(state?.experimentSnapshotHeads).length;
  const hasPublishedData = publishedExperimentCount > 0;
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
    hasPublishedData,
    publishedExperimentCount,
    importStatus: latestImportRun?.status || (hasPublishedData ? "published" : "not started"),
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

export function ProjectOverview({ projectState, onAskLabRat, onOpenProfile, onUploadWorkbook, onGoBrowser, onOpenChartReview, onGoManuscript }) {
  const summary = projectWorkflowSummary(projectState?.project, projectState);
  const workbookReviewSessions = asArray(projectState?.workbookReviewSessions);
  const pendingWorkbookReviewSessions = workbookReviewSessions.filter((session) => session?.status !== "accepted");
  const acceptedWorkbookReviewSessions = workbookReviewSessions.filter((session) => session?.status === "accepted");
  const pendingWorkbookReviewSession = latestItem(pendingWorkbookReviewSessions);
  const acceptedWorkbookReviewSession = latestItem(acceptedWorkbookReviewSessions);
  const sourceDocumentCount = asArray(projectState?.sourceDocuments).length;
  const pendingChartProposals = pendingChartProposalsForProject(projectState);
  const activeChartProposalSummary = activeChartProposalSummaryForProject(projectState);
  const chartReviewDetail = "Use the one-chart prompt or queued proposals; source extracts stay reviewable before charting";
  const manageChartDetail = summary.staleChartSpecCount
    ? `${summary.chartSpecCount} active ChartSpecs. Some older specs are hidden until regenerated.`
    : summary.chartSpecCount
      ? `${summary.chartSpecCount} active ChartSpecs are available for Manuscript insertion`
      : "Accepted proposals and durable ChartSpecs appear here after review";
  const nextAction = !summary.profileComplete
    ? { label: "Edit profile", action: onOpenProfile }
    : pendingWorkbookReviewSessions.length
      ? { label: "Continue workbook review", action: () => onUploadWorkbook?.(pendingWorkbookReviewSession) }
      : !sourceDocumentCount
        ? { label: "Upload workbook", action: onAskLabRat }
        : summary.hasPublishedData
          ? { label: "Open Experiment Browser", action: onGoBrowser }
          : acceptedWorkbookReviewSessions.length
            ? { label: "View accepted review", action: () => onUploadWorkbook?.(acceptedWorkbookReviewSession) }
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
          value={`${sourceDocumentCount} source documents`}
          detail={pendingWorkbookReviewSessions.length
            ? `${pendingWorkbookReviewSessions.length} review sessions need confirmation before data or charts.`
            : acceptedWorkbookReviewSessions.length
              ? `${acceptedWorkbookReviewSessions.length} accepted review${acceptedWorkbookReviewSessions.length === 1 ? "" : "s"}. Workbook meaning is confirmed${summary.hasPublishedData ? ` and ${summary.publishedExperimentCount} experiments are published` : ""}.`
              : "Upload any Excel workbook and review detected source regions before extracting data."}
          action={pendingWorkbookReviewSessions.length
            ? "Continue review"
            : acceptedWorkbookReviewSessions.length
              ? "View accepted review"
              : "Upload workbook"}
          onClick={pendingWorkbookReviewSession
            ? () => onUploadWorkbook?.(pendingWorkbookReviewSession)
            : acceptedWorkbookReviewSession
              ? () => onUploadWorkbook?.(acceptedWorkbookReviewSession)
              : onAskLabRat}
          actionTitle={pendingWorkbookReviewSessions.length
            ? "Open the latest unfinished workbook review session"
            : acceptedWorkbookReviewSessions.length
              ? "Inspect the accepted workbook understanding"
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
        <ProjectOverviewCard title="Review chart proposals" value={`${summary.chartProposalCount} proposals`} detail={chartReviewDetail} action="Review chart proposals" onClick={onOpenChartReview}>
          <PendingChartProposalList
            proposals={pendingChartProposals.proposals}
            remaining={pendingChartProposals.remaining}
            onEditProposal={(proposalId) => onOpenChartReview?.(proposalId)}
          />
        </ProjectOverviewCard>
        <ProjectOverviewCard title="Manage approved charts" value={`${summary.acceptedCharts} accepted / ${summary.chartSpecCount} specs`} detail={manageChartDetail} action="Manage approved charts" onClick={() => onOpenChartReview?.({ statusFilter: "active" })}>
          <ActiveChartProposalSummary
            summary={activeChartProposalSummary}
          />
        </ProjectOverviewCard>
        <ProjectOverviewCard title="Manuscript" value={summary.manuscriptCount ? "Draft" : "Not started"} detail={summary.manuscriptUpdatedAt ? `Updated ${formatShortDate(summary.manuscriptUpdatedAt)}. Insert approved ChartSpecs only.` : "Insert approved ChartSpecs or future FigurePackages into the canvas"} action="Insert approved charts" onClick={onGoManuscript} />
      </section>
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

function proposalConfidenceLabel(proposal) {
  return typeof proposal?.confidence === "number" ? `${Math.round(proposal.confidence * 100)}%` : "n/a";
}

function PendingChartProposalList({ proposals = [], remaining = 0, onEditProposal }) {
  const items = asArray(proposals);
  if (!items.length) return null;
  return (
    <div className="overview-mini-list">
      {items.map((proposal) => (
        <div className="overview-mini-row" key={proposal.proposalId || proposal.title}>
          <div>
            <strong>{proposal.title || proposal.proposalId}</strong>
            <small>{proposal.chartType || "chart"} - {proposalConfidenceLabel(proposal)} - {proposal.status || "proposed"}</small>
          </div>
          <button type="button" onClick={() => onEditProposal?.(proposal.proposalId)}>Edit</button>
        </div>
      ))}
      {remaining > 0 && <small className="overview-mini-more">+{remaining} more pending</small>}
    </div>
  );
}

function ActiveChartProposalSummary({ summary }) {
  if (!summary?.total) return null;
  return (
    <div className="overview-mini-list">
      <small>{summary.accepted} accepted / {summary.pending} pending</small>
    </div>
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
  focusSelection = null,
  reviewDock = null,
}) {
  const session = reviewState?.session || reviewState?.workbookReviewSession || null;
  const initialSourceDocument = reviewState?.sourceDocument || null;
  const [documentsState, setDocumentsState] = useState({
    loading: false,
    error: "",
    items: initialSourceDocument?.id ? [initialSourceDocument] : [],
  });
  const [selectedDocumentId, setSelectedDocumentId] = useState(initialSourceDocument?.id || "");
  const [activeSheetName, setActiveSheetName] = useState("");
  const [activeRange, setActiveRange] = useState("");
  const [rangeState, setRangeState] = useState({ loading: false, error: "" });
  const [scrollState, setScrollState] = useState({ top: 0, left: 0, width: 1100, height: 600 });
  const [settledScrollState, setSettledScrollState] = useState({ top: 0, left: 0, width: 1100, height: 600 });
  const [rangeCacheRevision, setRangeCacheRevision] = useState(0);
  const [dragSelection, setDragSelection] = useState(null);
  const dragSelectionRef = useRef(null);
  const viewportRef = useRef(null);
  const gridScrollRef = useRef(null);
  const rangeCacheRef = useRef(new Map());
  const pendingScrollStateRef = useRef(scrollState);
  const scrollFrameRef = useRef(null);
  const scrollDirectionRef = useRef({ top: 0, left: 0 });
  const edgeScrollDirectionRef = useRef({ x: 0, y: 0 });
  const appliedFocusKeyRef = useRef("");
  const sourceDocument = documentsState.items.find((document) => document.id === selectedDocumentId)
    || initialSourceDocument
    || documentsState.items[0]
    || null;
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
  const editableDrafts = useMemo(
    () => draftRegionsForSheet.filter((region) => region.status !== "reviewed_input"),
    [draftRegionsForSheet],
  );
  const displayBounds = parseExcelA1Range(activeRange) || excelRangeBoundsFromSheet(activeSheet);
  const visibleTileBounds = useMemo(() => workbookVisibleTileBounds(displayBounds, settledScrollState, {
    rowHeight: WORKBOOK_EXCEL_ROW_HEIGHT,
    columnWidth: WORKBOOK_EXCEL_CELL_WIDTH,
  }), [
    activeRange,
    activeSheet?.name,
    settledScrollState.top,
    settledScrollState.left,
    settledScrollState.width,
    settledScrollState.height,
  ]);
  const visibleTileKey = visibleTileBounds.map(formatExcelA1Range).join("|");
  const loadedTileEntries = useMemo(() => [...rangeCacheRef.current.values()].filter((entry) => (
    entry?.status === "fulfilled"
    && entry.sourceDocumentId === sourceDocument?.id
    && entry.sheetName === activeSheetName
  )), [rangeCacheRevision, sourceDocument?.id, activeSheetName]);
  const loadedTileBounds = useMemo(
    () => loadedTileEntries.map((entry) => entry.bounds),
    [loadedTileEntries],
  );
  const cellsByCoord = useMemo(() => {
    const cells = new Map();
    loadedTileEntries.forEach((entry) => {
      excelCellsFromRangeResult(entry.result).forEach((cell, key) => cells.set(key, cell));
    });
    return cells;
  }, [loadedTileEntries]);
  const rowIndexes = [];
  const colIndexes = [];
  for (let row = displayBounds.startRow; row <= displayBounds.endRow; row += 1) rowIndexes.push(row);
  for (let col = displayBounds.startCol; col <= displayBounds.endCol; col += 1) colIndexes.push(col);

  useEffect(() => {
    setDocumentsState((current) => {
      if (!initialSourceDocument?.id) return current;
      if (current.items.some((document) => document.id === initialSourceDocument.id)) return current;
      return { ...current, items: [initialSourceDocument, ...current.items] };
    });
    if (initialSourceDocument?.id) setSelectedDocumentId((current) => current || initialSourceDocument.id);
  }, [initialSourceDocument?.id]);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    setDocumentsState((current) => ({ ...current, loading: true, error: "" }));
    listServerSourceDocuments(projectId)
      .then((body) => {
        if (cancelled) return;
        const items = asArray(body?.sourceDocuments);
        setDocumentsState({ loading: false, error: "", items: items.length ? items : (initialSourceDocument?.id ? [initialSourceDocument] : []) });
        setSelectedDocumentId((current) => current || items[0]?.id || initialSourceDocument?.id || "");
      })
      .catch((err) => {
        if (cancelled) return;
        setDocumentsState((current) => ({ ...current, loading: false, error: err.message || String(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, initialSourceDocument?.id]);

  useEffect(() => {
    if (!sourceDocument?.id) return;
    const nextSheet = activeSheetName && sheets.some((sheet) => sheet.name === activeSheetName)
      ? activeSheetName
      : sheets[0]?.name || "";
    if (nextSheet && nextSheet !== activeSheetName) setActiveSheetName(nextSheet);
  }, [sourceDocument?.id, sheets, activeSheetName]);

  useEffect(() => {
    if (!activeSheet) return;
    const nextRange = activeRange || activeSheet.usedRange || formatExcelA1Range(excelRangeBoundsFromSheet(activeSheet));
    if (nextRange && nextRange !== activeRange) setActiveRange(nextRange);
  }, [activeSheet?.name, activeSheet?.usedRange, activeRange]);

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
    scrollDirectionRef.current = { top: 0, left: 0 };
    setScrollState(nextScrollState);
    setSettledScrollState(nextScrollState);
    setRangeState((current) => ({ ...current, error: "" }));
  }, [sourceDocument?.id, activeSheetName, activeRange]);

  useEffect(() => {
    if (!focusSelection?.sourceDocumentId || !focusSelection?.sheetName || !focusSelection?.range) return;
    const focusKey = `${focusSelection.requestId || ""}:${focusSelection.sourceDocumentId}:${focusSelection.sheetName}:${focusSelection.range}`;
    if (appliedFocusKeyRef.current === focusKey) return;
    appliedFocusKeyRef.current = focusKey;
    setSelectedDocumentId(focusSelection.sourceDocumentId);
    setActiveSheetName(focusSelection.sheetName);
    setActiveRange(focusSelection.range);
    if (focusSelection.focusOnly) return;
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
  }, [focusSelection, draftRegions, onDraftRegionsChange, onActiveDraftRegionChange]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setSettledScrollState(scrollState);
    }, WORKBOOK_SCROLL_DEBOUNCE_MS);
    return () => window.clearTimeout(timerId);
  }, [scrollState]);

  const loadWorkbookTile = useCallback((bounds) => {
    if (!sourceDocument?.id || !activeSheetName || !bounds) return Promise.resolve(null);
    const cacheKey = workbookTileCacheKey(sourceDocument.id, activeSheetName, bounds);
    const cached = getWorkbookTileCacheEntry(rangeCacheRef.current, cacheKey);
    if (cached?.status === "fulfilled") return Promise.resolve(cached.result);
    if (cached?.status === "pending") return cached.promise;

    const range = formatExcelA1Range(bounds);
    let request;
    request = readServerSourceDocumentRange(sourceDocument.id, { sheetName: activeSheetName, range })
      .then((result) => {
        rememberWorkbookTileCacheEntry(rangeCacheRef.current, cacheKey, {
          status: "fulfilled",
          sourceDocumentId: sourceDocument.id,
          sheetName: activeSheetName,
          bounds,
          range,
          result,
        });
        setRangeCacheRevision((value) => value + 1);
        return result;
      })
      .catch((err) => {
        if (rangeCacheRef.current.get(cacheKey)?.promise === request) {
          rangeCacheRef.current.delete(cacheKey);
        }
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
    if (!sourceDocument?.id || !activeSheetName || !activeRange || !visibleTileBounds.length) {
      setRangeState({ loading: false, error: "" });
      return undefined;
    }
    let cancelled = false;
    const needsLoad = visibleTileBounds.some((bounds) => {
      const cacheKey = workbookTileCacheKey(sourceDocument.id, activeSheetName, bounds);
      return rangeCacheRef.current.get(cacheKey)?.status !== "fulfilled";
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
  }, [sourceDocument?.id, activeSheetName, activeRange, visibleTileKey, loadWorkbookTile]);

  useEffect(() => {
    const prefetchBounds = workbookPrefetchTileBounds(
      displayBounds,
      visibleTileBounds,
      scrollDirectionRef.current,
    );
    if (!prefetchBounds) return undefined;
    const timerId = window.setTimeout(() => {
      loadWorkbookTile(prefetchBounds).catch(() => {});
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [
    sourceDocument?.id,
    activeSheetName,
    activeRange,
    visibleTileKey,
    settledScrollState.top,
    settledScrollState.left,
    loadWorkbookTile,
  ]);

  const createCellDraftRegion = (row, col, selectionMethod = "cell_context_menu") => {
    if (!sourceDocument?.id || !activeSheetName) return;
    const range = formatExcelA1Range({ startRow: row, endRow: row, startCol: col, endCol: col });
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
  const createRangeDraftRegion = (start, end, selectionMethod = "drag_select", additive = false) => {
    if (!sourceDocument?.id || !activeSheetName || !start || !end) return;
    const bounds = normalizeExcelBounds({
      startRow: start.row,
      endRow: end.row,
      startCol: start.col,
      endCol: end.col,
    });
    const range = formatExcelA1Range(bounds);
    const matchingRegion = asArray(draftRegions).find((region) => (
      region.sourceDocumentId === sourceDocument.id
      && region.sheetName === activeSheetName
      && region.range === range
    ));
    if (additive && matchingRegion) {
      const matchingId = matchingRegion.draftRegionId || matchingRegion.clientRegionId || "";
      const nextRegions = asArray(draftRegions).filter((region) => region !== matchingRegion);
      const activeStillExists = findWorkbookDraftRegionById(nextRegions, activeDraftRegionId);
      const fallbackRegion = activeStillExists || nextRegions.findLast((region) => (
        region.sourceDocumentId === sourceDocument.id && region.sheetName === activeSheetName
      )) || nextRegions.at(-1);
      onDraftRegionsChange?.(nextRegions);
      if (matchingId === activeDraftRegionId || !activeStillExists) {
        onActiveDraftRegionChange?.(fallbackRegion?.draftRegionId || fallbackRegion?.clientRegionId || "");
      }
      return;
    }
    const activeRegion = findWorkbookDraftRegionById(draftRegions, activeDraftRegionId);
    const replacedRegion = additive ? null : activeRegion;
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
    const previous = pendingScrollStateRef.current || nextScrollState;
    scrollDirectionRef.current = {
      top: nextScrollState.top - previous.top,
      left: nextScrollState.left - previous.left,
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
      createRangeDraftRegion(current.start, current.end, "drag_select", current.additive);
    }
  };
  useEffect(() => {
    if (!dragSelection?.active) return undefined;
    window.addEventListener("mouseup", finishCellDragSelection);
    return () => window.removeEventListener("mouseup", finishCellDragSelection);
  }, [dragSelection?.active, draftRegions, sourceDocument?.id, activeSheetName, activeDraftRegionId]);
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
        if (cellInAnyWorkbookRegion(row.__rowIndex, col, editableDrafts)) classes.push("is-draft");
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
    editableDrafts,
    loadedTileBounds,
    rangeState.loading,
    regionsForSheet,
    reviewedAnalysisInputs,
    visibleTileKey,
  ]);

  return (
    <main className="workbook-review-workspace">
      <section className="workbook-excel-toolbar" aria-label="Workbook controls">
        <strong>{workbookName}</strong>
        {documentsState.items.length > 1 && (
          <select
            aria-label="Workbook"
            value={selectedDocumentId}
            onChange={(event) => {
              setSelectedDocumentId(event.target.value);
              setActiveSheetName("");
              setActiveRange("");
            }}
          >
            {documentsState.items.map((document) => (
              <option value={document.id} key={document.id}>
                {document.metadata?.workbookName || document.fileName || document.id}
              </option>
            ))}
          </select>
        )}
        <div className="workbook-sheet-tabs" aria-label="Workbook sheets">
          {sheets.map((sheet) => (
            <button
              type="button"
              className={sheet.name === activeSheetName ? "active" : ""}
              key={sheet.name}
              onClick={() => {
                setActiveSheetName(sheet.name);
                setActiveRange(sheet.usedRange || formatExcelA1Range(excelRangeBoundsFromSheet(sheet)));
              }}
            >
              {sheet.name}
            </button>
          ))}
        </div>
        <input
          aria-label="Visible range"
          value={activeRange}
          onChange={(event) => setActiveRange(event.target.value)}
          placeholder="A1:D20"
        />
      </section>
      <div className={`workbook-review-layout${reviewDock ? " has-review-dock" : ""}`}>
        <section className="workbook-review-main" aria-label="Workbook evidence">
          {reviewState?.error && <p className="import-review-error">{reviewState.error}</p>}
          {documentsState.error && <p className="import-review-error">{documentsState.error}</p>}
          {rangeState.error && <p className="import-review-error">{rangeState.error}</p>}
          {!sourceDocument && !documentsState.loading && (
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
  allowSourcePrompt = false,
  chartProposalState,
  chartInterpretState,
  chartSpecs,
  focusProposalId,
  statusFilter,
  onChartProposalDecision,
  onChartProposalDelete,
  onInterpretChart,
  onSourceExtractDecision,
  onCreateChartProposalFromSourceExtract,
  onCreateChartSpec,
  onOpenImportReview,
  onClose,
}) {
  const [reviewMode, setReviewMode] = useState(statusFilter === "active" ? "edit" : "review");
  useEffect(() => {
    if (open) setReviewMode(statusFilter === "active" ? "edit" : "review");
  }, [open, statusFilter]);
  if (!open) return null;
  const canReviewCharts = allowSourcePrompt;
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
          <div className="chart-review-mode-tabs" role="tablist" aria-label="Chart review mode">
            <button
              type="button"
              role="tab"
              aria-selected={reviewMode === "review"}
              className={reviewMode === "review" ? "active" : ""}
              onClick={() => setReviewMode("review")}
            >
              Review proposals
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reviewMode === "edit"}
              className={reviewMode === "edit" ? "active" : ""}
              onClick={() => setReviewMode("edit")}
            >
              Edit specs
            </button>
          </div>
          {canReviewCharts ? (
            <ChartReviewPanel
              allowSourcePrompt={allowSourcePrompt}
              chartProposalState={chartProposalState}
              chartInterpretState={chartInterpretState}
              chartSpecs={chartSpecs}
              focusProposalId={focusProposalId}
              statusFilter={statusFilter}
              viewMode={reviewMode}
              onChartProposalDecision={onChartProposalDecision}
              onChartProposalDelete={onChartProposalDelete}
              onInterpretChart={onInterpretChart}
              onSourceExtractDecision={onSourceExtractDecision}
              onCreateChartProposalFromSourceExtract={onCreateChartProposalFromSourceExtract}
              onCreateChartSpec={onCreateChartSpec}
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

function AgentActionCard({ action, projectState, busyActionId, onChooseFile, onUseExistingFile, onExecute, onConfirm, onAcceptChartProposal, onCreateChartSpec, onInsertChartSpec, onReviewSourceExtract }) {
  const params = action.params || {};
  const preview = action.preview || null;
  const fileOptions = asArray(params.existingFiles);
  const isBusy = busyActionId === action.actionId || ["previewing", "executing", "accepting_proposal", "creating_chart_spec"].includes(action.status);
  const isBackendAgentRunAction = Boolean(action.agentRunId);
  const isAgentRunConfirmable = Boolean(action.agentRunId)
    && ["create_compare_chart_proposal", "create_source_extract_proposal"].includes(action.type)
    && action.status === "requires_confirmation";
  const isFrontendExecutableAgentRunAction = isBackendAgentRunAction
    && ["interpret_chart"].includes(action.type)
    && action.status === "requires_confirmation";
  const canRefreshClosedAgentRun = isBackendAgentRunAction
    && action.status === "failed"
    && /AgentRun is already (completed|cancelled)/i.test(action.error || "");
  const canConfirm = isAgentRunConfirmable || ["ready_to_apply", "ready_to_persist", "ready_to_create"].includes(action.status);
  const hasChatChartProposal = ["interpret_chart", "compare_series", "create_compare_chart_proposal"].includes(action.type) && action.chartProposalSetId && action.proposalId;
  const hasSourceExtractProposal = Boolean(action.sourceExtractProposalId) && !hasChatChartProposal;
  const proposalAccepted = action.proposalStatus === "accepted" || ["proposal_accepted", "chart_spec_created"].includes(action.status);
  const chartSpecCreated = action.status === "chart_spec_created" || Boolean(action.chartSpecId);
  const warnings = [...asArray(action.warnings), ...asArray(preview?.warnings)];
  const targetAliases = asArray(params.targetExperimentAliases).length
    ? asArray(params.targetExperimentAliases)
    : asArray(params.experimentAliases);
  return (
    <div className={`agent-action-card is-${action.status || "proposed"}`}>
      <div className="agent-action-head">
        <strong>{action.label || action.type}</strong>
        <span>{action.status || "proposed"}</span>
      </div>
      {action.description && <p>{action.description}</p>}
      {targetAliases.length > 0 && <small>Target: {targetAliases.join(", ")}</small>}
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
        {!action.requiresFile && (!isBackendAgentRunAction || isFrontendExecutableAgentRunAction) && !canConfirm && action.status !== "completed" && !hasChatChartProposal && (
          <button type="button" disabled={isBusy} onClick={() => onExecute?.(action.actionId)}>
            {isBusy ? "Working..." : action.type === "resolve_data_query" ? "Resolve query" : "Prepare"}
          </button>
        )}
        {canConfirm && (
          <button type="button" className="primary" disabled={isBusy} onClick={() => onConfirm?.(action.actionId)}>
            {isBusy ? "Applying..." : isAgentRunConfirmable ? "Confirm agent action" : action.type === "create_chart_spec_from_proposal" ? "Create ChartSpec" : action.type?.includes("chart") ? "Confirm chart action" : "Confirm apply"}
          </button>
        )}
        {canRefreshClosedAgentRun && (
          <button type="button" className="primary" disabled={isBusy} onClick={() => onConfirm?.(action.actionId)}>
            {isBusy ? "Refreshing..." : "Refresh result"}
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
        {hasSourceExtractProposal && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onReviewSourceExtract?.(action.sourceExtractProposal || {
              id: action.sourceExtractProposalId,
              status: action.sourceExtractProposalStatus || "proposed",
            })}
          >
            Review source extract
          </button>
        )}
        {action.status === "completed" && !hasChatChartProposal && <span className="workflow-status is-applied">Completed</span>}
      </div>
      {projectState?.project?.name && <small>Project: {projectState.project.name}</small>}
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
  onInsertChartSpec,
  onReviewSourceExtract,
  onWorkbookReviewReady,
  onWorkbookSuggestionSelect,
  onOpenExperimentBrowser,
  onOpenAnalysisReview,
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
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingFileActionId, setPendingFileActionId] = useState("");
  const [pendingSpreadsheetFile, setPendingSpreadsheetFile] = useState(null);
  const [busyActionId, setBusyActionId] = useState("");
  const messagesRef = useRef(null);
  const chatScrollInitializedRef = useRef(false);
  const lastChatScrollTopRef = useRef(0);
  const fileActionInputRef = useRef(null);
  const [settingsDraft, setSettingsDraft] = useState({
    writingExamples,
    projectBackground,
    houseRules,
  });
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
  const recoverCompletedAgentRunAction = async (action) => {
    const response = await getServerAgentRun(action.agentRunId);
    const latestRun = response.agentRun || {};
    const latestAction = asArray(latestRun.actions).find((candidate) => candidate.actionId === action.actionId);
    if (!latestAction) throw new Error("The completed AgentRun action could not be found.");
    const normalizedAction = normalizeAgentRunActionForChat(latestAction, latestRun);
    updateActionInHistory(action.actionId, {
      ...normalizedAction,
      error: "",
      preview: {
        ...(action.preview || {}),
        ...(normalizedAction.preview || {}),
      },
    });
    await reloadProjectAfterAgentAction();
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
  const createWorkbookReviewSessionFromAgentFile = async (action, { file = null, fileObjectId = "" } = {}) => {
    if (!activeProjectId) throw new Error("Select a server project first.");
    let nextFileObjectId = fileObjectId;
    if (!nextFileObjectId && file) {
      const uploaded = await uploadServerProjectFile(activeProjectId, file);
      nextFileObjectId = uploaded.fileObject?.id;
    }
    if (!nextFileObjectId) throw new Error("Choose a workbook file first.");
    const response = await createServerWorkbookReviewSession(activeProjectId, { fileObjectId: nextFileObjectId });
    const session = response.workbookReviewSession || response.session || null;
    const sourceDocument = response.sourceDocument || null;
    const workbookName = sourceDocument?.metadata?.workbookName || session?.workbookSummary?.workbookName || file?.name || "workbook";
    onWorkbookReviewReady?.({
      response,
      session,
      sourceDocument,
      regions: asArray(response.regions),
      file,
      suggestions: workbookReviewSuggestionsFromResponse(response),
    });
    updateActionInHistory(action.actionId, {
      status: "completed",
      workbookReviewSessionId: session?.id || "",
      sourceDocumentId: sourceDocument?.id || "",
      preview: {
        summary: session?.workbookSummary || {},
        message: `Created workbook review session for ${workbookName}. Review the source workbook before extracting data or charting.`,
        warnings: session?.warnings || [],
      },
      error: "",
    });
    await reloadProjectAfterAgentAction();
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
    const suggestions = workbookReviewSuggestionsFromResponse(response);
    onWorkbookReviewReady?.({
      response,
      session,
      sourceDocument,
      regions: asArray(response.regions),
      file,
      suggestions,
    });
    await reloadProjectAfterAgentAction();
    return {
      response,
      session,
      sourceDocument,
      suggestions,
    };
  };
  const executeAgentAction = async (actionId, filePayload = {}) => {
    const action = actionById(actionId);
    if (!action || busyActionId) return;
    setBusyActionId(actionId);
    updateActionInHistory(actionId, { status: action.requiresFile ? "previewing" : "executing", error: "" });
    try {
      if (action.requiresFile) {
        await createWorkbookReviewSessionFromAgentFile(action, filePayload);
      } else if (action.type === "open_experiment_browser") {
        onOpenExperimentBrowser?.(action.params || {});
        updateActionInHistory(actionId, {
          status: "completed",
          preview: {
            message: "Opened Experiment Browser for source-backed comparison.",
            warnings: action.warnings || [],
          },
          error: "",
        });
      } else if (["resolve_data_query", "propose_charts", "compare_series"].includes(action.type)) {
        throw new Error("This legacy dataset action is retired. Use Experiment Browser for comparison or select workbook source evidence for charting.");
      } else if (action.type === "interpret_chart") {
        const intentResult = await interpretProjectChartIntent(activeProjectId, {
          prompt: action.params?.prompt || "",
          persistAsProposal: true,
          entrypoint: "agent_drawer",
          context: { actionId },
        });
        const response = intentResult.response;
        const chartProposalSet = response.chartProposalSet || null;
        const proposalPayload = chartProposalSet?.payload || null;
        const proposal = asArray(proposalPayload?.proposals)[0] || null;
        const sourceExtractProposal = response.sourceExtractProposal || null;
        const completed = Boolean(chartProposalSet || sourceExtractProposal);
        updateActionInHistory(actionId, {
          status: completed ? "completed" : "failed",
          chartIntentKind: intentResult.kind,
          chartProposalSetId: chartProposalSet?.id || "",
          chartProposalSetPayload: proposalPayload ? payloadWithServerId(chartProposalSet, "proposalSetId") : null,
          proposalId: proposal?.proposalId || "",
          proposalStatus: proposal?.status || "proposed",
          sourceExtractProposalId: sourceExtractProposal?.id || "",
          sourceExtractProposalStatus: sourceExtractProposal?.status || "",
          sourceExtractProposal,
          preview: {
            chartTitle: proposal?.title || response.chartSpecDraft?.title || sourceExtractProposal?.preview?.chartIntentDraft?.title || "",
            message: chartProposalSet
              ? `Queued chart proposal set ${chartProposalSet.id}.`
              : sourceExtractProposal
                ? `Created source extract proposal ${sourceExtractProposal.id}. Review the extracted source data before charting.`
                : response.clarification?.message || "Chart could not be drafted.",
            warnings: [
              ...asArray(response.warnings),
              ...asArray(sourceExtractProposal?.warnings),
            ],
          },
          error: completed ? "" : response.clarification?.message || "Chart draft requires clarification.",
        });
        if (completed) await reloadProjectAfterAgentAction();
      } else if (action.type === "create_chart_spec_from_proposal") {
        if (!action.params?.chartProposalSetId || !action.params?.proposalId) throw new Error("No accepted proposal is available for ChartSpec creation.");
        updateActionInHistory(actionId, { status: "ready_to_create" });
      }
    } catch (err) {
      const alreadyClosedAgentRun = Boolean(action.agentRunId)
        && (err?.code === "agent_run_closed" || /AgentRun is already (completed|cancelled)/i.test(err?.message || ""));
      if (alreadyClosedAgentRun) {
        try {
          await recoverCompletedAgentRunAction(action);
          return;
        } catch (recoverErr) {
          updateActionInHistory(actionId, { status: "failed", error: recoverErr.message || err.message || String(recoverErr || err) });
          return;
        }
      }
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
      if (action.agentRunId) {
        const response = await confirmServerAgentRun(action.agentRunId, actionId);
        const chartProposalSet = response.chartProposalSet || null;
        const proposalPayload = chartProposalSet?.payload || null;
        const proposal = asArray(proposalPayload?.proposals)[0] || null;
        const sourceExtractProposal = response.sourceExtractProposal || null;
        updateActionInHistory(actionId, {
          status: "completed",
          chartProposalSetId: chartProposalSet?.id || "",
          chartProposalSetPayload: chartProposalSet?.payload ? payloadWithServerId(chartProposalSet, "proposalSetId") : null,
          proposalId: proposal?.proposalId || "",
          proposalStatus: proposal?.status || "proposed",
          sourceExtractProposalId: sourceExtractProposal?.id || "",
          sourceExtractProposalStatus: sourceExtractProposal?.status || "",
          sourceExtractProposal,
          preview: {
            ...(action.preview || {}),
            chartTitle: proposal?.title || sourceExtractProposal?.preview?.chartIntentDraft?.title || "",
            message: chartProposalSet?.id
              ? `Queued chart proposal set ${chartProposalSet.id}.`
              : sourceExtractProposal?.id
                ? `Created source extract proposal ${sourceExtractProposal.id}.`
                : "AgentRun action completed.",
            warnings: [
              ...asArray(response.agentRun?.warnings),
              ...asArray(response.chartProposalSet?.payload?.warnings),
              ...asArray(sourceExtractProposal?.warnings),
            ],
          },
          error: "",
        });
        await reloadProjectAfterAgentAction();
        return;
      }

      if (action.type === "create_chart_spec_from_proposal") {
        await createServerChartSpecFromProposal(activeProjectId, {
          chartProposalSetId: action.params?.chartProposalSetId,
          proposalId: action.params?.proposalId,
        });
        await reloadProjectAfterAgentAction();
      }
      updateActionInHistory(actionId, { status: "completed", error: "" });
    } catch (err) {
      const alreadyClosedAgentRun = Boolean(action.agentRunId)
        && (err?.code === "agent_run_closed" || /AgentRun is already (completed|cancelled)/i.test(err?.message || ""));
      if (alreadyClosedAgentRun) {
        try {
          await recoverCompletedAgentRunAction(action);
          return;
        } catch (recoverErr) {
          updateActionInHistory(actionId, { status: "failed", error: recoverErr.message || err.message || String(recoverErr || err) });
          return;
        }
      }
      updateActionInHistory(actionId, { status: "failed", error: err.message || String(err) });
    } finally {
      setBusyActionId("");
    }
  };
  const chooseFileForAgentAction = (actionId) => {
    setPendingFileActionId(actionId);
    fileActionInputRef.current?.click();
  };
  const chooseSpreadsheetAttachment = () => {
    setPendingFileActionId("");
    fileActionInputRef.current?.click();
  };
  const onAgentFileSelected = async (event) => {
    const file = event.target.files?.[0];
    const actionId = pendingFileActionId;
    event.target.value = "";
    setPendingFileActionId("");
    if (!file) return;
    if (actionId) {
      await executeAgentAction(actionId, { file });
      return;
    }
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
        const suggestions = asArray(result.suggestions);
        const workbookName = result.sourceDocument?.metadata?.workbookName
          || result.session?.workbookSummary?.workbookName
          || spreadsheetAttachment.name
          || "workbook";
        setHistory([...next, {
          role: "assistant",
          text: suggestions.length
            ? `I indexed ${workbookName}. I found potentially useful regions; click a range to highlight it in the Excel preview.`
            : `I indexed ${workbookName}. You can inspect the workbook in the preview; select a range and describe it if you want LabRat to revise its understanding.`,
          workbookSuggestions: suggestions,
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
      setBusy(true);
      try {
        const response = await createServerAgentRun(activeProjectId, {
          message: text,
          conversation: next.slice(-10).map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            text: message.text,
          })),
          selectedContext: {
            tab: selectedChartContext ? "manuscript_chart" : "project",
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
        });
        const agentRun = response.agentRun || {};
        const actions = asArray(agentRun.actions).map((action) => normalizeAgentRunActionForChat(action, agentRun));
        const warningText = asArray(agentRun.warnings).map((warning) => warning.message || warning.code).filter(Boolean).join(" ");
        const reply = response.reply || (actions.length
          ? "I prepared an AgentRun action. Review the trace and confirm before anything changes."
          : warningText || "I recorded an AgentRun, but I need more detail before preparing an action.");
        const analysisThread = response.analysisThread || null;
        const currentPlanRevision = response.currentPlanRevision || null;
        setHistory([...next, {
          role: "assistant",
          text: reply,
          agentRun,
          actions,
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
              selectedChartBlockId: selectedChartContext?.blockId || "",
              selectedChartView: selectedChartContext?.chartView || null,
              assistantProfile: {
                writingExamples,
                projectBackground,
                houseRules,
              },
            },
          });
          const actions = asArray(plan.actions);
          setHistory([...next, {
            role: "assistant",
            text: plan.reply || (actions.length ? "I prepared a project action for review." : "I could not identify a project action yet."),
            actions,
          }]);
        } catch (fallbackErr) {
          setHistory([...next, { role: "assistant", text: `Project agent failed: ${fallbackErr.message || err.message || String(fallbackErr || err)}` }]);
        }
      } finally {
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
          {!!asArray(m.workbookSuggestions).length && (
            <div className="agent-workbook-suggestions">
              {asArray(m.workbookSuggestions).map((selection, selectionIndex) => (
                <button
                  type="button"
                  key={`${selection.sourceDocumentId}-${selection.sheetName}-${selection.range}-${selectionIndex}`}
                  onClick={() => onWorkbookSuggestionSelect?.(selection)}
                >
                  {workbookSuggestionButtonLabel(selection)}
                </button>
              ))}
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
              onOpen={onOpenAnalysisReview}
            />
          )}
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
              onReviewSourceExtract={onReviewSourceExtract}
            />
          ))}
          {m.role === "assistant" && m.meta?.source === "chart" && m.text && !m.streaming && !m.text.startsWith("Request failed:") && <button className="insert-chat-text" onClick={() => insertAssistantText(m)}>Insert as text box</button>}
        </div>
      </div>)}
      {busy && !history.some((m) => m.role === "assistant" && m.streaming && m.text) && <div className="typing">Thinking...</div>}
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
  const [focusedChartProposalId, setFocusedChartProposalId] = useState("");
  const [chartReviewStatusFilter, setChartReviewStatusFilter] = useState("");
  const [workbookReviewState, setWorkbookReviewState] = useState({ loading: false, error: "", revisionLoading: false, confirmLoading: false, revisionError: "", clarification: null, session: null, sourceDocument: null, regions: [] });
  const [dataPlanReviewState, setDataPlanReviewState] = useState({ loading: false, error: "", review: null, identityDecisions: [] });
  const [workbookReviewDraftRegions, setWorkbookReviewDraftRegions] = useState([]);
  const [activeWorkbookReviewDraftRegionId, setActiveWorkbookReviewDraftRegionId] = useState("");
  const [workbookReviewFocusSelection, setWorkbookReviewFocusSelection] = useState(null);
  const [browserSelectedExperimentIds, setBrowserSelectedExperimentIds] = useState([]);
  const [backendChartProposalState, setBackendChartProposalState] = useState({ loading: false, result: null, error: "" });
  const [backendChartInterpretState, setBackendChartInterpretState] = useState({ loading: false, result: null, error: "" });
  const resetReviewState = () => {
    setBackendChartProposalState({ loading: false, result: null, error: "" });
    setBackendChartInterpretState({ loading: false, result: null, error: "" });
    setFocusedChartProposalId("");
    setChartReviewStatusFilter("");
    setWorkbookReviewState({ loading: false, error: "", revisionLoading: false, confirmLoading: false, revisionError: "", clarification: null, session: null, sourceDocument: null, regions: [] });
    setDataPlanReviewState({ loading: false, error: "", review: null, identityDecisions: [] });
    setWorkbookReviewDraftRegions([]);
    setActiveWorkbookReviewDraftRegionId("");
    setWorkbookReviewFocusSelection(null);
    setBrowserSelectedExperimentIds([]);
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

  const applyReviewState = (state) => {
    const latestChartProposal = latestItem(state?.chartProposalSets);
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
  const stage = (label) => setStaged((s) => s.includes(label) ? s.filter((x) => x !== label) : [...s, label]);
  const openChartReview = (options = "") => {
    const isOptionsObject = options && typeof options === "object" && !("currentTarget" in options);
    setFocusedChartProposalId(typeof options === "string" ? options : (isOptionsObject && typeof options.proposalId === "string" ? options.proposalId : ""));
    setChartReviewStatusFilter(isOptionsObject && options.statusFilter === "active" ? "active" : "");
    setChartReviewOpen(true);
  };
  const closeChartReview = () => {
    setChartReviewOpen(false);
    setFocusedChartProposalId("");
    setChartReviewStatusFilter("");
  };
  const openWorkbookUpload = () => {
    if (!activeProjectId) {
      setSourceError("Select or create a server project before uploading a workbook.");
      return;
    }
    setAgentOpen(true);
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
  const handleWorkbookReviewReadyFromAgent = ({ response, session, sourceDocument, regions = [] } = {}) => {
    const nextSession = session || response?.workbookReviewSession || response?.session || null;
    const nextSourceDocument = sourceDocument || response?.sourceDocument || null;
    const nextDraftRegions = initialWorkbookDraftRegions({
      sourceDocument: nextSourceDocument,
      regions: asArray(regions.length ? regions : response?.regions),
    }, nextSession);
    const nextActiveRegion = nextDraftRegions.at(-1);
    setWorkbookReviewDraftRegions(nextDraftRegions);
    setActiveWorkbookReviewDraftRegionId(
      response?.activeDraftRegionId
      || nextActiveRegion?.draftRegionId
      || nextActiveRegion?.clientRegionId
      || "",
    );
    setWorkbookReviewFocusSelection(null);
    setDataPlanReviewState({ loading: false, error: "", review: null, identityDecisions: [] });
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
    });
    setTab("workbook_review");
    setAgentOpen(false);
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
  const handleWorkbookSuggestionSelect = (selection) => {
    if (!selection?.sourceDocumentId || !selection?.sheetName || !selection?.range) return;
    setWorkbookReviewFocusSelection({
      ...selection,
      requestId: uid(),
      selectionMethod: selection.selectionMethod || "suggestion_click",
    });
    setTab("workbook_review");
    setAgentOpen(false);
  };
  const handleWorkbookReviewRegionActivate = (regionId) => {
    setActiveWorkbookReviewDraftRegionId(regionId);
    const region = findWorkbookDraftRegionById(workbookReviewDraftRegions, regionId);
    if (!region) return;
    setWorkbookReviewFocusSelection({
      ...region,
      requestId: uid(),
      selectionMethod: "red_box_click",
    });
  };
  const submitWorkbookReviewRevision = async ({ message, redBoxUpdates = [], interpretationPatches = [], previousUnderstandingId = null, revisionMode = "merge", activeDraftRegionId = null } = {}) => {
    const session = workbookReviewState.session || workbookReviewState.workbookReviewSession || null;
    if (!session?.id) throw new Error("Start a workbook review session before submitting a revision.");
    setWorkbookReviewState((current) => ({
      ...current,
      revisionLoading: true,
      revisionError: "",
      clarification: null,
    }));
    try {
      const response = await reviseServerWorkbookReviewSession(session.id, {
        message,
        redBoxUpdates,
        previousUnderstandingId,
        revisionMode,
        activeDraftRegionId,
        interpretationPatches,
      });
      const updatedSession = response.workbookReviewSession || response.session || null;
      setWorkbookReviewState((current) => ({
        ...current,
        loading: false,
        revisionLoading: false,
        revisionError: "",
        clarification: response.clarification || null,
        session: updatedSession || current.session,
      }));
      const nextRegions = reconcileWorkbookDraftRegions(workbookReviewDraftRegions, response, updatedSession);
      setWorkbookReviewDraftRegions(nextRegions);
      setActiveWorkbookReviewDraftRegionId((currentId) => {
        const preferredId = response.activeDraftRegionId || activeDraftRegionId || currentId;
        const preferredRegion = findWorkbookDraftRegionById(nextRegions, preferredId);
        const fallbackRegion = nextRegions.at(-1);
        return preferredRegion?.draftRegionId
          || preferredRegion?.clientRegionId
          || fallbackRegion?.draftRegionId
          || fallbackRegion?.clientRegionId
          || "";
      });
      return response;
    } catch (err) {
      const clarification = err.body?.clarification || err.body?.error?.details?.clarification || null;
      setWorkbookReviewState((current) => ({
        ...current,
        revisionLoading: false,
        revisionError: clarification?.message || err.message || String(err),
        clarification,
      }));
      throw err;
    }
  };
  const confirmWorkbookReviewUnderstanding = async ({ workbookUnderstandingId = "", decisionSummary = {} } = {}) => {
    const session = workbookReviewState.session || workbookReviewState.workbookReviewSession || null;
    if (!session?.id) throw new Error("Start a workbook review session before confirming understanding.");
    setWorkbookReviewState((current) => ({
      ...current,
      confirmLoading: true,
      revisionError: "",
      clarification: null,
    }));
    try {
      const response = await confirmServerWorkbookReviewSession(session.id, {
        workbookUnderstandingId,
        decisionSummary,
      });
      const updatedSession = response.workbookReviewSession || response.session || null;
      setWorkbookReviewState((current) => ({
        ...current,
        confirmLoading: false,
        revisionError: "",
        clarification: null,
        session: updatedSession || current.session,
        workbookUnderstanding: response.workbookUnderstanding || current.workbookUnderstanding || null,
        extractionReviewRequested: false,
      }));
      setDataPlanReviewState({ loading: false, error: "", review: null, identityDecisions: [] });
      const state = await getServerProjectState(activeProjectId);
      applyProjectWorkspaceRefresh(state);
      return response;
    } catch (err) {
      setWorkbookReviewState((current) => ({
        ...current,
        confirmLoading: false,
        revisionError: err.message || String(err),
      }));
      throw err;
    }
  };
  const reviewWorkbookExperimentRecords = async (identityDecisions = []) => {
    const session = workbookReviewState.session || workbookReviewState.workbookReviewSession || null;
    const acceptedUnderstanding = workbookReviewState.workbookUnderstanding
      || asArray(projectState?.workbookUnderstandings).find((understanding) => (
        understanding.status === "accepted"
        && (!session?.id || understanding.workbookReviewSessionId === session.id)
      ));
    setWorkbookReviewState((current) => ({ ...current, extractionReviewRequested: true }));
    if (!acceptedUnderstanding?.id) {
      setDataPlanReviewState({
        loading: false,
        error: "The accepted workbook understanding could not be found. Reopen the review and try again.",
        review: null,
        identityDecisions,
      });
      return;
    }
    setDataPlanReviewState((current) => ({ ...current, loading: true, error: "", identityDecisions }));
    try {
      const review = await draftServerProjectDataPlan(activeProjectId, {
        intent: "experiment_browser_publish",
        workbookUnderstandingIds: [acceptedUnderstanding.id],
        identityDecisions,
      });
      setDataPlanReviewState({ loading: false, error: "", review, identityDecisions });
    } catch (error) {
      setDataPlanReviewState((current) => ({
        ...current,
        loading: false,
        error: error?.body?.clarification?.message || error?.message || String(error),
      }));
    }
  };
  const closeExperimentRecordReview = () => {
    setWorkbookReviewState((current) => ({ ...current, extractionReviewRequested: false }));
  };
  const publishWorkbookExperimentRecords = async (request) => {
    const previewKey = String(request.expectedPreviewHash || "").replace(/[^a-zA-Z0-9]/g, "").slice(-20);
    const planKey = String(request.dataPlan?.id || "preview").replace(/[^a-zA-Z0-9._:-]/g, "");
    const response = await publishServerProjectDataPlan(activeProjectId, {
      ...request,
      idempotencyKey: `publish_${planKey}_${previewKey}`,
    });
    const state = await getServerProjectState(activeProjectId);
    applyProjectWorkspaceRefresh(state);
    setBrowserSelectedExperimentIds(asArray(response.experimentIdentities).map((identity) => identity.id).filter(Boolean));
    setTab("browser");
    return response;
  };
  const refreshStaleExperimentRecordReview = (currentReview) => {
    setDataPlanReviewState((current) => ({
      ...current,
      loading: false,
      error: "Source evidence changed after this preview. Review the refreshed values before publishing again.",
      review: currentReview,
    }));
  };
  const focusDataPlanSource = (source) => {
    setWorkbookReviewFocusSelection({
      sourceDocumentId: source.sourceDocumentId,
      sheetName: source.sheetName,
      range: source.range,
      requestId: uid(),
      selectionMethod: "data_plan_source_link",
    });
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
      const intentResult = await interpretProjectChartIntent(activeProjectId, {
        prompt,
        persistAsProposal: true,
        entrypoint: "chart_review",
      });
      const result = intentResult.response || intentResult;
      const normalizedResult = { ...result, chartIntentKind: intentResult.kind, chartIntentEntrypoint: intentResult.entrypoint };
      setBackendChartInterpretState({ loading: false, result: normalizedResult, error: "" });
      if (result.chartProposalSet) {
        const proposalSet = payloadWithServerId(result.chartProposalSet, "proposalSetId");
        setBackendChartProposalState({
          loading: false,
          result: { ...result, chartProposalSet: result.chartProposalSet, proposalSet },
          error: "",
        });
        setProjectState((current) => current ? {
          ...current,
          chartProposalSets: upsertServerRecordById(current.chartProposalSets, result.chartProposalSet),
        } : current);
        setDirty(true);
      }
      if (result.sourceExtractProposal) {
        setProjectState((current) => current ? {
          ...current,
          sourceExtractProposals: upsertServerRecordById(current.sourceExtractProposals, result.sourceExtractProposal),
        } : current);
        setDirty(true);
      }
    } catch (err) {
      setBackendChartInterpretState({ loading: false, result: null, error: err.message || String(err) });
    }
  };
  const updateSourceExtractProposalInState = (sourceExtractProposal) => {
    if (!sourceExtractProposal?.id) return;
    setBackendChartInterpretState((current) => current.result?.sourceExtractProposal?.id === sourceExtractProposal.id ? ({
      ...current,
      result: {
        ...current.result,
        sourceExtractProposal,
      },
    }) : current);
    setProjectState((current) => current ? {
      ...current,
      sourceExtractProposals: upsertServerRecordById(current.sourceExtractProposals, sourceExtractProposal),
    } : current);
  };
  const setSourceExtractProposalDecision = async (proposalId, status) => {
    if (!proposalId || !activeProjectId) return;
    const busy = status === "accepted" ? "accepting_source_extract" : "rejecting_source_extract";
    setBackendChartInterpretState((current) => ({ ...current, sourceExtractBusy: busy, error: "" }));
    try {
      const response = await patchServerSourceExtractProposal(proposalId, {
        status,
        decisionSummary: {
          acceptedByUser: status === "accepted",
          rejectedByUser: status === "rejected",
        },
      });
      updateSourceExtractProposalInState(response.sourceExtractProposal);
      setDirty(true);
    } catch (err) {
      setBackendChartInterpretState((current) => ({ ...current, error: err.message || String(err) }));
    } finally {
      setBackendChartInterpretState((current) => ({ ...current, sourceExtractBusy: "" }));
    }
  };
  const createChartProposalFromSourceExtract = async (proposalId) => {
    if (!proposalId || !activeProjectId) return;
    setBackendChartInterpretState((current) => ({ ...current, sourceExtractBusy: "creating_source_chart_proposal", error: "" }));
    try {
      const response = await createServerSourceExtractChartProposal(proposalId);
      if (response.sourceExtractProposal) updateSourceExtractProposalInState(response.sourceExtractProposal);
      const chartProposalSet = response.chartProposalSet || null;
      if (chartProposalSet) {
        const proposalSet = payloadWithServerId(chartProposalSet, "proposalSetId");
        setBackendChartProposalState({
          loading: false,
          result: { ...response, chartProposalSet, proposalSet },
          error: "",
        });
        setProjectState((current) => current ? {
          ...current,
          chartProposalSets: upsertServerRecordById(current.chartProposalSets, chartProposalSet),
        } : current);
      }
      setDirty(true);
    } catch (err) {
      setBackendChartInterpretState((current) => ({ ...current, error: err.message || String(err) }));
    } finally {
      setBackendChartInterpretState((current) => ({ ...current, sourceExtractBusy: "" }));
    }
  };
  const reviewSourceExtractProposal = (proposal) => {
    const proposalId = typeof proposal === "string" ? proposal : proposal?.id;
    const fullProposal = asArray(projectState?.sourceExtractProposals).find((item) => item.id === proposalId) || (typeof proposal === "object" ? proposal : null);
    if (!fullProposal?.id) return;
    setBackendChartInterpretState({
      loading: false,
      sourceExtractBusy: "",
      result: {
        schemaVersion: "labrat.chartInterpretResponse.v1",
        chartSpecDraft: null,
        chartProposalSet: null,
        sourceExtractProposal: fullProposal,
        warnings: fullProposal.warnings || [],
      },
      error: "",
    });
    setFocusedChartProposalId("");
    setChartReviewStatusFilter("");
    setChartReviewOpen(true);
  };
  const setBackendChartProposalDecision = async (proposalId, status) => {
    const proposalSet = backendChartProposalState.result?.proposalSet;
    if (!proposalSet) return;
    const nextProposalSet = setChartProposalStatus(proposalSet, proposalId, status);
    setBackendChartProposalState((current) => current.result ? ({
      ...current,
      result: { ...current.result, proposalSet: nextProposalSet },
    }) : current);
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
  const deleteBackendChartProposal = async (proposalId) => {
    const proposalSet = backendChartProposalState.result?.proposalSet;
    if (!proposalSet || !proposalId) return;
    const nextProposalSet = removeChartProposal(proposalSet, proposalId);
    setBackendChartProposalState((current) => current.result ? ({
      ...current,
      result: { ...current.result, proposalSet: nextProposalSet },
    }) : current);
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
  const createChartSpecFromProposal = async (chartProposalSetId, proposalId) => {
    if (!activeProjectId || !chartProposalSetId || !proposalId) return;
    setBackendChartProposalState((current) => ({ ...current, error: "" }));
    try {
      await createServerChartSpecFromProposal(activeProjectId, {
        chartProposalSetId,
        proposalId,
      });
      const state = await getServerProjectState(activeProjectId);
      applyProjectWorkspaceRefresh(state);
    } catch (err) {
      setBackendChartProposalState((current) => ({ ...current, error: err.message || String(err) }));
    }
  };
  const openAnalysisReview = ({ thread, revision }) => {
    if (!thread?.id || !revision?.id) return;
    setAnalysisReviewState({ thread, revision });
    setAgentOpen(false);
  };
  const closeAnalysisReview = () => {
    setAnalysisReviewState(null);
  };
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
        onGoBrowser={() => setTab("browser")}
        onOpenChartReview={openChartReview}
        onGoManuscript={() => setTab("manuscript")}
      />}
      {tab === "browser" && <ExperimentBrowser
        projectId={activeProjectId}
        initialSelectedExperimentIds={browserSelectedExperimentIds}
        onSelectionChange={setBrowserSelectedExperimentIds}
        onOpenImportReview={openWorkbookUpload}
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
          focusSelection={workbookReviewFocusSelection}
          reviewDock={(
            workbookReviewState.extractionReviewRequested ? (
              <DataPlanReviewPanel
                review={dataPlanReviewState.review}
                loading={dataPlanReviewState.loading}
                error={dataPlanReviewState.error}
                onApplyIdentityDecisions={reviewWorkbookExperimentRecords}
                onOpenSource={focusDataPlanSource}
                onBack={closeExperimentRecordReview}
                onPublish={publishWorkbookExperimentRecords}
                onPreviewStale={refreshStaleExperimentRecordReview}
              />
            ) : (
              <WorkbookReviewDock
                reviewState={workbookReviewState}
                draftRegions={workbookReviewDraftRegions}
                activeDraftRegionId={activeWorkbookReviewDraftRegionId}
                onActiveDraftRegionChange={handleWorkbookReviewRegionActivate}
                onSubmitRevision={submitWorkbookReviewRevision}
                onConfirmUnderstanding={confirmWorkbookReviewUnderstanding}
                onReviewExtractedExperiments={() => reviewWorkbookExperimentRecords([])}
              />
            )
          )}
        />
      )}
      {tab === "manuscript" && <ManuscriptCanvas blocks={blocks} setBlocks={setBlocks} staged={staged} setStaged={setStaged} references={references} chartTemplates={chartTemplates} setChartTemplates={setChartTemplates} chartSpecs={activeChartSpecsForProject(projectState)} pages={pages} setPages={setPages} canvasHeight={canvasHeight} setCanvasHeight={setCanvasHeight} pageOrientationPreference={pageOrientationPreference} setPageOrientationPreference={setPageOrientationPreference} chartSpecInsertRequest={chartSpecInsertRequest} onChartSpecInsertRequestHandled={clearChartSpecManuscriptInsertRequest} onSelectedChartContextChange={setSelectedChartContext} onRequestChartAnalysis={requestChartAnalysis} onSaveProject={save} />}
      {tab === "reference" && <ReferenceLibrary references={references} setReferences={setReferences} />}
      {analysisReviewState?.thread?.id && (
        <AnalysisReviewWorkspace
          projectId={activeProjectId}
          thread={analysisReviewState.thread}
          revision={analysisReviewState.revision}
          WorkbookWorkspaceComponent={WorkbookReviewWorkspace}
          onClose={closeAnalysisReview}
          onAccepted={() => {
            getServerProjectState(activeProjectId)
              .then(applyProjectWorkspaceRefresh)
              .catch((error) => setSourceError(error?.message || String(error)));
          }}
        />
      )}
      <DetailModal exp={selected} onClose={() => setSelected(null)} onStage={stage} />
      <ChartReviewModal
        open={chartReviewOpen}
        allowSourcePrompt={Boolean(activeProjectId)}
        chartProposalState={backendChartProposalState}
        chartInterpretState={backendChartInterpretState}
        chartSpecs={activeChartSpecsForProject(projectState)}
        focusProposalId={focusedChartProposalId}
        statusFilter={chartReviewStatusFilter}
        onChartProposalDecision={setBackendChartProposalDecision}
        onChartProposalDelete={deleteBackendChartProposal}
        onInterpretChart={interpretBackendChart}
        onSourceExtractDecision={setSourceExtractProposalDecision}
        onCreateChartProposalFromSourceExtract={createChartProposalFromSourceExtract}
        onCreateChartSpec={createChartSpecFromProposal}
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
        onInsertChartSpec={requestChartSpecManuscriptInsert}
        onReviewSourceExtract={reviewSourceExtractProposal}
        onWorkbookReviewReady={handleWorkbookReviewReadyFromAgent}
        onWorkbookSuggestionSelect={handleWorkbookSuggestionSelect}
        onOpenExperimentBrowser={() => setTab("browser")}
        onOpenAnalysisReview={openAnalysisReview}
      />
    </>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

