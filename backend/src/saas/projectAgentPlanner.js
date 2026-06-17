import { createHash } from "node:crypto";
import { buildProjectDataCatalog, searchProjectDataCatalog, slug } from "./projectDataCatalog.js";

export const PROJECT_AGENT_PLAN_VERSION = "labrat.agentPlan.v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function idFor(projectId, type, message) {
  return `agent_action_${createHash("sha256").update(`${projectId}:${type}:${message}`).digest("hex").slice(0, 16)}`;
}

function experimentAliases(message) {
  const aliases = [];
  const text = String(message || "");
  const re = /\bexp(?:eriment)?\s*0*([0-9]+)\b/gi;
  let match = re.exec(text);
  while (match) {
    aliases.push(`Exp${Number(match[1])}`);
    match = re.exec(text);
  }
  return [...new Set(aliases)];
}

function latestAcceptedProposal(chartProposalSets = []) {
  const sets = asArray(chartProposalSets).slice().reverse();
  for (const set of sets) {
    const proposal = asArray(set?.payload?.proposals).find((candidate) => candidate?.status === "accepted");
    if (proposal) {
      return {
        chartProposalSetId: set.id,
        proposalId: proposal.proposalId,
        title: proposal.title || proposal.proposalId,
        chartType: proposal.chartType || "chart",
      };
    }
  }
  return null;
}

function compactExistingFiles(fileObjects = []) {
  return asArray(fileObjects).slice(-8).map((file) => ({
    fileObjectId: file.id,
    name: file.originalName,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
  }));
}

function action({ projectId, message, type, label, description, params = {}, requiresFile = false, requiresReview = true, warnings = [] }) {
  return {
    actionId: idFor(projectId, type, `${message}:${label}`),
    type,
    status: "requires_confirmation",
    label,
    description,
    requiresFile,
    requiresReview,
    params,
    warnings,
  };
}

function chartPrompt(message) {
  return String(message || "").replace(/\b(create|make|draft|plot|show|generate|please)\b/gi, " ").replace(/\s+/g, " ").trim() || String(message || "");
}

function dataQueryAction(projectId, message) {
  return action({
    projectId,
    message,
    type: "resolve_data_query",
    label: "Resolve project data query",
    description: "Find matching project data and produce a reviewable table/view intent.",
    requiresFile: false,
    requiresReview: false,
    params: { prompt: message },
  });
}

