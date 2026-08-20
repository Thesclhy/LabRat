import { createAiGateway } from "../ai/gateway.js";
import { SUPPORTED_CHART_TYPES } from "../charts/services/chartSpec.js";
import { ANALYSIS_SOURCE_RANGE_MAX_CELLS } from "./sourceDocuments.js";

const INSPECT_SOURCE_RANGE_DESCRIPTION = [
  `Read at most ${ANALYSIS_SOURCE_RANGE_MAX_CELLS} cells from one user-confirmed workbook region.`,
  "Call repeatedly with smaller ranges when needed.",
].join(" ");

const INTENT_SYSTEM = [
  "Classify one LabRat research-workflow message.",
  "Return JSON only with intent, disposition, confidence, and clarification.",
  "Allowed intents: project_purpose, project_overview, experiment_overview, experiment_compare,",
  "experiment_lookup, open_or_filter_browser, upload_workbook, create_analysis_chart, publish_experiment_data,",
  "manuscript_action, clarification.",
  "Allowed dispositions: direct_answer, analysis_thread, action, clarification.",
  "Derived calculations, trends, comparisons, statistics, and charts use analysis_thread.",
  "Use publish_experiment_data with analysis_thread when the user wants to add, derive, replace, or publish scientific fields, series, or experiment records in Experiment Browser.",
  "The selectedContext activeSurface is a weak hint, not an instruction: ordinary questions on the Browser surface must still be answered or classified by their actual intent.",
  "Hiding, showing, sorting, filtering, or reordering existing Browser columns is display state, not publish_experiment_data.",
  "Chart and plot requests use create_analysis_chart even when the active surface is Experiment Browser.",
  "Never return hidden reasoning or scientific values.",
].join(" ");

const INTENT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "project_purpose",
        "project_overview",
        "experiment_overview",
        "experiment_compare",
        "experiment_lookup",
        "open_or_filter_browser",
        "upload_workbook",
        "create_analysis_chart",
        "publish_experiment_data",
        "manuscript_action",
        "clarification",
      ],
    },
    disposition: {
      type: "string",
      enum: ["direct_answer", "analysis_thread", "action", "clarification"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    clarification: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["intent", "disposition", "confidence", "clarification"],
  additionalProperties: false,
};

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
  "Return exactly {requestSummary, sourceSelections, experimentSelections, reviewPlan, displayPlan, warnings}.",
  "Select only cells inside supplied user-confirmed workbook regions and fields from supplied active experiments.",
  "Use inspect_source_range whenever the supplied summaries and column metadata are insufficient to identify the exact rows or columns.",
  "Each source selection must name one confirmed region revision, its exact sourceDocumentId, sheetName, and a rectangular Excel range inside that confirmed region.",
  "Multiple files, sheets, or non-contiguous ranges must be separate sourceSelections.",
  "Each experimentSelection identifies one existing experimentId and exact zero-based columnIndexes from that experiment's ordered fields list in activeExperimentCatalog.",
  "For chart requests, inputMode is authoritative: experiment_browser requires experimentSelections and an empty sourceSelections array; workbook requires sourceSelections and an empty experimentSelections array.",
  "Never mix workbook ranges and Experiment Browser selections in one chart plan.",
  "Use displayName, unit, valueType, and sourceSummary to distinguish duplicate readable column names; never request or return internal Browser column ids.",
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
    experimentSelections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          experimentId: { type: "string" },
          columnIndexes: { type: "array", items: { type: "integer" } },
          includeSeries: { type: "boolean" },
          purpose: { type: "string" },
        },
        required: ["experimentId", "columnIndexes", "includeSeries", "purpose"],
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
  required: [
    "requestSummary",
    "sourceSelections",
    "experimentSelections",
    "reviewPlan",
    "displayPlan",
    "warnings",
  ],
  additionalProperties: false,
};

