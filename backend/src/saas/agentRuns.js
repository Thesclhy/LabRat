import { encodeRange } from "../import/utils/excelAddress.js";
import { parseChartEvidenceIntent } from "../charts/services/chartEvidenceIntent.js";
import { createSourceExtractProposalFromEvidence, resolveChartEvidenceIntent } from "./chartEvidenceResolver.js";
import { createProjectAgentPlan } from "./projectAgentPlanner.js";
import { buildSourceExtractPreview } from "./sourceExtracts.js";
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

function previewStats(preview) {
  const series = asArray(preview?.series);
  if (series.length) {
    return {
      extractType: preview.extractType || null,
      seriesCount: series.length,
      rowCount: series.reduce((total, item) => total + asArray(item.rows).length, 0),
    };
  }
  return {
    extractType: preview?.extractType || null,
    rowCount: asArray(preview?.rows).length,
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

async function sourceDistributionAction({ context, project, message }) {
  if (!isSourceDistributionRequest(message)) return null;
  const evidenceIntent = parseChartEvidenceIntent(message);
  if (evidenceIntent) {
    const resolved = await resolveChartEvidenceIntent({ context, project, evidenceIntent });
    const parsedDetails = {
      range: evidenceIntent.range || null,
      rowNumber: evidenceIntent.rowNumber || null,
      sheetName: evidenceIntent.sheetName || null,
      workbookHint: evidenceIntent.workbookHint || null,
      targetExperimentAliases: asArray(evidenceIntent.targetExperimentAliases),
      chartTask: evidenceIntent.chartTask || null,
      scope: evidenceIntent.scope || null,
    };
    if (resolved.clarification || !resolved.sourceExtractPreview) {
      return {
        clarification: resolved.clarification || {
          code: "source_extract_unresolved",
          message: "The requested source evidence could not be resolved.",
        },
        visibleSteps: [
          visibleStep("Parsed source evidence", parsedDetails),
          visibleStep("Resolved source evidence", {
            status: resolved.evidenceResolution?.status || "needs_clarification",
            range: resolved.evidenceResolution?.range || evidenceIntent.range || null,
            sheetName: resolved.evidenceResolution?.sheetName || null,
            clarificationCode: resolved.clarification?.code || null,
          }),
        ],
        toolTrace: [{
          tool: "source.evidence.resolve",
          observation: {
            status: resolved.evidenceResolution?.status || "needs_clarification",
            clarificationCode: resolved.clarification?.code || null,
            evidenceIntent: parsedDetails,
          },
        }],
      };
    }
    const preview = resolved.sourceExtractPreview;
    const resolution = resolved.evidenceResolution || {};
    const sourceDocumentId = resolved.sourceDocument?.id
      || resolution.sourceDocumentId
      || preview.range?.sourceDocumentId
      || null;
    const sourceRegionId = resolved.sourceRegion?.id
      || resolution.sourceRegionId
      || preview.range?.sourceRegionId
      || null;
    const range = resolution.range || preview.range?.range || evidenceIntent.range || "";
    const sheetName = resolution.sheetName || preview.range?.sheetName || evidenceIntent.sheetName || "";
    return {
      action: action({
        type: "create_source_extract_proposal",
        label: "Create source extract proposal",
        description: "Create a reviewable source extract proposal from the matched source evidence.",
        params: {
          projectId: project.id,
          evidenceIntent,
          evidenceResolution: resolution,
          sourceDocumentId,
          sourceRegionId,
          sheetName,
          range,
          extractType: preview.extractType || evidenceIntent.extractType,
          purpose: preview.purpose || "chart_source",
          intent: {
            title: preview.title,
            chartTitle: preview.chartIntentDraft?.title || preview.title,
            evidenceIntent,
          },
        },
      }),
      visibleSteps: [
        visibleStep("Parsed source evidence", parsedDetails),
        visibleStep("Resolved source evidence", {
          status: resolution.status || "resolved",
          mode: resolution.mode || null,
          sourceDocumentId,
          sourceRegionId,
          sheetName,
          range,
          series: asArray(resolution.series).map((item) => ({
            experimentAlias: item.experimentAlias,
            sheetName: item.sheetName,
            range: item.range,
          })),
        }),
        visibleStep("Validated source extract preview", previewStats(preview)),
      ],
      toolTrace: [{
        tool: "source.evidence.resolve",
        observation: {
          status: resolution.status || "resolved",
          sourceDocumentId,
          sourceRegionId,
          sheetName,
          range,
          ...previewStats(preview),
        },
      }],
    };
  }
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
  fileObjects = [],
  chartProposalSets = [],
  chartSpecs = [],
  manuscripts = [],
  experimentSnapshotHeads = [],
  sourceDocuments = [],
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
    fileObjects,
    chartProposalSets,
    chartSpecs,
    manuscripts,
    experimentSnapshotHeads,
    sourceDocuments,
    message: text,
    conversation,
    selectedContext,
  });
  return {
    mode: "action_plan",
    status: "waiting_for_user",
    visibleSteps: [visibleStep("Created project action plan", { actionCount: asArray(plan.actions).length })],
    toolTrace: [],
    actions: asArray(plan.actions),
    usage: deterministicUsage(),
    warnings: asArray(plan.warnings),
  };
}

export async function executeAgentRunAction({ context, run, action, actorUserId }) {
  if (action.type === "create_source_extract_proposal") {
    const project = await context.store.findProjectById(run.projectId);
    if (action.params.evidenceIntent) {
      const resolved = await resolveChartEvidenceIntent({
        context,
        project,
        evidenceIntent: action.params.evidenceIntent,
      });
      if (resolved.clarification || !resolved.sourceExtractPreview) {
        const error = new Error(resolved.clarification?.message || "Source evidence for this AgentRun action could not be resolved.");
        error.statusCode = 409;
        error.code = resolved.clarification?.code || "agent_run_source_unresolved";
        throw error;
      }
      const sourceExtractProposal = await createSourceExtractProposalFromEvidence({
        context,
        project,
        sourceDocument: resolved.sourceDocument,
        sourceRegion: resolved.sourceRegion,
        sourceExtractPreview: resolved.sourceExtractPreview,
        evidenceIntent: action.params.evidenceIntent,
        createdBy: actorUserId,
        recordAudit: false,
      });
      return {
        sourceExtractProposal,
        visibleSteps: [
          visibleStep("Created source extract proposal", {
            sourceExtractProposalId: sourceExtractProposal.id,
            extractType: sourceExtractProposal.extractType,
          }),
        ],
        proposalRefs: [{ type: "source_extract_proposal", id: sourceExtractProposal.id }],
      };
    }
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
