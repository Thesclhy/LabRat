import {
  requestAnthropicJson,
  requestAnthropicJsonWithTools,
} from "../ai/anthropic.js";
import { SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";

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

const READ_ONLY_ANSWER_SYSTEM = [
  "Answer one LabRat project question as JSON only with answer and evidenceIds.",
  "Use only the supplied project profile, accepted region summaries, accepted experiment values, and artifact counts.",
  "Do not invent scientific values, methods, project purpose, units, mechanisms, or conclusions.",
  "Project-purpose and project-description questions should answer directly in the user's language.",
  "Do not propose navigation, create an action card, draft a chart, calculate new values, or claim that work will happen later.",
  "If accepted evidence is insufficient, state exactly what is missing.",
  "evidenceIds may contain only supplied evidenceId values that materially support the answer.",
  "Do not return hidden reasoning.",
].join(" ");

const READ_ONLY_ANSWER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "evidenceIds"],
  additionalProperties: false,
};

const ANALYSIS_PLAN_SYSTEM = [
  "Draft one reviewable LabRat analysis plan as JSON only.",
  "Return exactly {requestSummary, sourceSelections, reviewPlan, displayPlan, warnings}.",
  "Select only cells inside supplied user-confirmed workbook regions.",
  "Use inspect_source_range whenever the supplied summaries and column metadata are insufficient to identify the exact rows or columns.",
  "Each source selection must name one confirmed region revision, its exact sourceDocumentId, sheetName, and a rectangular Excel range inside that confirmed region.",
  "Multiple files, sheets, or non-contiguous ranges must be separate sourceSelections.",
  "Choose the smallest ranges that include the labels, headers, and values needed for the requested calculation.",
  "reviewPlan.processingSteps describes data cleanup, reshaping, calculations, sorting, missing-value handling, and chart construction.",
  "reviewPlan.chart contains a readable title, one supported chartType, xDescription, yDescription, and seriesDescription.",
  "Use result invariants only when the user explicitly requests normalization or another numeric sum constraint.",
  "Use trace_y_sum only when every selected trace must independently sum across all of its Y points to the target.",
  "Use x_group_y_sum when stacked or grouped component traces must sum to the target at each shared X category; include the exact readable trace names in traceNames.",
  "displayPlan contains concise sentences a researcher can review; explicitly state how selected data will be processed and what the chart will show.",
  "Do not write Python, calculate plotted values, return field ids, or embed workbook values in the plan.",
  "Do not return hashes, lineage ids, source rectangles, hidden reasoning, or any unconfirmed source.",
  "If repairContext is supplied, correct every listed selection or plan validation error.",
].join(" ");

const ANALYSIS_PLAN_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    requestSummary: { type: "string" },
    sourceSelections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          regionUnderstandingRevisionId: { type: "string" },
          sourceDocumentId: { type: "string" },
          sheetName: { type: "string" },
          range: { type: "string" },
          label: { type: "string" },
          purpose: { type: "string" },
        },
        required: [
          "regionUnderstandingRevisionId",
          "sourceDocumentId",
          "sheetName",
          "range",
          "label",
          "purpose",
        ],
        additionalProperties: false,
      },
    },
    reviewPlan: {
      type: "object",
      properties: {
        processingSteps: { type: "array", items: { type: "string" } },
        missingValueHandling: { type: "string" },
        chart: {
          type: "object",
          properties: {
            title: { type: "string" },
            chartType: { type: "string", enum: SUPPORTED_CHART_TYPES },
            xDescription: { type: "string" },
            yDescription: { type: "string" },
            seriesDescription: { type: "string" },
          },
          required: ["title", "chartType", "xDescription", "yDescription", "seriesDescription"],
          additionalProperties: false,
        },
        invariants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["trace_y_sum", "x_group_y_sum"] },
              traceName: { type: "string" },
              traceNames: {
                type: "array",
                items: { type: "string" },
              },
              target: { type: "number" },
              absoluteTolerance: { type: "number" },
            },
            required: ["type", "target", "absoluteTolerance"],
            additionalProperties: false,
          },
        },
      },
      required: ["processingSteps", "missingValueHandling", "chart", "invariants"],
      additionalProperties: false,
    },
    displayPlan: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["requestSummary", "sourceSelections", "reviewPlan", "displayPlan", "warnings"],
  additionalProperties: false,
};

