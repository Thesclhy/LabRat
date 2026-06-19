import { encodeRange } from "../import/utils/excelAddress.js";
import { chartProposalFromAnalysisView, resolveSeriesCompareAnalysisView } from "./analysisViews.js";
import { createProjectAgentPlan } from "./projectAgentPlanner.js";
import { buildSourceExtractPreview, sourceExtractProposalSummary } from "./sourceExtracts.js";
import { sha256Hex } from "./ids.js";

export const AGENT_RUN_SCHEMA_VERSION = "labrat.agentRun.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function experimentAliases(message) {
  const aliases = [];
  const re = /\bexp(?:eriment)?\s*0*([0-9]+)\b/gi;
  let match = re.exec(String(message || ""));
  while (match) {
    aliases.push(`Exp${Number(match[1])}`);
    match = re.exec(String(message || ""));
  }
  return [...new Set(aliases)];
}

function rowNumberFromMessage(message) {
  const match = String(message || "").match(/\brow\s*([0-9]+)\b/i);
  return match ? Number(match[1]) : null;
}

function isSourceDistributionRequest(message) {
  const text = normalizeLower(message);
  return /\b(overall\s*tots?|overall\s*total|carbon\s*number|c[-\s]?number|distribution)\b/.test(text)
    && /\b(use|plot|chart|source|workbook|excel|row)\b/.test(text);
}

function visibleStep(label, details = {}) {
  return {
    stepId: `agent_step_${sha256Hex(`${label}:${JSON.stringify(details)}`).slice(0, 12)}`,
    label,
    details,
    createdAt: new Date().toISOString(),
  };
}

function action({ type, label, description, params = {}, requiresReview = true }) {
  return {
    actionId: `agent_run_action_${sha256Hex(`${type}:${label}:${JSON.stringify(params)}`).slice(0, 16)}`,
    type,
    status: "requires_confirmation",
    label,
    description,
    requiresReview,
    params,
    warnings: [],
  };
}

