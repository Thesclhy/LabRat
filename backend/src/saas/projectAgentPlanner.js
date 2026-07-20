import { createHash } from "node:crypto";
import { deterministicAnalysisIntent } from "./analysisIntentRouter.js";

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

function isExplicitChartActionRequest(message) {
  const text = normalizedText(message);
  return (/\b(create|make|generate|plot|draw|draft|save|show)\b/.test(text) || /^(chart|graph)\b/.test(text))
    && /\b(plot|chart|figure|graph|vs|versus)\b/.test(text);
}

function isProjectSummaryRequest(message) {
  const raw = String(message || "").trim();
  const text = normalizedText(raw);
  const chineseProjectQuestion = /(?:这个|当前|目前|本)?项目.*(?:有什么|有哪些|内容|情况|状态|进展|介绍|概况)/.test(raw)
    || /(?:这个|当前|目前|本)?项目.*(?:有什么|有哪些|多少|什么).*(?:数据|实验|文档)/.test(raw)
    || /(?:这个|当前|目前|本)?项目.*(?:是什么样|怎么样|如何)/.test(raw)
    || /(?:介绍|总结|概括).*(?:这个|当前|目前|本)?项目/.test(raw);
  const englishProjectQuestion = (
    /\b(?:what|summarize|summary|overview|status|contents?|about)\b.*\b(?:project|study)\b/.test(text)
    || /\b(?:project|study)\b.*\b(?:what|contain|include|summary|overview|status|about)\b/.test(text)
  );
  return chineseProjectQuestion || englishProjectQuestion;
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function projectSummaryReply({
  project,
  projectProfile,
  experimentSnapshotHeads,
  sourceDocuments,
  chartSpecs,
  manuscripts,
  message,
}) {
  const isChinese = /[\u3400-\u9fff]/.test(String(message || ""));
  const name = project?.name || "Untitled project";
  const description = String(project?.description || "").trim();
  const profile = projectProfile || {};
  const facts = [
    ["researchGoal", profile.researchGoal],
    ["experimentBackground", profile.experimentBackground],
    ["materials", profile.materials],
    ["methods", profile.methods],
    ["instruments", profile.instruments],
    ["analysisNotes", profile.analysisNotes],
  ].filter(([, value]) => String(value || "").trim());
  const counts = {
    experiments: asArray(experimentSnapshotHeads).length,
    sources: asArray(sourceDocuments).length,
    charts: asArray(chartSpecs).length,
    manuscripts: asArray(manuscripts).length,
  };
  if (isChinese) {
    const profileLabels = {
      researchGoal: "研究目标",
      experimentBackground: "实验背景",
      materials: "材料",
      methods: "方法",
      instruments: "仪器",
      analysisNotes: "分析说明",
    };
    const details = facts.map(([key, value]) => `${profileLabels[key]}：${String(value).trim()}`);
    if (description) details.unshift(`项目说明：${description}`);
    return [
      `项目「${name}」当前包含 ${counts.sources} 个源文档、${counts.experiments} 个已发布实验、${counts.charts} 个图表规范和 ${counts.manuscripts} 份稿件。`,
      counts.experiments
        ? "当前已有接受并发布的数据记录，可在 Experiment Browser 中浏览和比较。"
        : "当前尚无可浏览的已发布实验记录。",
      details.length ? details.join("；") : "项目档案中还没有填写研究背景或方法信息。",
    ].join(" ");
  }
  const detailLabels = {
    researchGoal: "Research goal",
    experimentBackground: "Background",
    materials: "Materials",
    methods: "Methods",
    instruments: "Instruments",
    analysisNotes: "Analysis notes",
  };
  const details = facts.map(([key, value]) => `${detailLabels[key]}: ${String(value).trim()}`);
  if (description) details.unshift(`Description: ${description}`);
  return [
    `Project ${name} currently has ${countLabel(counts.sources, "source document")}, ${countLabel(counts.experiments, "published experiment")}, ${countLabel(counts.charts, "chart spec")}, and ${countLabel(counts.manuscripts, "manuscript")}.`,
    counts.experiments
      ? "Accepted published records are available to browse and compare in Experiment Browser."
      : "No published experiment records are available yet.",
    details.length ? details.join("; ") : "The project profile does not yet include research context or methods.",
  ].join(" ");
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
  let intent = "action_plan";
  let reply = "";
  let analysisRequest = null;
  const projectSummaryRequest = isProjectSummaryRequest(text);
  const routedIntent = deterministicAnalysisIntent({ message: text });
  const chartRequest = /\b(plot|chart|figure|graph|vs|versus)\b/.test(normalized);
  const chartSpecRequest = /\b(create|save|make)\b/.test(normalized)
    && /\b(chart spec|chartspec|chart specification)\b/.test(normalized);

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
  } else if (chartSpecRequest) {
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
  } else if (routedIntent?.disposition === "analysis_thread" || isExplicitChartActionRequest(text) || chartRequest) {
    intent = "analysis_thread";
    analysisRequest = {
      schemaVersion: "labrat.analysisRequest.v1",
      intent: routedIntent?.intent || "create_analysis_chart",
      message: text,
      selectedContext,
    };
    reply = "I will prepare a reviewed analysis plan using accepted experiment data. No calculation will run until you accept the exact selection and processing plan.";
  } else if (projectSummaryRequest || ["project_purpose", "project_overview"].includes(routedIntent?.intent)) {
    intent = "project_summary";
    reply = projectSummaryReply({
      project,
      projectProfile,
      experimentSnapshotHeads,
      sourceDocuments,
      chartSpecs,
      manuscripts,
      message: text,
    });
  } else if (routedIntent?.actionType === "open_experiment_browser") {
    actions.push(action({
      projectId,
      message: text,
      type: "open_experiment_browser",
      label: "Open Experiment Browser",
      description: "Browse accepted experiment snapshots, compare selected records, and inspect source-backed details.",
      requiresReview: false,
      params: {
        search: text.replace(/\b(?:open|go to|show)\b.*?\bexperiment browser\b/i, "").trim(),
        targetExperimentAliases,
      },
      warnings: asArray(experimentSnapshotHeads).length ? [] : [{
        code: "published_experiments_required",
        message: "Publish reviewed workbook experiments before browsing project data.",
        severity: "info",
      }],
    }));
  } else {
    intent = "clarification";
    reply = routedIntent?.clarification
      || "Tell me which project question, experiment scope, field, calculation, chart, or navigation action you need.";
  }

  return {
    schemaVersion: PROJECT_AGENT_PLAN_VERSION,
    intent,
    reply: reply || (actions.length
      ? `I prepared an action for: ${actions[0].label}. Review the card before anything changes.`
      : "I need more detail before preparing a project action."),
    actions,
    analysisRequest,
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