const ANALYSIS_PROGRAM_SYSTEM = [
  "Write one deterministic LabRat Python analysis program as JSON only.",
  "Return exactly {pythonProgram:{runtime,entrypoint,source}}.",
  "The entrypoint must be def analyze(inputs, labrat).",
  "inputs is a dictionary containing ordered inputs['tables'] and inputs['experiments'] lists.",
  "Each table contains tableId, sourceSelectionId, source metadata, startRow, startColumn, rowCount, columnCount, values, displayValues, and formulas.",
  "Each experiment contains experimentId, label, aliases, activeHead, ordered fields, and series. Select scalar fields only by their zero-based columnIndex.",
  "inspect_run_input and inspect_experiment_input are code-generation tools only. Use them before returning source when inputs are large.",
  "Generated Python cannot call inspect_run_input, inspect_experiment_input, or methods with those names on labrat; it must read the supplied inputs dictionary directly.",
  "Use the accepted natural-language review plan exactly; do not change the selected data or calculation meaning.",
  "Selected active experiment fields may contain value null plus missingReason. Treat null as missing scientific data: skip it by default and report the missing count.",
  "Never convert a missing value to zero. Do not interpolate, fill, or impute missing values unless the accepted review plan explicitly requires that exact operation.",
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

const EXPERIMENT_BROWSER_PLAN_SYSTEM = [
  "Draft one reviewable LabRat Experiment Browser data plan as JSON only.",
  "Return exactly {requestSummary, sourceSelections, experimentSelections, reviewPlan, displayPlan, warnings}.",
  "Select only cells inside supplied user-confirmed workbook regions and fields from supplied active experiments.",
  "Use inspect_source_range whenever summaries are insufficient to identify exact workbook rows or columns.",
  "Each workbook selection must be the smallest rectangular range containing the labels, headers, and values needed.",
  "When displayPlan or processingSteps states a record or point count, count actual non-header data rows from inspected cells; never infer measurements from rectangular range dimensions.",
  "experimentSelections are calculation inputs only: each identifies an existing experimentId and exact zero-based columnIndexes from that experiment's ordered fields list in activeExperimentCatalog.",
  "Never put a desired new workbook field or an internal Browser column id in experimentSelections.",
  "Requests naming a workbook, worksheet, Excel column, or new source field must use sourceSelections. Verify explicit column letters and names by inspecting the confirmed region.",
  "Use the supplied activeExperimentCatalog to distinguish creating new experiment records from appending or replacing fields on existing records, and state that distinction in reviewPlan.processingSteps and experimentOutput.summary.",
  "reviewPlan.processingSteps describes experiment identification, cleanup, reshaping, calculations, missing-value handling, and whether fields are added or replaced.",
  "Inspect source cells when needed to identify blanks and placeholders. State the exact missing-value count when it is visible from the selected source; otherwise state how missing values will be represented and counted in the result.",
  "Source blanks and placeholders such as -, --, —, N/A, and NA remain selected source-backed null fields. Do not plan to convert them to zero or exclude the whole experiment.",
  "reviewPlan.experimentOutput.summary explains the scientific data changes without internal ids.",
  "reviewPlan.browserView.summary explains which readable columns will be visible and how the result will be sorted or filtered.",
  "displayPlan contains concise sentences a researcher can review.",
  "Do not write Python, calculate final values, return internal hashes, or embed workbook values.",
  "Do not request scientific field deletion; users hide columns through BrowserView.",
  "Return reviewPlan.invariants as an empty array; Experiment Browser result validation uses source-backed record patch rules.",
  "If repairContext is supplied, correct every listed validation error.",
].join(" ");

const EXPERIMENT_BROWSER_PLAN_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    requestSummary: { type: "string" },
    sourceSelections: ANALYSIS_PLAN_OUTPUT_SCHEMA.properties.sourceSelections,
    experimentSelections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          experimentId: { type: "string" },
          columnIndexes: { type: "array", items: { type: "integer" } },
          includeSeries: { type: "boolean" },
          purpose: { type: "string" },
        },
        required: ["experimentId", "columnIndexes", "includeSeries", "purpose"],
        additionalProperties: false,
      },
    },
    reviewPlan: {
      type: "object",
      properties: {
        processingSteps: { type: "array", items: { type: "string" } },
        missingValueHandling: { type: "string" },
        experimentOutput: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
        browserView: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
        invariants: {
          type: "array",
          items: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      },
      required: [
        "processingSteps",
        "missingValueHandling",
        "experimentOutput",
        "browserView",
        "invariants",
      ],
      additionalProperties: false,
    },
    displayPlan: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "requestSummary",
    "sourceSelections",
    "experimentSelections",
    "reviewPlan",
    "displayPlan",
    "warnings",
  ],
  additionalProperties: false,
};