function deterministicUsage() {
  return {
    provider: "deterministic",
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
}

export function agentRunSummary(run) {
  return {
    id: run.id,
    labId: run.labId,
    projectId: run.projectId,
    schemaVersion: run.schemaVersion || AGENT_RUN_SCHEMA_VERSION,
    status: run.status,
    mode: run.mode || null,
    userMessage: run.userMessage || "",
    selectedContext: run.selectedContext || {},
    visibleSteps: run.visibleSteps || [],
    toolTrace: run.toolTrace || [],
    analysisViewId: run.analysisViewId || null,
    proposalRefs: run.proposalRefs || [],
    actions: run.actions || [],
    usage: run.usage || {},
    warnings: run.warnings || [],
    error: run.error || null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    createdBy: run.createdBy,
    updatedBy: run.updatedBy,
  };
}

function compareActionFromPlan({ project, plan, message }) {
  const planned = asArray(plan.actions).find((item) => item.type === "compare_series");
  if (!planned) return null;
  return action({
    type: "create_compare_chart_proposal",
    label: "Create compare AnalysisView and chart proposal",
    description: "Create a series_compare AnalysisView and queue one chart proposal for review.",
    params: {
      projectId: project.id,
      prompt: message,
      ...planned.params,
    },
  });
}

async function sourceDistributionAction({ context, project, message }) {
  if (!isSourceDistributionRequest(message)) return null;
  const sourceDocuments = context.store.listSourceDocuments
    ? await context.store.listSourceDocuments({ projectId: project.id })
    : [];
  const aliases = experimentAliases(message);
  const rowNumber = rowNumberFromMessage(message);
  const candidateDocuments = sourceDocuments
    .map((document) => {
      const haystack = normalizeLower([
        document.metadata?.workbookName,
        document.metadata?.fileName,
        ...asArray(document.metadata?.sheetNames),
      ].join(" "));
      const aliasScore = aliases.some((alias) => haystack.includes(normalizeLower(alias))) ? 2 : 0;
      const sourceScore = /calculation|source|gc|distribution/.test(haystack) ? 1 : 0;
      return { document, score: aliasScore + sourceScore };
    })
    .filter((item) => item.score > 0 || !aliases.length)
    .sort((a, b) => b.score - a.score);
  if (!candidateDocuments.length) {
    return {
      clarification: {
        code: "source_document_not_found",
        message: aliases.length
          ? `No indexed source workbook matched ${aliases.join(", ")}.`
          : "No indexed source workbook matched the source distribution request.",
      },
      visibleSteps: [
        visibleStep("Searched indexed source documents", { sourceDocumentCount: sourceDocuments.length, aliases }),
      ],
    };
  }
  const sourceDocument = candidateDocuments[0].document;
  const regions = context.store.listSourceRegions
    ? await context.store.listSourceRegions({ sourceDocumentId: sourceDocument.id })
    : [];
  const candidateRegions = regions.filter((region) => region.rangeRef);
  if (!candidateRegions.length) {
    return {
      clarification: {
        code: "source_region_not_found",
        message: "The matched source workbook has no indexed range regions.",
      },
      visibleSteps: [
        visibleStep("Found indexed source document", { sourceDocumentId: sourceDocument.id, workbookName: sourceDocument.metadata?.workbookName }),
      ],
    };
  }
  const rowIndex = Number.isInteger(rowNumber) ? rowNumber - 1 : null;
  const sourceRegion = candidateRegions.find((region) => (
    rowIndex == null
    || (
      Number.isInteger(region.startRow)
      && Number.isInteger(region.endRow)
      && region.startRow <= rowIndex
      && region.endRow >= rowIndex
    )
  )) || candidateRegions[0];
  let range = sourceRegion.rangeRef;
  if (rowIndex != null && Number.isInteger(sourceRegion.startCol) && Number.isInteger(sourceRegion.endCol)) {
    const headerRow = Math.max(sourceRegion.startRow ?? 0, rowIndex - 1);
    range = encodeRange({
      s: { r: headerRow, c: sourceRegion.startCol },
      e: { r: rowIndex, c: sourceRegion.endCol },
    });
  }
  const indexBlobs = context.store.listSourceIndexBlobs
    ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
    : [];
  const preview = buildSourceExtractPreview({
    sourceDocument,
    sourceRegion,
    indexBlobs,
    body: {
      extractType: "component_distribution",
      sheetName: sourceRegion.sheetName,
      range,
      intent: {
        title: aliases.length ? `${aliases[0]} Overall tots` : "Overall tots",
        chartTitle: aliases.length ? `${aliases[0]} carbon number distribution` : "Carbon number distribution",
        purpose: "chart_source",
      },
    },
  });
  if (preview.extractType !== "component_distribution" || !asArray(preview.rows).length) {
    return {
      clarification: {
        code: "source_extract_unresolved",
        message: "The matched source range did not validate as a C-number/component distribution.",
      },
      visibleSteps: [
        visibleStep("Read bounded source range", { sourceDocumentId: sourceDocument.id, sourceRegionId: sourceRegion.id, range }),
      ],
    };
  }
  return {
    action: action({
      type: "create_source_extract_proposal",
      label: "Create source extract proposal",
      description: "Create a reviewable source extract proposal from the matched source range.",
      params: {
        projectId: project.id,
        sourceDocumentId: sourceDocument.id,
        sourceRegionId: sourceRegion.id,
        sheetName: sourceRegion.sheetName,
        range,
        extractType: "component_distribution",
        purpose: "chart_source",
        intent: {
          title: preview.title,
          chartTitle: preview.chartIntentDraft?.title || preview.title,
        },
      },
    }),
    visibleSteps: [
      visibleStep("Searched indexed source documents", { sourceDocumentCount: sourceDocuments.length, aliases }),
      visibleStep("Found indexed source document", { sourceDocumentId: sourceDocument.id, workbookName: sourceDocument.metadata?.workbookName }),
      visibleStep("Read bounded source range", { sheetName: sourceRegion.sheetName, range }),
      visibleStep("Validated source extract preview", { extractType: preview.extractType, rowCount: preview.rows.length }),
    ],
    toolTrace: [{
      tool: "source.extract.preview",
      observation: {
        sourceDocumentId: sourceDocument.id,
        sourceRegionId: sourceRegion.id,
        range,
        extractType: preview.extractType,
        rowCount: preview.rows.length,
      },
    }],
  };
}

export async function buildAgentRunDraft({
  context,
  project,
  projectProfile = {},
  currentDatasetCommit = null,
  observationSeries = [],
  fileObjects = [],
  importRuns = [],
  mappingSets = [],
  chartProposalSets = [],
  chartSpecs = [],
  manuscripts = [],
  message = "",
  conversation = [],
  selectedContext = {},
} = {}) {
  const text = normalizeText(message);
  const warnings = [];
  const sourceAction = await sourceDistributionAction({ context, project, message: text });
  if (sourceAction?.action || sourceAction?.clarification) {
    const actions = sourceAction.action ? [sourceAction.action] : [];
    return {
      mode: "source_extract",
      status: "waiting_for_user",
      visibleSteps: sourceAction.visibleSteps || [],
      toolTrace: sourceAction.toolTrace || [],
      actions,
      usage: deterministicUsage(),
      warnings: sourceAction.clarification ? [{
        code: sourceAction.clarification.code,
        message: sourceAction.clarification.message,
        severity: "info",
      }] : warnings,
    };
  }

  const plan = createProjectAgentPlan({
    project,
    projectProfile,
    currentDatasetCommit,
    observationSeries,
    fileObjects,
    importRuns,
    mappingSets,
    chartProposalSets,
    chartSpecs,
    manuscripts,
    message: text,
    conversation,
    selectedContext,
  });
  const compareAction = compareActionFromPlan({ project, plan, message: text });
  if (compareAction) {
    return {
      mode: "series_compare",
      status: "waiting_for_user",
      visibleSteps: [
        visibleStep("Checked current dataset", { currentDatasetCommitId: currentDatasetCommit?.id || null }),
        visibleStep("Resolved compatible observation series", {
          seriesIds: asArray(compareAction.params.seriesIds),
          experimentLabels: asArray(compareAction.params.experimentLabels),
          xField: compareAction.params.xField,
          yField: compareAction.params.yField,
        }),
        visibleStep("Prepared confirmable compare action", { actionType: compareAction.type }),
      ],
      toolTrace: [{
        tool: "observationSeries.resolveCompare",
        observation: {
          seriesIds: asArray(compareAction.params.seriesIds),
          experimentIds: asArray(compareAction.params.experimentIds),
          xField: compareAction.params.xField,
          yField: compareAction.params.yField,
        },
      }],
      actions: [compareAction],
      usage: deterministicUsage(),
      warnings: asArray(plan.warnings),
    };
  }
  return {
    mode: "action_plan",
    status: "waiting_for_user",
    visibleSteps: [visibleStep("Created compatibility action plan", { actionCount: asArray(plan.actions).length })],
    toolTrace: [],
    actions: asArray(plan.actions),
    usage: deterministicUsage(),
    warnings: asArray(plan.warnings),
  };
}

export async function executeAgentRunAction({ context, run, action, actorUserId }) {
  if (action.type === "create_compare_chart_proposal") {
    const project = await context.store.findProjectById(run.projectId);
    const currentDatasetCommit = project?.currentDatasetCommitId
      ? await context.store.findDatasetCommitById(project.currentDatasetCommitId)
      : null;
    const observationSeries = context.store.listObservationSeries
      ? await context.store.listObservationSeries({ projectId: run.projectId })
      : [];
    const resolved = resolveSeriesCompareAnalysisView({
      project,
      datasetCommit: currentDatasetCommit,
      observationSeries,
      request: {
        viewType: "series_compare",
        title: action.params.title || "Reaction rate comparison",
        prompt: run.userMessage,
        spec: {
          seriesKind: action.params.seriesKind || "reaction_rate_time_series",
          experimentIds: asArray(action.params.experimentIds),
          experimentAliases: asArray(action.params.experimentAliases),
          xField: action.params.xField,
          yField: action.params.yField,
          groupBy: action.params.groupBy || "experiment",
        },
      },
    });
    if (resolved.error || resolved.clarification) {
      const error = new Error(resolved.error?.message || resolved.clarification?.message || "Compare action could not be resolved.");
      error.statusCode = 409;
      error.code = resolved.error?.code || resolved.clarification?.code || "agent_run_action_unresolved";
      throw error;
    }
    const draft = resolved.analysisView;
    const analysisView = await context.store.createAnalysisView({
      labId: run.labId,
      projectId: run.projectId,
      datasetCommitId: currentDatasetCommit.id,
      schemaVersion: draft.schemaVersion,
      viewType: draft.viewType,
      status: draft.status || "draft",
      title: draft.title,
      spec: draft.spec,
      sourceRefs: draft.sourceRefs,
      warnings: draft.warnings,
      createdBy: actorUserId,
    });
    const proposal = chartProposalFromAnalysisView({
      analysisView,
      datasetCommit: currentDatasetCommit,
      observationSeries,
    });
    const chartProposalSet = await context.store.createChartProposalSet({
      labId: run.labId,
      projectId: run.projectId,
      datasetCommitId: analysisView.datasetCommitId,
      mappingSetId: null,
      schemaVersion: "labrat.chartProposalSet.v1",
      status: "proposed",
      payload: {
        proposalSetId: `chart_proposal_set_agent_run_${sha256Hex(run.id).slice(0, 16)}`,
        schemaVersion: "labrat.chartProposalSet.v1",
        sourceImportIds: proposal.sourceImportIds || [],
        proposals: [proposal],
        warnings: proposal.warnings || [],
        origin: "agent_run",
        agentRunId: run.id,
        analysisViewId: analysisView.id,
      },
      decisionSummary: { accepted: 0, rejected: 0, proposalCount: 1 },
      createdBy: actorUserId,
    });
    return {
      analysisView,
      chartProposalSet,
      visibleSteps: [
        visibleStep("Created AnalysisView", { analysisViewId: analysisView.id }),
        visibleStep("Queued chart proposal for review", { chartProposalSetId: chartProposalSet.id }),
      ],
      proposalRefs: [{ type: "chart_proposal_set", id: chartProposalSet.id }],
      analysisViewId: analysisView.id,
    };
  }

  if (action.type === "create_source_extract_proposal") {
    const project = await context.store.findProjectById(run.projectId);
    const sourceDocument = await context.store.findSourceDocumentById?.(action.params.sourceDocumentId);
    const sourceRegion = action.params.sourceRegionId
      ? await context.store.findSourceRegionById?.(action.params.sourceRegionId)
      : null;
    if (!sourceDocument || sourceDocument.projectId !== run.projectId || (sourceRegion && sourceRegion.projectId !== run.projectId)) {
      const error = new Error("Source evidence for this AgentRun action is no longer available.");
      error.statusCode = 404;
      error.code = "agent_run_source_not_found";
      throw error;
    }
    const indexBlobs = context.store.listSourceIndexBlobs
      ? await context.store.listSourceIndexBlobs({ sourceDocumentId: sourceDocument.id })
      : [];
    const preview = buildSourceExtractPreview({
      sourceDocument,
      sourceRegion,
      indexBlobs,
      body: {
        sheetName: action.params.sheetName,
        range: action.params.range,
        extractType: action.params.extractType,
        intent: action.params.intent || {},
      },
    });
    const sourceExtractProposal = await context.store.createSourceExtractProposal({
      labId: run.labId,
      projectId: run.projectId,
      sourceDocumentId: sourceDocument.id,
      sourceRegionId: sourceRegion?.id || null,
      datasetCommitId: null,
      status: "proposed",
      purpose: action.params.purpose || preview.purpose || "chart_source",
      extractType: action.params.extractType || preview.extractType,
      intent: action.params.intent || {},
      preview,
      warnings: preview.warnings || [],
      decisionSummary: {},
      createdBy: actorUserId,
    });
    return {
      sourceExtractProposal,
      visibleSteps: [
        visibleStep("Created source extract proposal", { sourceExtractProposalId: sourceExtractProposal.id }),
      ],
      proposalRefs: [{ type: "source_extract_proposal", id: sourceExtractProposal.id }],
    };
  }

  const error = new Error(`Unsupported AgentRun action ${action.type}.`);
  error.statusCode = 400;
  error.code = "unsupported_agent_run_action";
  throw error;
}

export function markActionCompleted(actions, actionId, result = {}) {
  return asArray(actions).map((candidate) => (
    candidate.actionId === actionId
      ? { ...candidate, status: "completed", result }
      : candidate
  ));
}
