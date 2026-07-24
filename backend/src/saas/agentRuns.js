import { routeAnalysisIntent } from "./analysisIntentRouter.js";
import { resolveActiveExperimentRecords } from "./experimentProjection.js";
import { sha256Hex } from "./ids.js";

export const AGENT_RUN_SCHEMA_VERSION = "labrat.agentRun.v1";

const MAX_QUESTION_REGIONS = 100;
const MAX_QUESTION_EXPERIMENTS = 25;
const MAX_QUESTION_FIELDS = 40;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
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

function normalizedAlias(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function visibleStep(label, details = {}) {
  return {
    stepId: `agent_step_${sha256Hex(`${label}:${JSON.stringify(details)}`).slice(0, 12)}`,
    label,
    details,
    createdAt: new Date().toISOString(),
  };
}

function routeUsage(route) {
  const routeMetadata = route?.metadata || {};
  return {
    provider: routeMetadata.provider || "deterministic",
    model: routeMetadata.model || null,
    inputTokens: Number(routeMetadata.usage?.inputTokens) || 0,
    outputTokens: Number(routeMetadata.usage?.outputTokens) || 0,
    latencyMs: Number(routeMetadata.latencyMs) || 0,
    estimatedCostUsd: 0,
  };
}

function mergedUsage(route, answerMetadata = {}) {
  const routed = routeUsage(route);
  return {
    ...routed,
    provider: answerMetadata.provider || routed.provider,
    model: answerMetadata.model || routed.model,
    inputTokens: routed.inputTokens + (Number(answerMetadata.usage?.inputTokens) || 0),
    outputTokens: routed.outputTokens + (Number(answerMetadata.usage?.outputTokens) || 0),
    latencyMs: routed.latencyMs + (Number(answerMetadata.latencyMs) || 0),
  };
}

function sourceDocumentName(sourceDocument) {
  return sourceDocument?.metadata?.workbookName
    || sourceDocument?.metadata?.fileName
    || sourceDocument?.originalName
    || sourceDocument?.id
    || "workbook";
}

function projectProfileFacts(projectProfile = {}) {
  return Object.fromEntries([
    "researchGoal",
    "experimentBackground",
    "materials",
    "methods",
    "instruments",
    "analysisNotes",
  ].flatMap((key) => text(projectProfile[key]) ? [[key, text(projectProfile[key])]] : []));
}

function acceptedRegionContext(acceptedRegionUnderstandings, sourceDocuments) {
  const sourceById = new Map(asArray(sourceDocuments).map((item) => [item.id, item]));
  return asArray(acceptedRegionUnderstandings).slice(0, MAX_QUESTION_REGIONS).map(({ region = {}, revision = {} }) => ({
    evidenceId: revision.id,
    regionId: region.id,
    sourceDocumentId: region.sourceDocumentId,
    workbookName: sourceDocumentName(sourceById.get(region.sourceDocumentId)),
    sheetName: region.sheetName,
    range: region.rangeRef,
    semanticType: revision.interpretation?.semanticType || "unknown_region",
    summary: asArray(revision.summary).map(text).filter(Boolean),
    fields: asArray(revision.interpretation?.fields).slice(0, MAX_QUESTION_FIELDS).map((field) => ({
      fieldKey: field.semanticKey,
      displayName: field.displayName,
      role: field.role,
      valueType: field.valueType,
      unit: field.unit || null,
    })),
    series: asArray(revision.interpretation?.series).slice(0, 20).map((series) => ({
      seriesKey: series.seriesKey,
      label: series.label,
      xField: series.xSemanticKey,
      yField: series.ySemanticKey,
      xUnit: series.xUnit || null,
      yUnit: series.yUnit || null,
    })),
  }));
}

function acceptedExperimentContext({
  projectId,
  message,
  dataSnapshots,
  experimentIdentities,
  experimentSnapshotHeads,
}) {
  const entries = resolveActiveExperimentRecords({
    projectId,
    dataSnapshots,
    experimentIdentities,
    experimentSnapshotHeads,
  });
  const aliases = experimentAliases(message).map(normalizedAlias);
  const selected = aliases.length
    ? entries.filter(({ identity, record }) => [
      identity?.canonicalLabel,
      record?.label,
      ...asArray(identity?.aliases),
    ].some((alias) => aliases.includes(normalizedAlias(alias))))
    : [];
  return (selected.length ? selected : entries.slice(0, Math.min(5, MAX_QUESTION_EXPERIMENTS)))
    .slice(0, MAX_QUESTION_EXPERIMENTS)
    .map(({ head, identity, snapshot, record }) => ({
      evidenceId: `${snapshot.id}:${Number(head.recordIndex)}`,
      experimentId: identity.id,
      label: identity.canonicalLabel || record.label || identity.id,
      fields: asArray(record.fields).slice(0, MAX_QUESTION_FIELDS).map((field) => ({
        fieldKey: field.fieldKey,
        displayName: field.displayName || field.fieldKey,
        value: field.value,
        valueType: field.valueType,
        unit: field.unit || null,
      })),
      series: asArray(record.series).slice(0, 20).map((series) => ({
        seriesKey: series.seriesKey,
        label: series.label,
        pointCount: asArray(series.points).length,
        xUnit: series.xUnit || null,
        yUnit: series.yUnit || null,
      })),
    }));
}

function fallbackProjectAnswer({ project, projectProfile, sourceDocuments, experimentSnapshotHeads, chartSpecs }) {
  const facts = projectProfileFacts(projectProfile);
  const description = text(project?.description);
  const details = [
    description ? `Description: ${description}` : "",
    ...Object.entries(facts).map(([key, value]) => `${key}: ${value}`),
  ].filter(Boolean);
  return [
    `Project ${project?.name || "Untitled project"} contains ${asArray(sourceDocuments).length} source documents, ${asArray(experimentSnapshotHeads).length} published experiments, and ${asArray(chartSpecs).length} charts.`,
    details.length ? details.join("; ") : "No project purpose or research background has been recorded yet.",
  ].join(" ");
}

async function answerProjectQuestion({
  context,
  project,
  projectProfile,
  sourceDocuments,
  experimentSnapshotHeads,
  chartSpecs,
  manuscripts,
  message,
  conversation,
  signal,
}) {
  const [acceptedRegionUnderstandings, dataSnapshots, experimentIdentities] = await Promise.all([
    context.store.listAcceptedRegionUnderstandings?.({ projectId: project.id }) || [],
    context.store.listDataSnapshots?.({ projectId: project.id }) || [],
    context.store.listExperimentIdentities?.({ projectId: project.id }) || [],
  ]);
  const acceptedRegions = acceptedRegionContext(acceptedRegionUnderstandings, sourceDocuments);
  const acceptedExperiments = acceptedExperimentContext({
    projectId: project.id,
    message,
    dataSnapshots,
    experimentIdentities,
    experimentSnapshotHeads,
  });
  const allowedEvidenceIds = new Set([
    ...acceptedRegions.map((item) => item.evidenceId),
    ...acceptedExperiments.map((item) => item.evidenceId),
  ].filter(Boolean));
  const response = await context.modelProvider?.answerReadOnly?.({
    schemaVersion: "labrat.projectQuestion.v1",
    question: text(message),
    conversation: asArray(conversation).slice(-10).map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      text: text(item?.text),
    })),
    project: {
      id: project.id,
      name: project.name,
      description: project.description || "",
      profile: projectProfileFacts(projectProfile),
    },
    counts: {
      sourceDocuments: asArray(sourceDocuments).length,
      acceptedRegions: acceptedRegions.length,
      publishedExperiments: asArray(experimentSnapshotHeads).length,
      charts: asArray(chartSpecs).length,
      manuscripts: asArray(manuscripts).length,
    },
    acceptedRegions,
    acceptedExperiments,
  }, { signal });
  if (response?.ok && text(response.answer)) {
    return {
      answer: text(response.answer),
      evidenceIds: asArray(response.evidenceIds).map(text).filter((id) => allowedEvidenceIds.has(id)),
      metadata: response.metadata || {},
      warning: null,
    };
  }
  return {
    answer: fallbackProjectAnswer({ project, projectProfile, sourceDocuments, experimentSnapshotHeads, chartSpecs }),
    evidenceIds: [],
    metadata: response?.metadata || {},
    warning: response?.warning || {
      code: "project_question_model_unavailable",
      message: "The backend model was unavailable, so LabRat returned a bounded project summary.",
    },
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

export async function buildAgentRunDraft({
  context,
  project,
  projectProfile = {},
  chartSpecs = [],
  manuscripts = [],
  experimentSnapshotHeads = [],
  sourceDocuments = [],
  message = "",
  conversation = [],
  selectedContext = {},
  signal = undefined,
} = {}) {
  const request = text(message);
  const route = await routeAnalysisIntent({
    message: request,
    selectedContext,
    projectContext: {
      projectId: project?.id || null,
      publishedExperimentCount: asArray(experimentSnapshotHeads).length,
      sourceDocumentCount: asArray(sourceDocuments).length,
      chartSpecCount: asArray(chartSpecs).length,
      manuscriptCount: asArray(manuscripts).length,
    },
    modelProvider: context?.modelProvider || null,
    signal,
  });

  if (route.intent === "upload_workbook") {
    return {
      mode: "workbook_upload",
      status: "completed",
      reply: "Attach an Excel workbook in LabRat. I will index it, propose bounded regions, and wait for you to confirm each region's meaning.",
      visibleSteps: [visibleStep("Requested workbook attachment")],
      toolTrace: [],
      actions: [],
      usage: routeUsage(route),
      warnings: [],
    };
  }

  if (route.disposition === "analysis_thread") {
    return {
      mode: "analysis_planning",
      status: "waiting_for_user",
      reply: "I will prepare a reviewed analysis plan from user-confirmed project evidence. No calculation will run until you accept the exact selection and processing plan.",
      visibleSteps: [visibleStep("Routed request to reviewed analysis", {
        intent: route.intent,
        acceptedRegionSource: true,
        publishedExperimentCount: asArray(experimentSnapshotHeads).length,
      })],
      toolTrace: [],
      actions: [],
      usage: routeUsage(route),
      warnings: [],
      analysisRequest: {
        schemaVersion: "labrat.analysisRequest.v2",
        intent: route.intent,
        outputTarget: route.intent === "publish_experiment_data"
          ? "experiment_browser"
          : "chart",
        message: request,
        selectedContext,
      },
    };
  }

  if (route.disposition === "direct_answer") {
    const answered = await answerProjectQuestion({
      context,
      project,
      projectProfile,
      sourceDocuments,
      experimentSnapshotHeads,
      chartSpecs,
      manuscripts,
      message: request,
      conversation,
      signal,
    });
    return {
      mode: "project_question",
      status: "completed",
      reply: answered.answer,
      visibleSteps: [visibleStep("Answered from accepted project evidence", {
        intent: route.intent,
        evidenceIds: answered.evidenceIds,
      })],
      toolTrace: answered.evidenceIds.length ? [{
        tool: "project.evidence.answer",
        observation: { evidenceIds: answered.evidenceIds },
      }] : [],
      actions: [],
      usage: mergedUsage(route, answered.metadata),
      warnings: answered.warning ? [{ ...answered.warning, severity: "warning" }] : [],
    };
  }

  return {
    mode: "clarification",
    status: "completed",
    reply: route.clarification
      || "Ask a project question, attach a workbook, or describe the analysis or chart you want.",
    visibleSteps: [visibleStep("Requested clarification", { intent: route.intent })],
    toolTrace: [],
    actions: [],
    usage: routeUsage(route),
    warnings: [],
  };
}