const ANALYSIS_PROGRAM_SYSTEM = [
  "Write one deterministic LabRat Python analysis program as JSON only.",
  "Return exactly {pythonProgram:{runtime,entrypoint,source}}.",
  "The entrypoint must be def analyze(inputs, labrat).",
  "inputs is a dictionary containing inputs['tables'], an ordered list of exact workbook selections.",
  "Each table contains tableId, sourceSelectionId, source metadata, startRow, startColumn, rowCount, columnCount, values, displayValues, and formulas.",
  "Use inspect_run_input to inspect pages of large tables before writing code.",
  "Use the accepted natural-language review plan exactly; do not change the selected data or calculation meaning.",
  "Return {'plotly': {'data': [...], 'layout': {...}}, 'exclusions': [...], 'checks': [...]} from analyze.",
  "Plotly data is authoritative. Each trace must contain x and y arrays of equal length plus a readable name.",
  "Use Plotly bar or scatter traces and ordinary JSON-compatible layout properties. Do not return result tables, field ids, source record ids, or lineage sidecars.",
  "Exclusions contain label and reason. Backend validation recomputes every invariant declared in the accepted review plan; returned checks may be empty.",
  "Use only inputs and labrat. Do not read files, URLs, environment state, processes, or network resources.",
  "Use deterministic ordering and Python literals None, True, and False. Do not use uuid, random, time, datetime, or process-dependent hashes.",
  "Keep the program concise and do not print workbook data.",
  "If repairContext is supplied, correct every listed policy or output-contract error.",
].join(" ");

const ANALYSIS_PROGRAM_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    pythonProgram: {
      type: "object",
      properties: {
        runtime: { type: "string", enum: ["labrat-python-v2"] },
        entrypoint: { type: "string", enum: ["analyze"] },
        source: { type: "string" },
      },
      required: ["runtime", "entrypoint", "source"],
      additionalProperties: false,
    },
  },
  required: ["pythonProgram"],
  additionalProperties: false,
};

const WORKBOOK_REGION_SYSTEM = [
  "Explain one bounded Excel region as JSON only.",
  "Return exactly {summary, interpretation}.",
  "summary is an array of two to four short sentences describing what the selected table contains.",
  "interpretation is a sparse correction patch for only the supplied region.",
  "Do not repeat deterministicCandidate fields unless correcting them; use fieldPatches for changed columns only.",
  "The structured response requires every patch property; use an empty string, zero, or an empty array when that property is unchanged.",
  "Each field patch requires every property; use an empty string for an unchanged field property.",
  "The backend preserves deterministic fields, series, and row inclusion unless this core patch changes their inputs.",
  "Use complete identityEvidence exactly when describing experiment counts or first and last identifiers.",
  "Do not infer experiment counts, identifier ranges, or whole-table numeric ranges from the bounded inspection sample.",
  "Use only supplied cells, formulas, merged ranges, workbook metadata, prior visible interpretation, and user feedback.",
  "Never invent source cells, scientific values, units, or experiment identities, and never return hidden reasoning.",
  "Do not return source hashes or request additional workbook data.",
].join(" ");

const WORKBOOK_REGION_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "array",
      items: { type: "string" },
    },
    interpretation: {
      type: "object",
      properties: {
        semanticType: {
          type: "string",
          enum: [
            "",
            "experiment_table",
            "reaction_rate_time_series",
            "component_distribution",
            "calculation_table",
            "metadata_notes",
            "generic_table",
            "ignored_region",
            "unknown_region",
          ],
        },
        experimentAxis: { type: "string", enum: ["", "rows", "region"] },
        headerRow: { type: "integer" },
        experimentIdColumn: { type: "string" },
        experimentLabel: { type: "string" },
        fieldPatches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              semanticKey: { type: "string" },
              displayName: { type: "string" },
              role: { type: "string", enum: ["", "identifier", "condition", "outcome", "series_summary", "other"] },
              valueType: { type: "string", enum: ["", "string", "number", "date", "boolean"] },
              unit: { type: "string" },
            },
            required: ["column", "semanticKey", "displayName", "role", "valueType", "unit"],
            additionalProperties: false,
          },
        },
        confidence: { type: "number" },
      },
      required: [
        "semanticType",
        "experimentAxis",
        "headerRow",
        "experimentIdColumn",
        "experimentLabel",
        "fieldPatches",
        "confidence",
      ],
      additionalProperties: false,
    },
  },
  required: ["summary", "interpretation"],
  additionalProperties: false,
};

