import { routeAnalysisIntent } from "./analysisIntentRouter.js";
import { resolveActiveExperimentRecords } from "./experimentProjection.js";
import { sha256Hex } from "./ids.js";

export const AGENT_RUN_SCHEMA_VERSION = "labrat.agentRun.v1";

const MAX_QUESTION_REGIONS = 100;
const MAX_QUESTION_EXPERIMENTS = 25;
const MAX_QUESTION_FIELDS = 40;
const MAX_COMMENTARY_TRACES = 12;
const MAX_COMMENTARY_POINTS = 160;
const CHART_COMMENTARY_MODES = new Set(["analysis", "trend", "caption"]);

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

function chartSpecValue(chartSpec = {}) {
  return chartSpec?.spec && typeof chartSpec.spec === "object" && !Array.isArray(chartSpec.spec)
    ? chartSpec.spec
    : chartSpec;
}

function chartTraceId(trace, index) {
  return text(trace?.traceId || trace?.meta?.labrat?.traceId || `trace_${index + 1}`);
}

function boundedChartValue(value) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  return text(value).slice(0, 160);
}

function sampledIndexes(length) {
  if (length <= MAX_COMMENTARY_POINTS) return Array.from({ length }, (_value, index) => index);
  return Array.from({ length: MAX_COMMENTARY_POINTS }, (_value, index) => (
    Math.round((index * (length - 1)) / (MAX_COMMENTARY_POINTS - 1))
  ));
}

function commentaryTrace(trace, index) {
  const x = asArray(trace?.x);
  const y = asArray(trace?.y);
  const pointCount = Math.max(x.length, y.length);
  const indexes = sampledIndexes(pointCount);
  return {
    traceId: chartTraceId(trace, index),
    name: text(trace?.name) || `Series ${index + 1}`,
    type: text(trace?.type) || "scatter",
    mode: text(trace?.mode) || null,
    pointCount,
    sampled: pointCount > MAX_COMMENTARY_POINTS,
    x: indexes.map((pointIndex) => boundedChartValue(x[pointIndex])),
    y: indexes.map((pointIndex) => boundedChartValue(y[pointIndex])),
  };
}

function chartAxisTitle(axis = {}) {
  return text(typeof axis?.title === "object" ? axis.title?.text : axis?.title);
}

function commentaryFailure(message, code, metadata = {}) {
  return {
    mode: "chart_commentary",
    status: "completed",
    reply: message,
    visibleSteps: [visibleStep("Could not analyze selected chart", metadata)],
    toolTrace: [],
    proposalRefs: [],
    actions: [],
    usage: mergedUsage(null),
    warnings: [{ code, message, severity: "warning" }],
  };
}

async function answerChartCommentary({
  context,
  project,
  projectProfile,
  chartSpecs,
  message,
  selectedContext,
  signal,
}) {
  const chartSpecId = text(selectedContext?.selectedChartSpecId);
  const chartSpec = asArray(chartSpecs).find((candidate) => (
    candidate?.id === chartSpecId
    && candidate?.projectId === project?.id
    && chartSpecValue(candidate)?.status === "accepted"
  ));
  if (!chartSpec) {
    return commentaryFailure(
      "The selected accepted chart is no longer available in this project.",
      "chart_commentary_chart_not_found",
      { chartSpecId: chartSpecId || null },
    );
  }

  const spec = chartSpecValue(chartSpec);
  const plotly = spec?.plotly || {};
  const traces = asArray(plotly.data);
  const availableTraceIds = traces.map(chartTraceId);
  const requestedView = selectedContext?.selectedChartView;
  const hasExplicitView = requestedView
    && typeof requestedView === "object"
    && !Array.isArray(requestedView)
    && Object.hasOwn(requestedView, "visibleTraceIds");
  const requestedTraceIds = hasExplicitView
    ? [...new Set(asArray(requestedView.visibleTraceIds).map(text).filter(Boolean))]
    : asArray(spec?.defaultChartView?.visibleTraceIds).map(text).filter(Boolean);
  const visibleTraceIds = requestedTraceIds.length ? requestedTraceIds : (hasExplicitView ? [] : availableTraceIds);
  const unknownTraceIds = visibleTraceIds.filter((traceId) => !availableTraceIds.includes(traceId));
  if (unknownTraceIds.length) {
    return commentaryFailure(
      "The selected manuscript chart references series that are no longer available.",
      "chart_commentary_trace_unknown",
      { chartSpecId, unknownTraceIds },
    );
  }
  if (!visibleTraceIds.length) {
    return commentaryFailure(
      "Show at least one chart series before asking LabRat to write an analysis.",
      "chart_commentary_visible_trace_required",
      { chartSpecId },
    );
  }
  const visible = traces
    .map((trace, index) => ({ trace, index, traceId: availableTraceIds[index] }))
    .filter(({ traceId }) => visibleTraceIds.includes(traceId))
    .slice(0, MAX_COMMENTARY_TRACES)
    .map(({ trace, index }) => commentaryTrace(trace, index));
  const mode = CHART_COMMENTARY_MODES.has(text(selectedContext?.chartCommentaryMode))
    ? text(selectedContext.chartCommentaryMode)
    : "analysis";
  const response = await context.modelProvider?.answerChartCommentary?.({
    schemaVersion: "labrat.chartCommentaryRequest.v1",
    mode,
    request: text(message),
    project: {
      id: project.id,
      name: project.name,
      profile: projectProfileFacts(projectProfile),
    },
    chart: {
      chartSpecId,
      title: text(selectedContext?.selectedChartTitle || spec?.title || chartSpec?.title) || "Chart",
      chartType: text(spec?.chartType || chartSpec?.chartType) || "chart",
      axisTitles: {
        x: chartAxisTitle(plotly?.layout?.xaxis),
        y: chartAxisTitle(plotly?.layout?.yaxis),
      },
      visibleTraceIds: visible.map((trace) => trace.traceId),
      visibleTraceCount: visibleTraceIds.length,
      omittedVisibleTraceCount: Math.max(0, visibleTraceIds.length - visible.length),
      totalTraceCount: traces.length,
      traces: visible,
    },
  }, { signal });
  if (!response?.ok || !text(response.answer)) {
    return {
      ...commentaryFailure(
        response?.warning?.message || "LabRat could not write an analysis for the selected chart.",
        response?.warning?.code || "chart_commentary_model_unavailable",
        { chartSpecId, mode },
      ),
      usage: mergedUsage(null, response?.metadata || {}),
    };
  }
  return {
    mode: "chart_commentary",
    status: "completed",
    reply: text(response.answer),
    visibleSteps: [visibleStep("Analyzed selected chart as text", {
      chartSpecId,
      mode,
      visibleTraceCount: visible.length,
    })],
    toolTrace: [{
      tool: "chart_spec.read",
      observation: { chartSpecId, visibleTraceIds },
    }],
    proposalRefs: [{ type: "chart_spec", id: chartSpecId }],
    actions: [],
    usage: mergedUsage(null, response.metadata || {}),
    warnings: [],
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
    linkedExperimentId: region.linkedExperimentId || null,
    dataKind: region.dataKind || null,
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
  if (selectedContext?.requestedWorkflow === "chart_commentary") {
    return answerChartCommentary({
      context,
      project,
      projectProfile,
      chartSpecs,
      message: request,
      selectedContext,
      signal,
    });
  }
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