export function createProjectAgentPlan({
  project,
  projectProfile = {},
  currentDatasetCommit = null,
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
  const projectId = project?.id || "project";
  const text = String(message || "").trim();
  const normalized = slug(text);
  const hasDataset = !!currentDatasetCommit?.id;
  const catalog = buildProjectDataCatalog({
    project,
    datasetCommit: currentDatasetCommit,
    mappingSets,
    chartSpecs,
  });
  const targetExperimentAliases = experimentAliases(text);
  const actions = [];

  if (/\b(master|mastertable|main table|main workbook|主表)\b/.test(normalized)
    && /\b(upload|import|add|导入|上传)\b/.test(normalized)) {
    actions.push(action({
      projectId,
      message: text,
      type: "upload_master_table",
      label: "Upload master table",
      description: "Upload one project master workbook, scan it, preview normalization, then confirm dataset apply.",
      requiresFile: true,
      params: {
        existingFiles: compactExistingFiles(fileObjects),
      },
      warnings: hasDataset ? [{
        code: "master_dataset_exists",
        message: "This project already has a dataset commit; master upload may need refresh instead of append.",
        severity: "warning",
      }] : [],
    }));
  } else if (/\b(refresh|replace|update|correct|更新|替换|刷新)\b/.test(normalized)
    && /\b(master|mastertable|workbook|table|主表)\b/.test(normalized)) {
    actions.push(action({
      projectId,
      message: text,
      type: "refresh_master_table",
      label: "Refresh master table",
      description: "Upload a replacement workbook and confirm the refresh diff before replacing the active master import.",
      requiresFile: true,
      params: {
        expectedParentDatasetCommitId: currentDatasetCommit?.id || null,
        existingFiles: compactExistingFiles(fileObjects),
      },
      warnings: !hasDataset ? [{
        code: "dataset_commit_required",
        message: "Refresh requires an existing committed master dataset.",
        severity: "warning",
      }] : [],
    }));
  } else if (/\b(supplement|supplemental|extra|detail|attach|reaction rate|rate|gc|distribution|补充|额外|关联)\b/.test(normalized)
    && /\b(upload|import|add|attach|上传|导入|添加|关联)\b/.test(normalized)) {
    actions.push(action({
      projectId,
      message: text,
      type: "upload_supplement",
      label: "Add supplemental workbook",
      description: "Upload an extra workbook, preview parsed data, then confirm the relationship to existing experiments.",
      requiresFile: true,
      params: {
        targetExperimentAliases,
        existingFiles: compactExistingFiles(fileObjects),
      },
      warnings: !hasDataset ? [{
        code: "dataset_commit_required",
        message: "Supplemental uploads require an existing master dataset.",
        severity: "warning",
      }] : [],
    }));
  } else if (/\b(create|save|make)\b/.test(normalized) && /\b(chart spec|chartspec|chart specification)\b/.test(normalized)) {
    const accepted = latestAcceptedProposal(chartProposalSets);
    actions.push(action({
      projectId,
      message: text,
      type: "create_chart_spec_from_proposal",
      label: "Create chart spec from accepted proposal",
      description: accepted ? `Create a durable ChartSpec from ${accepted.title}.` : "No accepted chart proposal was found.",
      requiresFile: false,
      params: accepted || {},
      warnings: accepted ? [] : [{
        code: "accepted_chart_proposal_required",
        message: "Accept a chart proposal before creating a durable ChartSpec.",
        severity: "warning",
      }],
    }));
  } else if (/\b(propose|recommend|suggest|推荐)\b/.test(normalized) && /\b(chart|plot|figure|图)\b/.test(normalized)) {
    actions.push(action({
      projectId,
      message: text,
      type: "propose_charts",
      label: "Propose chart set",
      description: "Generate and persist a reviewable chart proposal set from the current project data.",
      requiresFile: false,
      params: { userGoal: text },
      warnings: !hasDataset ? [{
        code: "dataset_commit_required",
        message: "Chart proposals require an accepted dataset commit.",
        severity: "warning",
      }] : [],
    }));
  } else if (/\b(plot|chart|figure|graph|vs|versus|画图|作图)\b/.test(normalized)) {
    actions.push(action({
      projectId,
      message: text,
      type: "interpret_chart",
      label: "Draft one chart proposal",
      description: "Interpret the request into a source-backed ChartSpec draft, then queue it for review if confirmed.",
      requiresFile: false,
      params: { prompt: chartPrompt(text) },
      warnings: !hasDataset ? [{
        code: "dataset_commit_required",
        message: "Chart drafting requires an accepted dataset commit.",
        severity: "warning",
      }] : [],
    }));
  }

  if (!actions.length && /\b(show|find|search|query|filter|compare|table|data|显示|查找|比较|表格|数据)\b/.test(normalized)) {
    actions.push(dataQueryAction(projectId, text));
  }

  if (!actions.length) {
    const matches = searchProjectDataCatalog(catalog, text, { limit: 5 });
    actions.push(dataQueryAction(projectId, text));
    if (!matches.length) {
      actions[0].warnings.push({
        code: "agent_intent_unclear",
        message: "No specific workflow intent was detected; LabRat will start with a read-only data query.",
        severity: "info",
      });
    }
  }

  const actionLabels = actions.map((item) => item.label).join(", ");
  return {
    schemaVersion: PROJECT_AGENT_PLAN_VERSION,
    reply: actionLabels
      ? `I prepared ${actions.length === 1 ? "an action" : "actions"} for: ${actionLabels}. Review the card before anything changes.`
      : "I can help, but I need a more specific project action.",
    actions,
    contextSummary: {
      projectId,
      projectName: project?.name || "",
      hasCurrentDatasetCommit: hasDataset,
      currentDatasetCommitId: currentDatasetCommit?.id || null,
      fileObjectCount: asArray(fileObjects).length,
      importRunCount: asArray(importRuns).length,
      chartProposalSetCount: asArray(chartProposalSets).length,
      chartSpecCount: asArray(chartSpecs).length,
      manuscriptCount: asArray(manuscripts).length,
      profileTags: asArray(projectProfile.tags),
      catalogEntryCount: asArray(catalog.entries).length,
      conversationMessageCount: asArray(conversation).length,
      selectedContextKeys: Object.keys(selectedContext || {}),
    },
    warnings: asArray(catalog.warnings),
  };
}