function normalizeWorkbookRegionPatch(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const patch = {};
  for (const property of ["semanticType", "experimentAxis", "experimentIdColumn", "experimentLabel"]) {
    const normalized = String(source[property] ?? "").trim();
    if (normalized) patch[property] = normalized;
  }
  const headerRow = Number(source.headerRow);
  if (Number.isInteger(headerRow) && headerRow > 0) patch.headerRow = headerRow;
  const confidence = Number(source.confidence);
  if (Number.isFinite(confidence) && confidence > 0) patch.confidence = confidence;
  const fieldPatches = (Array.isArray(source.fieldPatches) ? source.fieldPatches : []).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const column = String(candidate.column ?? "").trim().toUpperCase();
    if (!column) return [];
    const fieldPatch = { column };
    for (const property of ["semanticKey", "displayName", "role", "valueType", "unit"]) {
      const normalized = String(candidate[property] ?? "").trim();
      if (normalized) fieldPatch[property] = normalized;
    }
    return [fieldPatch];
  });
  if (fieldPatches.length) patch.fieldPatches = fieldPatches;
  return patch;
}

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

  const requestStructured = async ({ system, payload, maxTokens = 1200, outputSchema = null, signal = undefined }) => {
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
      outputSchema,
      config: { apiKey, model },
      fetchImpl,
      signal,
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
        ...(response.stopReason ? { stopReason: response.stopReason } : {}),
      },
    };
  };

  const requestStructuredWithTools = async ({
    system,
    payload,
    maxTokens,
    outputSchema,
    tools,
    toolHandlers,
    signal,
  }) => {
    if (providerName !== "anthropic") {
      return {
        ok: false,
        warning: unavailableWarning("ai_provider_unsupported", `Unsupported backend model provider ${providerName}.`),
      };
    }
    if (!apiKey) return { ok: false, warning: unavailableWarning() };
    const startedAt = now();
    const response = await requestAnthropicJsonWithTools({
      system,
      prompt: JSON.stringify(payload),
      tools,
      toolHandlers,
      maxTokens,
      outputSchema,
      config: { apiKey, model },
      fetchImpl,
      signal,
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
        toolRounds: Number(response.toolRounds) || 0,
        ...(response.stopReason ? { stopReason: response.stopReason } : {}),
      },
    };
  };

  return {
    publicConfig,
    classifyIntent(input = {}, options = {}) {
      return requestStructured({
        system: INTENT_SYSTEM,
        payload: {
          message: String(input.message || ""),
          selectedContextKeys: Array.isArray(input.selectedContextKeys) ? input.selectedContextKeys : [],
          projectContext: input.projectContext || {},
        },
        maxTokens: 300,
        signal: options.signal,
      });
    },
    draftAnalysisPlan(input = {}, options = {}) {
      return requestStructuredWithTools({
        system: ANALYSIS_PLAN_SYSTEM,
        payload: input,
        maxTokens: 6400,
        outputSchema: ANALYSIS_PLAN_OUTPUT_SCHEMA,
        tools: [{
          name: "inspect_source_range",
          description: "Read at most 500 cells from one user-confirmed workbook region. Call repeatedly with smaller ranges when needed.",
          input_schema: {
            type: "object",
            properties: {
              regionUnderstandingRevisionId: { type: "string" },
              range: { type: "string" },
            },
            required: ["regionUnderstandingRevisionId", "range"],
            additionalProperties: false,
          },
        }],
        toolHandlers: {
          inspect_source_range: options.inspectSourceRange,
        },
        signal: options.signal,
      });
    },
    draftAnalysisProgram(input = {}, options = {}) {
      return requestStructuredWithTools({
        system: ANALYSIS_PROGRAM_SYSTEM,
        payload: input,
        maxTokens: 6400,
        outputSchema: ANALYSIS_PROGRAM_OUTPUT_SCHEMA,
        tools: [{
          name: "inspect_run_input",
          description: "Read one page from the exact accepted multi-table Python input.",
          input_schema: {
            type: "object",
            properties: {
              tableId: { type: "string" },
              rowOffset: { type: "integer", minimum: 0 },
              rowLimit: { type: "integer", minimum: 1, maximum: 200 },
              columnOffset: { type: "integer", minimum: 0 },
              columnLimit: { type: "integer", minimum: 1, maximum: 100 },
            },
            required: ["tableId", "rowOffset", "rowLimit", "columnOffset", "columnLimit"],
            additionalProperties: false,
          },
        }],
        toolHandlers: {
          inspect_run_input: options.inspectRunInput,
        },
        signal: options.signal,
      });
    },
    async interpretWorkbookRegion(input = {}) {
      const result = await requestStructured({
        system: WORKBOOK_REGION_SYSTEM,
        payload: input,
        maxTokens: 3200,
        outputSchema: WORKBOOK_REGION_OUTPUT_SCHEMA,
      });
      if (!result.ok) return result;
      return {
        ...result,
        interpretation: normalizeWorkbookRegionPatch(result.interpretation),
      };
    },
    answerReadOnly(input = {}, options = {}) {
      return requestStructured({
        system: READ_ONLY_ANSWER_SYSTEM,
        payload: input,
        maxTokens: 800,
        outputSchema: READ_ONLY_ANSWER_OUTPUT_SCHEMA,
        signal: options.signal,
      });
    },
  };
}