const EXPERIMENT_BROWSER_PROGRAM_SYSTEM = [
  "Write one deterministic LabRat Experiment Browser Python program as JSON only.",
  "Return exactly {pythonProgram:{runtime,entrypoint,source}}.",
  "The entrypoint must be def analyze(inputs, labrat).",
  "inputs is a dictionary. inputs['tables'] and inputs['experiments'] are always lists, never dictionaries keyed by ID.",
  "To access one table or experiment by ID, first build dictionaries such as tables_by_id = {item['tableId']: item for item in inputs['tables']} and experiments_by_id = {item['experimentId']: item for item in inputs['experiments']}.",
  "Each table contains tableId, source, startRow, startColumn, rowCount, columnCount, columns, values, displayValues, and formulas. columns is an ordered metadata list; values/displayValues/formulas are row-major lists of lists addressed by zero-based offsets.",
  "Each experiment contains experimentId, label, aliases, activeHead, fields, and series. fields is an ordered list whose columnIndex is the only model-facing scalar selector.",
  "inspect_run_input and inspect_experiment_input are code-generation tools only. Use them before returning source when inputs are large.",
  "Generated Python cannot call either inspection tool or methods with those names on labrat; it must read inputs['tables'] and inputs['experiments'] directly.",
  "Follow the accepted natural-language plan exactly.",
  "Return exactly {'columns': [...], 'recordPatches': [...], 'exclusions': [...]} from analyze.",
  "columns, recordPatches, values, upsertSeries, removeSeries, warnings, and exclusions must be lists, never dictionaries keyed by field or series ID.",
  "Each top-level scalar column is exactly {'displayName': str, 'valueType': 'number'|'string'|'date'|'boolean', 'unit': str_or_None, and optional 'numericScale': 'percent_points'|'fraction'|None copied from accepted input metadata}.",
  "Do not output semanticKey, fieldKey, role, targetFieldId, or columnId. The backend assigns an internal random columnId after validation.",
  "Every columns[] item is an independent new Browser column. Duplicate display names, units, and value types are allowed and must not be merged with prior columns.",
  "Each record patch requires {'label': str, 'values': [...], 'upsertSeries': [...], 'removeSeries': [], 'warnings': [...]}.",
  "Each scalar value is exactly {'columnIndex': int, 'value': value_or_None, 'formattedValue': str_or_None, 'confidence': number, 'warnings': [...], 'sources': [...]}, plus missingReason only when value is None.",
  "columnIndex is the zero-based index into the output columns list and must not refer to a source-table column.",
  "Use recordPatches[].label as experiment identity. Do not also output Label, Experiment, Experiment ID, or Experiment Label as scientific fields.",
  "Do not output complete replacement records and do not upsert an existing field merely to preserve it. Unmentioned existing fields and series are preserved by the backend.",
  "For direct workbook imports, choose a readable displayName from the source header. String categories such as impeller names remain ordinary string values and require no enum declaration.",
  "Every scalar field may use value None only for explicit missing scientific data. A missing scalar must also use formattedValue None and missingReason equal to source_blank, source_placeholder, or calculation_unavailable.",
  "Treat an em dash as a source placeholder.",
  "Use source_blank only when the cited source cell is empty. Use source_placeholder only when the cited source cell is -, --, —, N/A, or NA. Use calculation_unavailable only when the accepted plan allows a calculation but required cited input is missing.",
  "Do not output zero, a placeholder string, NaN, or Infinity for missing data. Do not exclude an entire experiment merely because one selected scalar is missing.",
  "A non-missing scalar must not contain missingReason. Numeric values must be finite numbers; zero remains a real numeric zero.",
  "Every missing scalar must cite the exact missing workbook cell or selected active field so the backend can preserve its raw source evidence.",
  "Each upsertSeries item must be exactly shaped as {'seriesKey': str, 'label': str, 'xField': str, 'yField': str, 'xUnit': str_or_None, 'yUnit': str_or_None, 'points': [...], 'warnings': [...], 'sources': [...]}.",
  "Each series point must be {'x': string_or_number, 'y': finite_number, 'sources': [...]}. Do not use fieldKey/displayName/xLabel/yLabel for series.",
  "Every scalar, series, and series point requires sources. A workbook source is {tableId,rowOffset,columnOffset}; an accepted field source is {experimentId,columnIndex}.",
  "removeSeries must be empty because scientific deletion is not enabled.",
  "Do not output Browser view state. The backend creates a view that shows every new scalar column.",
  "Use only inputs and labrat. Do not access files, URLs, environment state, processes, network resources, random, time, or process-dependent hashes.",
  "Use deterministic ordering and Python literals None, True, and False. Do not print workbook data.",
  "Keep source under 180 non-blank lines. Prefer one reusable loop over rows and columns; never emit one statement per experiment, cell, or output value.",
  "Do not embed workbook rows, experiment values, output records, or repeated column definitions as Python literals. Read all values from inputs at runtime.",
  "Return only the program object required by the schema, with no explanation, markdown, commented walkthrough, or duplicated implementation.",
  "If repairContext is supplied, correct every listed policy or output-contract error.",
].join(" ");

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

