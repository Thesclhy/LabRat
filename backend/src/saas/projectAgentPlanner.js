import { createHash } from "node:crypto";

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

function latestAcceptedSourceProposal(chartProposalSets = []) {
  const sets = asArray(chartProposalSets).slice().reverse();
  for (const set of sets) {
    const proposal = asArray(set?.payload?.proposals).find((candidate) => (
      candidate?.status === "accepted"
      && (candidate?.origin === "source_extract" || candidate?.sourceSnapshot)
    ));
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

function normalizedText(message) {
  return String(message || "").trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
}

function isWorkbookUploadReviewRequest(message) {
  const text = normalizedText(message);
  return /\b(upload|import|add|attach|refresh|replace|update|correct)\b/.test(text)
    && /\b(workbook|excel|xlsx|xls|file|table|master|mastertable|supplement|supplemental|calculation|source|data)\b/.test(text);
}

function chartPrompt(message) {
  return String(message || "").replace(/\b(create|make|draft|plot|show|generate|please)\b/gi, " ").replace(/\s+/g, " ").trim() || String(message || "");
}

export function createProjectAgentPlan({
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
  const projectId = project?.id || "project";
  const text = String(message || "").trim();
  const normalized = normalizedText(text);
  const targetExperimentAliases = experimentAliases(text);
  const actions = [];

  if (isWorkbookUploadReviewRequest(text)) {
    actions.push(action({
      projectId,
      message: text,
      type: "upload_workbook_for_review",
      label: "Upload workbook",
      description: "Upload one workbook, index its source cells, and review its interpretation before publishing experiments.",
      requiresFile: true,
      params: {
        targetExperimentAliases,
        existingFiles: compactExistingFiles(fileObjects),
      },
    }));
  } else if (/\b(create|save|make)\b/.test(normalized) && /\b(chart spec|chartspec|chart specification)\b/.test(normalized)) {
    const accepted = latestAcceptedSourceProposal(chartProposalSets);
    actions.push(action({
      projectId,
      message: text,
      type: "create_chart_spec_from_proposal",
      label: "Create chart spec from accepted source proposal",
      description: accepted ? `Create a durable source-backed ChartSpec from ${accepted.title}.` : "No accepted source-backed chart proposal was found.",
      params: accepted || {},
      warnings: accepted ? [] : [{
        code: "accepted_source_chart_proposal_required",
        message: "Accept a source-backed chart proposal before creating a ChartSpec.",
        severity: "warning",
      }],
    }));
  } else if (/\b(plot|chart|figure|graph|vs|versus)\b/.test(normalized)) {
    actions.push(action({
      projectId,
      message: text,
      type: "interpret_chart",
      label: "Review source-backed chart request",
      description: "Resolve explicit workbook source evidence and keep extracted values reviewable before chart creation.",
      params: { prompt: chartPrompt(text) },
      warnings: [{
        code: "explicit_source_evidence_required",
        message: "Accepted DataSnapshot-to-chart generation is deferred; select an explicit workbook sheet and range for charting.",
        severity: "info",
      }],
    }));
  } else {
    actions.push(action({
      projectId,
      message: text,
      type: "open_experiment_browser",
      label: "Open Experiment Browser",
      description: "Browse accepted experiment snapshots, compare selected records, and inspect source-backed details.",
      requiresReview: false,
      params: {
        search: text,
        targetExperimentAliases,
      },
      warnings: asArray(experimentSnapshotHeads).length ? [] : [{
        code: "published_experiments_required",
        message: "Publish reviewed workbook experiments before browsing project data.",
        severity: "info",
      }],
    }));
  }

  return {
    schemaVersion: PROJECT_AGENT_PLAN_VERSION,
    reply: `I prepared an action for: ${actions[0].label}. Review the card before anything changes.`,
    actions,
    contextSummary: {
      projectId,
      projectName: project?.name || "",
      publishedExperimentCount: asArray(experimentSnapshotHeads).length,
      sourceDocumentCount: asArray(sourceDocuments).length,
      fileObjectCount: asArray(fileObjects).length,
      chartProposalSetCount: asArray(chartProposalSets).length,
      chartSpecCount: asArray(chartSpecs).length,
      manuscriptCount: asArray(manuscripts).length,
      profileTags: asArray(projectProfile.tags),
      conversationMessageCount: asArray(conversation).length,
      selectedContextKeys: Object.keys(selectedContext || {}),
    },
    warnings: [],
  };
}
