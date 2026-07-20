export const ANALYSIS_INTENTS = new Set([
  "project_purpose",
  "project_overview",
  "experiment_overview",
  "experiment_compare",
  "experiment_lookup",
  "open_or_filter_browser",
  "upload_workbook",
  "create_analysis_chart",
  "manuscript_action",
  "clarification",
]);

const DISPOSITIONS = new Set([
  "direct_answer",
  "analysis_thread",
  "action",
  "clarification",
]);

function text(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ");
}

function metadata(value = {}) {
  return {
    provider: text(value.provider) || "deterministic",
    model: value.model || null,
    latencyMs: Number.isFinite(Number(value.latencyMs)) ? Number(value.latencyMs) : 0,
    usage: {
      inputTokens: Number(value.usage?.inputTokens) || 0,
      outputTokens: Number(value.usage?.outputTokens) || 0,
    },
  };
}

function result({
  intent,
  disposition,
  actionType = null,
  confidence = 1,
  clarification = null,
  routeMetadata = {},
}) {
  return {
    schemaVersion: "labrat.analysisIntent.v1",
    intent,
    disposition,
    actionType,
    confidence,
    clarification,
    metadata: metadata(routeMetadata),
  };
}

export function deterministicAnalysisIntent({ message = "" } = {}) {
  const raw = text(message);
  const value = normalized(raw);
  if (!value) {
    return result({
      intent: "clarification",
      disposition: "clarification",
      confidence: 1,
      clarification: "Describe the project question, data selection, calculation, chart, or navigation you need.",
    });
  }

  const upload = /\b(upload|attach|import|add)\b/.test(value)
    && /\b(workbook|excel|xlsx|xls|spreadsheet|file)\b/.test(value);
  if (upload || /上传.*(?:工作簿|表格|excel|文件)/i.test(raw)) {
    return result({
      intent: "upload_workbook",
      disposition: "action",
      actionType: "upload_workbook_for_review",
    });
  }

  const browser = /\b(open|go to|show)\b.*\bexperiment browser\b/.test(value)
    || /(?:打开|进入|显示).*experiment browser/i.test(raw);
  if (browser) {
    return result({
      intent: "open_or_filter_browser",
      disposition: "action",
      actionType: "open_experiment_browser",
    });
  }

  const manuscript = /\b(insert|add|remove|delete|move|resize|export)\b.*\b(manuscript|canvas|text box|chart)\b/.test(value);
  if (manuscript) {
    return result({
      intent: "manuscript_action",
      disposition: "action",
      actionType: "manuscript_action",
    });
  }

  const purpose = (
    /\bwhat\b.*\b(?:experiment|study|project)\b.*\bfor\b/.test(value)
    || /\bpurpose\b.*\b(?:experiment|study|project)\b/.test(value)
    || /(?:实验|项目|研究).*(?:目的|用途|为了什么)/.test(raw)
  );
  if (purpose) {
    return result({
      intent: "project_purpose",
      disposition: "direct_answer",
    });
  }

  const projectOverview = (
    /\b(?:overview|summary|status|what is|what s)\b.*\b(?:project|study)\b/.test(value)
    || /\b(?:project|study)\b.*\b(?:overview|summary|status|contain|include|about)\b/.test(value)
    || /(?:项目|研究).*(?:概况|概览|状态|有什么|是什么)/.test(raw)
  );
  if (projectOverview) {
    return result({
      intent: "project_overview",
      disposition: "direct_answer",
    });
  }

  const chart = /\b(plot|chart|figure|graph|visuali[sz]e|draw)\b/.test(value)
    || /(?:画图|图表|绘图|可视化)/.test(raw);
  if (chart) {
    return result({
      intent: "create_analysis_chart",
      disposition: "analysis_thread",
    });
  }

  const compare = /\b(compare|comparison|versus|vs)\b/.test(value)
    || /(?:比较|对比)/.test(raw);
  if (compare) {
    return result({
      intent: "experiment_compare",
      disposition: "analysis_thread",
    });
  }

  const overview = (
    /\b(?:overview|summari[sz]e|trend|trends|pattern|patterns)\b.*\b(?:experiment|experiments|data|results)\b/.test(value)
    || /\bacross all experiments\b/.test(value)
    || /(?:所有|全部|跨).*(?:实验).*(?:趋势|概览|总结)/.test(raw)
  );
  if (overview) {
    return result({
      intent: "experiment_overview",
      disposition: "analysis_thread",
    });
  }

  const calculation = /\b(normalize|calculate|compute|sum|average|mean|median|regression|fit|correlation|statistics?)\b/.test(value)
    || /(?:归一化|标准化|计算|求和|平均|拟合|回归|相关性|统计)/.test(raw);
  if (calculation) {
    return result({
      intent: "experiment_compare",
      disposition: "analysis_thread",
    });
  }

  const explicitLookup = /\b(?:what|which|show|give)\b.*\bexp(?:eriment)?\s*0*\d+\b/.test(value);
  if (explicitLookup) {
    return result({
      intent: "experiment_lookup",
      disposition: "direct_answer",
    });
  }

  return null;
}

function boundedIntentInput(input = {}) {
  return {
    message: text(input.message),
    selectedContextKeys: Object.keys(input.selectedContext || {}).sort(),
    projectContext: {
      publishedExperimentCount: Number(input.projectContext?.publishedExperimentCount) || 0,
      sourceDocumentCount: Number(input.projectContext?.sourceDocumentCount) || 0,
      chartSpecCount: Number(input.projectContext?.chartSpecCount) || 0,
      manuscriptCount: Number(input.projectContext?.manuscriptCount) || 0,
    },
  };
}

function validProviderRoute(value) {
  return value?.ok !== false
    && ANALYSIS_INTENTS.has(value?.intent)
    && DISPOSITIONS.has(value?.disposition)
    && value.disposition !== "open_experiment_browser";
}

export async function routeAnalysisIntent(input = {}) {
  const deterministic = deterministicAnalysisIntent(input);
  if (deterministic) return deterministic;

  const classified = await input.modelProvider?.classifyIntent?.(boundedIntentInput(input));
  if (validProviderRoute(classified)) {
    return result({
      intent: classified.intent,
      disposition: classified.disposition,
      actionType: classified.actionType || null,
      confidence: Number(classified.confidence) || 0,
      clarification: classified.clarification || null,
      routeMetadata: classified.metadata,
    });
  }

  return result({
    intent: "clarification",
    disposition: "clarification",
    confidence: 0,
    clarification: "I need a more specific experiment scope, field, calculation, chart, or navigation request.",
    routeMetadata: classified?.metadata || {
      provider: classified?.warning ? "deterministic" : "deterministic",
    },
  });
}
