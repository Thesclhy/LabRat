import { requestAnthropicJson } from "../ai/anthropic.js";

const INTENT_SYSTEM = [
  "Classify one LabRat research-workflow message.",
  "Return JSON only with intent, disposition, confidence, and clarification.",
  "Allowed intents: project_purpose, project_overview, experiment_overview, experiment_compare,",
  "experiment_lookup, open_or_filter_browser, upload_workbook, create_analysis_chart,",
  "manuscript_action, clarification.",
  "Allowed dispositions: direct_answer, analysis_thread, action, clarification.",
  "Derived calculations, trends, comparisons, statistics, and charts use analysis_thread.",
  "Never return hidden reasoning or scientific values.",
].join(" ");

const ANALYSIS_PLAN_SYSTEM = [
  "Draft one reviewable LabRat analysis plan as JSON only.",
  "Return exactly {selectionRequest, plan}.",
  "selectionRequest contains experimentIds, fieldIds, and includeSeries; use only supplied experiment and field ids.",
  "plan contains requestSummary, processingSummary, calculationManifest, pythonProgram, expectedOutput, and warnings.",
  "calculationManifest must declare inputs, an explicit missingValuePolicy, derivedFields, and invariants.",
  "pythonProgram must contain runtime labrat-python-v1, entrypoint analyze, and exact Python source defining analyze(tables, labrat).",
  "expectedOutput must use shape experiment_traces and declare chartType, xField, and one or more yFields.",
  "analyze must return {result_table, traces, lineage, summary}; each row keeps __experiment_id, __snapshot_id, __record_index, a stable __result_id, and every expected yField.",
  "Each trace has a stable traceId, finite numeric y, string-or-finite-numeric x, units, and accepted sourceRecordIds.",
  "summary declares inputRecordCount, outputRecordCount, excludedRecordCount, excludedRecords, and missingValuePolicy; each excluded record has sourceRecordId and reason.",
  "Use only tables and labrat inputs. Do not read files, URLs, environment state, processes, or network resources.",
  "Do not return selection hashes, dependency hashes, source rectangles, source hashes, result rows, plotted arrays, or hidden reasoning.",
  "The backend will resolve accepted data, compute all hashes, validate the plan, and require user review before execution.",
].join(" ");

function parseJsonObject(value) {
  const raw = String(value || "").trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unavailableWarning(code = "ai_unavailable", message = "Backend model provider is not configured.") {
  return { code, message, severity: "warning" };
}

export function createBackendModelProvider({
  config = {},
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const providerName = config.aiProvider || "anthropic";
  const model = config.anthropicModel || "claude-sonnet-4-5";
  const apiKey = config.anthropicApiKey || "";

  const publicConfig = () => ({
    provider: providerName,
    model,
    configured: Boolean(apiKey),
  });

  const requestStructured = async ({ system, payload, maxTokens = 1200 }) => {
    if (providerName !== "anthropic") {
      return {
        ok: false,
        warning: unavailableWarning("ai_provider_unsupported", `Unsupported backend model provider ${providerName}.`),
      };
    }
    if (!apiKey) return { ok: false, warning: unavailableWarning() };
    const startedAt = now();
    const response = await requestAnthropicJson({
      system,
      prompt: JSON.stringify(payload),
      maxTokens,
      config: { apiKey, model },
      fetchImpl,
    });
    const latencyMs = Math.max(0, now() - startedAt);
    if (!response.ok) return response;
    const parsed = parseJsonObject(response.text);
    if (!parsed) {
      return {
        ok: false,
        warning: unavailableWarning("ai_invalid_response", "Backend model returned invalid structured JSON."),
      };
    }
    return {
      ok: true,
      ...parsed,
      metadata: {
        provider: providerName,
        model,
        latencyMs,
        usage: response.usage || { inputTokens: 0, outputTokens: 0 },
      },
    };
  };

  return {
    publicConfig,
    classifyIntent(input = {}) {
      return requestStructured({
        system: INTENT_SYSTEM,
        payload: {
          message: String(input.message || ""),
          selectedContextKeys: Array.isArray(input.selectedContextKeys) ? input.selectedContextKeys : [],
          projectContext: input.projectContext || {},
        },
        maxTokens: 300,
      });
    },
    draftAnalysisPlan(input = {}) {
      return requestStructured({
        system: ANALYSIS_PLAN_SYSTEM,
        payload: input,
        maxTokens: 2400,
      });
    },
    answerReadOnly(input = {}) {
      return requestStructured({
        system: "Answer a LabRat read-only project question as JSON with an answer field. Use only supplied accepted evidence.",
        payload: input,
        maxTokens: 800,
      });
    },
  };
}