export function createBackendModelProvider({
  config = {},
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const gateway = createAiGateway({ config, fetchImpl, now });
  const publicConfig = gateway.publicConfig;
  const requestStructured = gateway.requestStructured;
  const requestStructuredWithTools = gateway.requestStructuredWithTools;

  return {
    publicConfig,
    classifyIntent(input = {}, options = {}) {
      return requestStructured({
        system: INTENT_SYSTEM,
        payload: {
          message: String(input.message || ""),
          selectedContextKeys: Array.isArray(input.selectedContextKeys) ? input.selectedContextKeys : [],
          selectedContext: input.selectedContext || {},
          projectContext: input.projectContext || {},
        },
        maxTokens: 300,
        outputSchema: INTENT_OUTPUT_SCHEMA,
        thinking: { enabled: false },
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
          description: INSPECT_SOURCE_RANGE_DESCRIPTION,
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
        thinking: { enabled: true, effort: "high" },
        signal: options.signal,
      });
    },
    draftAnalysisProgram(input = {}, options = {}) {
      return requestStructuredWithTools({
        system: ANALYSIS_PROGRAM_SYSTEM,
        payload: input,
        maxTokens: 6400,
        maxToolRounds: 6,
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
        }, {
          name: "inspect_experiment_input",
          description: "Read one page of selected fields from one accepted active experiment input.",
          input_schema: {
            type: "object",
            properties: {
              experimentId: { type: "string" },
              fieldOffset: { type: "integer", minimum: 0 },
              fieldLimit: { type: "integer", minimum: 1, maximum: 500 },
              includeSeries: { type: "boolean" },
            },
            required: ["experimentId", "fieldOffset", "fieldLimit", "includeSeries"],
            additionalProperties: false,
          },
        }],
        toolHandlers: {
          inspect_run_input: options.inspectRunInput,
          inspect_experiment_input: options.inspectExperimentInput,
        },
        thinking: { enabled: true, effort: "high" },
        signal: options.signal,
      });
    },
    draftExperimentBrowserPlan(input = {}, options = {}) {
      return requestStructuredWithTools({
        system: EXPERIMENT_BROWSER_PLAN_SYSTEM,
        payload: input,
        maxTokens: 16000,
        truncationRetryMaxTokens: 32000,
        outputSchema: EXPERIMENT_BROWSER_PLAN_OUTPUT_SCHEMA,
        tools: [{
          name: "inspect_source_range",
          description: INSPECT_SOURCE_RANGE_DESCRIPTION,
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
        thinking: { enabled: false },
        signal: options.signal,
      });
    },
    draftExperimentBrowserProgram(input = {}, options = {}) {
      return requestStructuredWithTools({
        system: EXPERIMENT_BROWSER_PROGRAM_SYSTEM,
        payload: input,
        maxTokens: 6400,
        maxToolRounds: 4,
        outputSchema: ANALYSIS_PROGRAM_OUTPUT_SCHEMA,
        tools: [{
          name: "inspect_run_input",
          description: "Read one page from an exact accepted workbook table input.",
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
        }, {
          name: "inspect_experiment_input",
          description: "Read one page of selected fields from one accepted active experiment input.",
          input_schema: {
            type: "object",
            properties: {
              experimentId: { type: "string" },
              fieldOffset: { type: "integer", minimum: 0 },
              fieldLimit: { type: "integer", minimum: 1, maximum: 500 },
              includeSeries: { type: "boolean" },
            },
            required: ["experimentId", "fieldOffset", "fieldLimit", "includeSeries"],
            additionalProperties: false,
          },
        }],
        toolHandlers: {
          inspect_run_input: options.inspectRunInput,
          inspect_experiment_input: options.inspectExperimentInput,
        },
        thinking: { enabled: true, effort: "high" },
        signal: options.signal,
      });
    },
    async interpretWorkbookRegion(input = {}) {
      const result = await requestStructured({
        system: WORKBOOK_REGION_SYSTEM,
        payload: input,
        maxTokens: 3200,
        outputSchema: WORKBOOK_REGION_OUTPUT_SCHEMA,
        thinking: { enabled: false },
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
        thinking: { enabled: false },
        signal: options.signal,
      });
    },
  };
}
