import { aiUnavailableWarning, requestAnthropicJson } from "../../ai/anthropic.js";
import { buildGenericImportContext } from "../../import/services/genericImportContext.js";
import { shapeChartInterpretResponse } from "../schemas/chartInterpretSchemas.js";
import {
  chartAliasesForField,
  compileChartSpec,
  componentOrder,
  measurementFamily,
  normalizeChartType,
  normalizeText,
  selectivityComponent,
} from "./chartSpec.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function textTokens(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value)))];
}

function acceptedMappingBySource(mappingSets) {
  const map = new Map();
  asArray(mappingSets).forEach((set) => {
    asArray(set?.mappings).forEach((mapping) => {
      if (mapping?.status !== "accepted" && mapping?.status !== "accepted_draft") return;
      asArray(mapping.sourceIds).forEach((sourceId) => {
        map.set(sourceId, mapping);
      });
    });
  });
  return map;
}

function fieldRole(field) {
  if (field.fieldRole) return field.fieldRole;
  if (field.semanticRole === "identifier") return "identifier";
  if (field.semanticRole === "condition" || field.semanticRole === "time") return "condition";
  if (field.targetKind === "measurement") return "measurement";
  return "metadata";
}

function enrichField(field, mappingBySourceId) {
  const mapping = asArray(field.sourceIds).map((sourceId) => mappingBySourceId.get(sourceId)).find(Boolean);
  const role = mapping?.targetKind === "measurement" ? "measurement" : fieldRole(field);
  const displayName = mapping?.rawLabel || field.displayName || field.field;
  const canonicalField = mapping?.canonicalField || field.canonicalField || field.field;
  const semanticRole = mapping?.semanticRole || field.semanticRole || role;
  const enriched = {
    ...field,
    displayName,
    canonicalField,
    semanticRole,
    role,
    mappingIds: mapping?.mappingId ? [mapping.mappingId] : [],
    measurementFamily: measurementFamily({ ...field, displayName, canonicalField }),
    measurementComponent: selectivityComponent({ ...field, displayName, canonicalField }),
    componentOrder: componentOrder({ ...field, displayName, canonicalField }),
  };
  return {
    ...enriched,
    aliases: unique([
      ...asArray(field.aliases),
      ...chartAliasesForField(enriched),
    ]),
  };
}

function buildChartFieldInventory(options) {
  const context = buildGenericImportContext(options);
  const mappingBySourceId = acceptedMappingBySource(options.mappingSets);
  const fields = [...context.measurementFields, ...context.metadataFields]
    .map((field) => enrichField(field, mappingBySourceId));
  return {
    ...context,
    fields,
    measurements: fields.filter((field) => field.role === "measurement"),
    conditions: fields.filter((field) => field.role === "condition"),
    materials: fields.filter((field) => field.role === "material"),
    identifiers: fields.filter((field) => field.role === "identifier"),
    metadata: fields.filter((field) => !["measurement", "condition", "material", "identifier"].includes(field.role)),
  };
}

function parseAiJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    return null;
  }
}

function phraseAfter(prompt, patterns) {
  const text = normalizeText(prompt);
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function firstText(...values) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function normalizeColumnHint(value) {
  const match = String(value || "").trim().match(/\b(?:column|col)?\s*([a-z]{1,3})\b/i);
  return match ? match[1].toUpperCase() : "";
}

function stripColumnHint(value) {
  return normalizeText(value)
    .replace(/\b(?:column|col)\s+[a-z]{1,3}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function axisRequestFromText(prompt, axis) {
  const text = normalizeText(prompt);
  const otherAxis = axis === "x" ? "y" : "x";
  const patterns = [
    new RegExp(`\\b${axis}\\s*axis\\s*(?:is|=|:|should be|should use|uses)?\\s*([a-z0-9 ]+?)(?=\\b(?:the\\s+)?${otherAxis}\\s*axis\\b|\\band\\b|\\bwhere\\b|\\bfor\\b|$)`),
    new RegExp(`\\buse\\s+([a-z0-9 ]+?)\\s+as\\s+(?:the\\s+)?${axis}\\s*axis\\b`),
    new RegExp(`\\b([a-z0-9 ]+?)\\s+as\\s+(?:the\\s+)?${axis}\\s*axis\\b`),
  ];
  const directColumn = text.match(new RegExp(`\\b(?:column|col)\\s+([a-z]{1,3})\\s+(?:should be|as|for|is)?\\s*(?:the\\s+)?${axis}\\b`));
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return {
        fieldAlias: stripColumnHint(match[1]),
        columnHint: normalizeColumnHint(match[1]) || normalizeColumnHint(directColumn?.[1]),
      };
    }
  }
  return {
    fieldAlias: "",
    columnHint: normalizeColumnHint(directColumn?.[1]),
  };
}

function wantsNormalizeToPercent(text) {
  return /\b(normalize|normalise|normalized|normalised)\b/.test(text)
    || /\b(rescale|rescaled|scale|scaled)\b.*\b(100|percent|percentage)\b/.test(text)
    || /\b(sum|total)\b.*\b(100|percent|percentage)\b/.test(text)
    || /\bproportionally\b.*\b(100|percent|percentage)\b/.test(text);
}

function wantsLogScale(prompt, axis = "y") {
  const text = normalizeText(prompt);
  return new RegExp(`\\b${axis}\\s*axis\\b[\\s\\S]*\\blog(?:\\s*base\\s*10|10)?\\b`).test(text)
    || new RegExp(`\\blog(?:\\s*base\\s*10|10)?\\b[\\s\\S]*\\b${axis}\\s*axis\\b`).test(text);
}

function wantsExcelLikeStyle(prompt) {
  const text = normalizeText(prompt);
  return /\b(excel|workbook)\b/.test(text) && /\b(aesthetic|style|replicate|copy|match|graph|chart)\b/.test(text);
}

function wantsMarkersOnly(prompt) {
  const text = normalizeText(prompt);
  return /\bmarkers? only\b/.test(text)
    || /\bpoints? only\b/.test(text)
    || /\bno (?:connecting )?lines?\b/.test(text)
    || /\bwithout (?:connecting )?lines?\b/.test(text)
    || /\bno line connection\b/.test(text)
    || /\bdo not connect\b/.test(text);
}

function wantsOpenMarkers(prompt) {
  const text = normalizeText(prompt);
  return /\bhollow (?:markers?|points?|circles?)\b/.test(text)
    || /\bopen (?:markers?|points?|circles?)\b/.test(text)
    || /\bempty (?:markers?|points?|circles?)\b/.test(text)
    || /\bunfilled (?:markers?|points?|circles?)\b/.test(text);
}

function deterministicRenderStyle(prompt) {
  const excelLike = wantsExcelLikeStyle(prompt);
  const markersOnly = wantsMarkersOnly(prompt);
  const openMarkers = wantsOpenMarkers(prompt);
  if (!excelLike && !markersOnly && !openMarkers) return {};
  return {
    ...(excelLike ? {
      preset: "excel_like",
      showLegend: false,
      grid: { x: true, y: true, color: "#d9d9d9" },
    } : {}),
    traceMode: markersOnly ? "markers" : excelLike ? "lines+markers" : undefined,
    traces: [{
      target: "primary",
      ...(excelLike && !markersOnly ? { line: { color: "#4472C4", width: 2 } } : {}),
      marker: {
        ...(excelLike ? { color: "#4472C4", size: 6 } : {}),
        ...(openMarkers ? { symbol: "circle-open" } : excelLike ? { symbol: "circle" } : {}),
      },
    }],
  };
}

function deterministicIntent(prompt) {
  const text = normalizeText(prompt);
  const wantsDistribution = /\b(c number|cnumber|c-number|carbon number|carbon distribution|hydrocarbon distribution|c\d+\s*(?:to|-)\s*c\d+)\b/.test(text);
  const wantsNormalize = wantsNormalizeToPercent(text);
  const wantsStack = /\b(stacked|stack)\b/.test(text);
  const wantsGrouped = /\b(grouped bar|grouped bars|group bar|group bars)\b/.test(text);
  const wantsPoint = /\b(point|dot)\b/.test(text);
  const axisXRequest = axisRequestFromText(prompt, "x");
  const axisYRequest = axisRequestFromText(prompt, "y");
  const chartType = wantsDistribution ? "distribution_bar"
    : wantsStack ? "stacked_bar"
    : wantsGrouped ? "grouped_bar"
      : /\bbar(?:s| chart| plot)?\b|\bcolumn (?:chart|plot)\b/.test(text) ? "bar"
        : wantsPoint ? "point"
          : /\b(line|time series)\b/.test(text) ? "scatter"
            : "scatter";
  const groupByAlias = phraseAfter(text, [
    /\bgroup(?:ed)? by ([a-z0-9 ]+?)(?:\bwhere\b|\bfilter\b|$)/,
    /\bcolor(?:ed)? by ([a-z0-9 ]+?)(?:\bwhere\b|\bfilter\b|$)/,
  ]);
  const xFieldAlias = axisXRequest.fieldAlias || phraseAfter(text, [
    /\bvs ([a-z0-9 ]+?)(?:\bfor\b|\bin\b|\bof\b|\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|\bby\b|$)/,
    /\bversus ([a-z0-9 ]+?)(?:\bfor\b|\bin\b|\bof\b|\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|\bby\b|$)/,
    /\bagainst ([a-z0-9 ]+?)(?:\bfor\b|\bin\b|\bof\b|\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|\bby\b|$)/,
    /\bover ([a-z0-9 ]+?)(?:\bfor\b|\bin\b|\bof\b|\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|\bby\b|$)/,
  ]);
  let yFieldAlias = axisYRequest.fieldAlias || phraseAfter(text, [
    /\bplot ([a-z0-9 ]+?)\b(?:vs|versus|against|over)\b/,
    /\bplot of ([a-z0-9 ]+?)\b(?:vs|versus|against|over)\b/,
    /\bplot ([a-z0-9 ]+?)\b(?:as|in)\b(?: a| an)?\b(?:bar|column|point|dot|scatter|line|chart|plot)\b/,
    /\bplot of ([a-z0-9 ]+?)\b(?:as|in)\b(?: a| an)?\b(?:bar|column|point|dot|scatter|line|chart|plot)\b/,
    /\b(?:make|create|draw) (?:a |an )?(?:bar|column|point|dot|scatter|line)? ?(?:chart|plot) of ([a-z0-9 ]+?)(?:\bby\b|\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|$)/,
    /\bshow ([a-z0-9 ]+?)\b(?:vs|versus|against|over|by)\b/,
    /\bcompare ([a-z0-9 ]+?)\b(?:vs|versus|against|over|by)\b/,
  ]);
  if (!yFieldAlias) {
    if (/\bgas\b/.test(text) && /\bselectivity\b/.test(text)) yFieldAlias = "gas selectivity";
    else if (/\bliquid\b/.test(text) && /\bselectivity\b/.test(text)) yFieldAlias = "liquid selectivity";
    else if (/\bsolid\b/.test(text) && /\bselectivity\b/.test(text)) yFieldAlias = "solid selectivity";
    else if (/\bselectivity\b/.test(text)) yFieldAlias = "selectivity";
    else if (/\bconversion\b/.test(text)) yFieldAlias = "conversion";
    else if (/\byield\b/.test(text)) yFieldAlias = "yield";
  }
  const wantsSelectivitySet = /\bselectivity\b/.test(text)
    && (/\bsolid\b/.test(text) && /\bliquid\b/.test(text) && /\bgas\b/.test(text)
      || /\bsolid liquid gas\b/.test(text)
      || /\ball selectivit/.test(text));
  const selectivitySetChartType = wantsStack ? "stacked_bar" : "grouped_bar";
  const mentionsExperimentAxis = /\b(by|per|across) (experiment|experiments|exp|run|runs|label)\b/.test(text);
  return {
    intentVersion: "labrat.chartIntent.v2",
    chartType: wantsSelectivitySet ? selectivitySetChartType : chartType,
    xFieldAlias: xFieldAlias || (wantsSelectivitySet || groupByAlias || mentionsExperimentAxis ? "experiment" : /\btemperature\b/.test(text) ? "temperature" : ""),
    xColumnHint: axisXRequest.columnHint,
    yFieldAlias,
    yColumnHint: axisYRequest.columnHint,
    yFieldAliases: wantsSelectivitySet ? ["solid selectivity", "liquid selectivity", "gas selectivity"] : [],
    groupByAlias,
    filters: [],
    transformIntent: wantsNormalize ? "normalize_sum_to_percent" : "",
    axisOptions: {
      x: { scale: "linear" },
      y: { scale: wantsLogScale(prompt, "y") ? "log10" : "linear" },
    },
    renderStyle: deterministicRenderStyle(prompt),
    title: "",
    rationale: "Parsed deterministically from the chart prompt.",
  };
}

function columnFromCellRef(value) {
  const match = String(value || "").toUpperCase().match(/\$?([A-Z]{1,3})\$?\d+/);
  return match ? match[1] : "";
}

function sourceColumnsForField(field, inventory) {
  return unique(asArray(field.sourceRefs).flatMap((sourceRef) => {
    const source = inventory.sourcesByRef?.get?.(sourceRef) || {};
    return [
      columnFromCellRef(source.cell),
      columnFromCellRef(source.range),
      columnFromCellRef(source.cellRange),
    ];
  }));
}

function compactInventory(inventory) {
  return inventory.fields.map((field) => ({
    fieldId: field.fieldId,
    displayName: field.displayName,
    field: field.field,
    canonicalField: field.canonicalField,
      role: field.role,
      semanticRole: field.semanticRole,
      measurementFamily: field.measurementFamily || null,
      measurementComponent: field.measurementComponent || null,
      aliases: field.aliases,
      valueType: field.valueType,
      unit: field.unit,
    numericCount: field.numericCount,
    coverageCount: field.coverageCount,
    examples: field.examples,
    sourceColumns: sourceColumnsForField(field, inventory),
  }));
}

async function aiIntent(prompt, inventory, options) {
  const ai = await requestAnthropicJson({
    system: [
      "You convert a user's chart request into ChartIntent v2 JSON for LabRat.",
      "Use only aliases from the field inventory. Do not invent fields or values.",
      "Do not return Plotly code or JavaScript.",
      "Return JSON with intentVersion, chartType, data.x/data.y/data.yFields, filters, encoding.axes, encoding.traceMode, transforms, style, title, rationale, confidence.",
      "For hollow/open/unfilled markers with no connecting lines, return encoding.traceMode='markers' and style.traces[0].marker.symbol='circle-open'.",
    ].join(" "),
    prompt: JSON.stringify({
      prompt,
      fields: compactInventory(inventory),
      allowedChartTypes: ["scatter", "point", "bar", "grouped_bar", "stacked_bar", "distribution_bar"],
      allowedTransforms: ["normalize_sum_to_percent", "percent_of_total", "ratio", "difference", "log10_transform"],
      allowedAxisScales: ["linear", "log10"],
      responseShape: {
        intentVersion: "labrat.chartIntent.v2",
        chartType: "scatter",
        data: {
          x: { fieldAlias: "reaction time", columnHint: "F", unitHint: "min" },
          y: { fieldAlias: "adjusted rate", columnHint: "H", unitHint: "M/s" },
          yFields: [],
          filters: [{ fieldAlias: "experiment", operator: "equals", value: "Exp30" }],
        },
        encoding: {
          traceMode: "markers",
          axes: {
            x: { scale: "linear", title: "Reaction Time (min)" },
            y: { scale: "log10", title: "Adjusted Rate (M/s)" },
          },
        },
        transforms: [],
        style: {
          preset: "excel_like",
          showLegend: false,
          grid: { x: true, y: true },
          traces: [{ target: "primary", line: { color: "#4472C4", width: 2 }, marker: { color: "#4472C4", size: 6, symbol: "circle-open" } }],
        },
        rationale: "why this chart matches the request",
        confidence: 0.85,
      },
    }),
    maxTokens: 1000,
    env: options.env,
    fetchImpl: options.fetchImpl,
  });
  if (!ai.ok) return { intent: null, warning: ai.warning || aiUnavailableWarning() };
  const parsed = parseAiJson(ai.text);
  return parsed ? { intent: parsed, warning: null } : {
    intent: null,
    warning: {
      code: "ai_intent_invalid_json",
      message: "AI chart intent response was not valid JSON; deterministic parsing was used.",
      severity: "warning",
    },
  };
}

function axisRequestFromValue(value, legacyAlias = "", legacyColumnHint = "") {
  if (typeof value === "string") {
    return { fieldAlias: value, columnHint: legacyColumnHint };
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    fieldAlias: firstText(source.fieldAlias, source.alias, source.field, source.fieldName, source.label, source.name, legacyAlias),
    columnHint: normalizeColumnHint(firstText(source.columnHint, source.column, source.columnLetter, legacyColumnHint)),
    unitHint: firstText(source.unitHint, source.unit),
  };
}

function normalizeIntent(intent = {}) {
  const data = intent.data && typeof intent.data === "object" && !Array.isArray(intent.data) ? intent.data : {};
  const encoding = intent.encoding && typeof intent.encoding === "object" && !Array.isArray(intent.encoding) ? intent.encoding : {};
  const axes = encoding.axes && typeof encoding.axes === "object" && !Array.isArray(encoding.axes) ? encoding.axes : {};
  const style = intent.style && typeof intent.style === "object" && !Array.isArray(intent.style) ? intent.style : {};
  const xRequest = axisRequestFromValue(data.x || intent.x, intent.xFieldAlias || intent.xAlias, intent.xColumnHint);
  const yRequest = axisRequestFromValue(data.y || intent.y, intent.yFieldAlias || intent.yAlias, intent.yColumnHint);
  const yFieldRequests = asArray(data.yFields || intent.yFields).map((item) => axisRequestFromValue(item)).filter((item) => item.fieldAlias || item.columnHint);
  const legacyYAliases = asArray(intent.yFieldAliases || intent.yAliases || intent.multiYAliases)
    .map((alias) => axisRequestFromValue(alias))
    .filter((item) => item.fieldAlias || item.columnHint);
  const renderStyle = {
    ...(intent.renderStyle && typeof intent.renderStyle === "object" ? intent.renderStyle : {}),
    ...style,
    traceMode: firstText(intent.renderStyle?.traceMode, style.traceMode, encoding.traceMode),
  };
  const axisOptions = {
    ...(intent.axisOptions && typeof intent.axisOptions === "object" ? intent.axisOptions : {}),
    x: {
      ...(intent.axisOptions?.x || {}),
      ...(axes.x || {}),
      scale: firstText(intent.axisOptions?.x?.scale, axes.x?.scale, intent.xAxisScale),
    },
    y: {
      ...(intent.axisOptions?.y || {}),
      ...(axes.y || {}),
      scale: firstText(intent.axisOptions?.y?.scale, axes.y?.scale, intent.yAxisScale),
    },
  };
  return {
    ...intent,
    chartType: intent.chartType || intent.type || "scatter",
    xFieldAlias: xRequest.fieldAlias,
    xColumnHint: xRequest.columnHint,
    yFieldAlias: yRequest.fieldAlias,
    yColumnHint: yRequest.columnHint,
    yFieldRequests: yFieldRequests.length ? yFieldRequests : legacyYAliases.length ? legacyYAliases : [yRequest].filter((item) => item.fieldAlias || item.columnHint),
    groupByAlias: firstText(data.groupBy?.fieldAlias, intent.groupByAlias, intent.groupAlias, intent.groupBy),
    filters: asArray(data.filters).length ? asArray(data.filters) : asArray(intent.filters),
    transformIntent: firstText(intent.transformIntent, intent.transform),
    transforms: asArray(intent.transforms),
    axisOptions,
    renderStyle,
    title: intent.title || "",
    rationale: intent.rationale || intent.reason || "",
  };
}

function aliasScore(field, alias) {
  const target = normalizeText(alias);
  if (!target) return 0;
  const targetTokens = textTokens(target);
  const aliasTexts = field.aliases.length ? field.aliases : [field.displayName, field.field, field.canonicalField].map(normalizeText);
  let best = 0;
  aliasTexts.forEach((candidate) => {
    if (!candidate) return;
    if (candidate === target) best = Math.max(best, 1);
    if (candidate.includes(target) || target.includes(candidate)) best = Math.max(best, 0.86);
    const candidateTokens = new Set(textTokens(candidate));
    const overlap = targetTokens.filter((token) => candidateTokens.has(token)).length;
    if (targetTokens.length) best = Math.max(best, overlap / targetTokens.length * 0.78);
  });
  return best;
}

function aliasMentionScore(field, prompt) {
  const promptText = normalizeText(prompt);
  if (!promptText) return 0;
  const aliasTexts = field.aliases.length ? field.aliases : [field.displayName, field.field, field.canonicalField].map(normalizeText);
  let best = 0;
  aliasTexts.forEach((alias) => {
    if (!alias) return;
    const aliasTokens = textTokens(alias);
    if (!aliasTokens.length) return;
    if (promptText === alias || promptText.includes(alias)) {
      best = Math.max(best, Math.min(1, 0.7 + aliasTokens.length * 0.08));
      return;
    }
    const promptTokens = new Set(textTokens(promptText));
    const overlap = aliasTokens.filter((token) => promptTokens.has(token)).length;
    if (overlap >= Math.min(2, aliasTokens.length)) {
      best = Math.max(best, overlap / aliasTokens.length * 0.74);
    }
  });
  return best;
}

function resolveMentionedField(prompt, fields, options = {}) {
  const roleFilter = options.roles ? new Set(options.roles) : null;
  const valueType = options.valueType || null;
  const candidates = fields
    .filter((field) => !roleFilter || roleFilter.has(field.role))
    .filter((field) => !valueType || field.valueType === valueType)
    .map((field) => ({ field, score: aliasMentionScore(field, prompt) }))
    .filter((item) => item.score >= 0.55)
    .sort((a, b) => b.score - a.score || (b.field.confidence || 0) - (a.field.confidence || 0));
  return candidates[0]?.field || null;
}

function resolveField(alias, fields, options = {}) {
  const roleFilter = options.roles ? new Set(options.roles) : null;
  const valueType = options.valueType || null;
  const candidates = fields
    .filter((field) => !roleFilter || roleFilter.has(field.role))
    .filter((field) => !valueType || field.valueType === valueType)
    .map((field) => ({ field, score: aliasScore(field, alias) }))
    .filter((item) => item.score >= 0.45)
    .sort((a, b) => b.score - a.score || (b.field.confidence || 0) - (a.field.confidence || 0));
  return candidates[0]?.field || null;
}

function fieldMatchesOptions(field, options = {}) {
  const roleFilter = options.roles ? new Set(options.roles) : null;
  const valueType = options.valueType || null;
  if (roleFilter && !roleFilter.has(field.role)) return false;
  if (valueType && field.valueType !== valueType) return false;
  return true;
}

function resolveFieldByColumnHint(columnHint, fields, inventory, options = {}) {
  const column = normalizeColumnHint(columnHint);
  if (!column) return null;
  const candidates = fields
    .filter((field) => fieldMatchesOptions(field, options))
    .map((field) => {
      const columns = sourceColumnsForField(field, inventory);
      const score = columns.filter((item) => item === column).length;
      return { field, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.field.confidence || 0) - (a.field.confidence || 0));
  return candidates[0]?.field || null;
}

function fieldOption(field) {
  return field ? {
    fieldId: field.fieldId,
    label: field.displayName,
    role: field.role,
    unit: field.unit,
    valueType: field.valueType,
  } : null;
}

function resolveRequestedField(request, fields, inventory, options = {}, axisName = "axis") {
  const aliasField = request?.fieldAlias ? resolveField(request.fieldAlias, fields, options) : null;
  const hintedColumn = normalizeColumnHint(request?.columnHint);
  if (aliasField && hintedColumn && sourceColumnsForField(aliasField, inventory).includes(hintedColumn)) {
    return { field: aliasField, clarification: null };
  }
  const columnField = request?.columnHint ? resolveFieldByColumnHint(request.columnHint, fields, inventory, options) : null;
  const anyColumnField = request?.columnHint ? resolveFieldByColumnHint(request.columnHint, fields, inventory, {}) : null;
  if (aliasField && anyColumnField && aliasField.fieldId !== anyColumnField.fieldId) {
    return {
      field: null,
      clarification: {
        message: `The ${axisName} field name and column hint point to different fields. Which field should be used?`,
        options: unique([aliasField.fieldId, anyColumnField.fieldId])
          .map((fieldId) => [aliasField, anyColumnField].find((field) => field.fieldId === fieldId))
          .map(fieldOption)
          .filter(Boolean),
      },
    };
  }
  return { field: aliasField || columnField || null, clarification: null };
}

function fieldOptions(fields, roles = null) {
  const roleSet = roles ? new Set(roles) : null;
  return fields
    .filter((field) => !roleSet || roleSet.has(field.role))
    .slice(0, 8)
    .map((field) => ({
      fieldId: field.fieldId,
      label: field.displayName,
      role: field.role,
      unit: field.unit,
      valueType: field.valueType,
    }));
}

function wantsTransform(intent, prompt, type) {
  const values = [
    intent?.transformIntent,
    intent?.transform,
    ...asArray(intent?.transforms).map((item) => typeof item === "string" ? item : item?.type),
  ].join(" ");
  const text = normalizeText(values);
  if (type === "normalize_sum_to_percent") {
    return /\bnormalize sum to percent\b/.test(text)
      || /\bnormalize_sum_to_percent\b/.test(String(values))
      || wantsNormalizeToPercent(`${text} ${normalizeText(prompt)}`);
  }
  return false;
}

function orderedCarbonFields(fields) {
  return fields
    .filter((field) => field.role === "measurement" && field.valueType === "numeric" && field.measurementFamily === "carbon_number_distribution")
    .sort((a, b) => (a.componentOrder || 0) - (b.componentOrder || 0) || String(a.displayName).localeCompare(String(b.displayName)));
}

function identifierField(inventory) {
  return inventory.identifiers[0]
    || inventory.fields.find((field) => field.role === "identifier")
    || null;
}

function isDistributionIntent(intent, prompt) {
  intent = normalizeIntent(intent);
  const text = normalizeText([
    intent?.chartType,
    intent?.goal,
    intent?.chartGoal,
    intent?.xFieldAlias,
    intent?.yFieldAlias,
    ...asArray(intent?.yFieldAliases),
    prompt,
  ].join(" "));
  return /\b(distribution bar|distribution|carbon number|c number|c-number|hydrocarbon)\b/.test(text)
    || normalizeChartType(intent?.chartType) === "distribution_bar";
}

function compileDistributionIntent(intent, inventory, prompt, warnings) {
  intent = normalizeIntent(intent);
  const yFields = orderedCarbonFields(inventory.fields);
  if (yFields.length < 2) {
    return {
      chartSpecDraft: null,
      clarification: {
        message: "Which C-number distribution fields should be used?",
        options: fieldOptions(inventory.measurements, ["measurement"]),
      },
    };
  }
  const seriesField = identifierField(inventory);
  const sourceRefs = unique(yFields.flatMap((field) => asArray(field.sourceRefs)));
  const normalize = wantsTransform(intent, prompt, "normalize_sum_to_percent");
  return {
    chartSpecDraft: compileChartSpec({
      chartType: "distribution_bar",
      title: intent.title || `${normalize ? "Normalized " : ""}C-number distribution`,
      xField: {
        fieldId: "virtual_carbon_number",
        field: "carbon_number",
        displayName: "Carbon number",
        role: "component",
        valueType: "ordinal",
        sourceIds: [],
        sourceRefs: [],
      },
      yFields,
      sourceImportIds: inventory.sourceImportIds,
      sourceRefs,
      confidence: Number(Math.min(0.96, Math.max(0.5, yFields.reduce((total, field) => total + (field.confidence || 0.7), 0) / yFields.length)).toFixed(3)),
      transforms: [
        {
          type: "pivot_longer",
          scope: "per_experiment",
          inputFieldIds: yFields.flatMap((field) => field.sourceIds),
          outputField: "carbon_distribution_pct",
          outputUnit: yFields[0]?.unit || "%",
        },
        { type: "sort_components", scope: "chart", inputFieldIds: yFields.flatMap((field) => field.sourceIds) },
        ...(normalize ? [{
          type: "normalize_sum_to_percent",
          scope: "per_experiment",
          inputFieldIds: yFields.flatMap((field) => field.sourceIds),
          outputUnit: "%",
        }] : []),
      ],
      series: [{
        type: "experiment",
        fieldId: seriesField?.fieldId || null,
        field: seriesField?.field || "experiment",
        label: seriesField?.displayName || "Experiment",
      }],
      axisOptions: intent.axisOptions,
      renderStyle: intent.renderStyle,
      warnings,
      rationale: intent.rationale || "C-number component fields were resolved as one distribution family.",
      prompt,
    }),
    clarification: null,
  };
}

function pairCoverage(xField, yFields) {
  if (!xField || !yFields.length) return 0;
  const xKeys = asArray(xField.recordKeys).length ? asArray(xField.recordKeys) : asArray(xField.rowIndexes);
  const yKeys = yFields.flatMap((field) => (
    asArray(field.recordKeys).length ? asArray(field.recordKeys) : asArray(field.rowIndexes)
  ));
  const xRows = new Set(xKeys.map(String));
  const yRows = new Set(yKeys.map(String));
  if (!xRows.size || !yRows.size) return 0;
  return [...yRows].filter((row) => xRows.has(row)).length;
}

function titleFor(intent, xField, yFields, groupBy) {
  if (intent.title) return String(intent.title);
  const yLabel = yFields.length > 1 ? yFields.map((field) => field.displayName).join(" / ") : yFields[0]?.displayName || "Value";
  const xLabel = xField?.displayName || "Record";
  const group = groupBy?.displayName ? ` by ${groupBy.displayName}` : "";
  return `${yLabel} vs ${xLabel}${group}`;
}

function compileIntent(intent, inventory, prompt, warnings) {
  intent = normalizeIntent(intent);
  const fields = inventory.fields;
  if (isDistributionIntent(intent, prompt)) {
    return compileDistributionIntent(intent, inventory, prompt, warnings);
  }
  const xResolved = resolveRequestedField({
    fieldAlias: intent.xFieldAlias,
    columnHint: intent.xColumnHint,
  }, fields, inventory, {
    roles: ["condition", "material", "metadata", "identifier"],
  }, "x-axis");
  if (xResolved.clarification) {
    return { chartSpecDraft: null, clarification: xResolved.clarification };
  }
  const xField = xResolved.field;
  const yRequests = asArray(intent.yFieldRequests).length ? asArray(intent.yFieldRequests) : [{
    fieldAlias: intent.yFieldAlias,
    columnHint: intent.yColumnHint,
  }];
  const yResolved = yRequests.map((request) => resolveRequestedField(request, fields, inventory, {
    roles: ["measurement"],
    valueType: "numeric",
  }, "y-axis"));
  const yConflict = yResolved.find((item) => item.clarification);
  if (yConflict?.clarification) {
    return { chartSpecDraft: null, clarification: yConflict.clarification };
  }
  let yFields = unique(yResolved.map((item) => item.field?.fieldId)).map((fieldId) => yResolved.find((item) => item.field?.fieldId === fieldId)?.field).filter(Boolean);
  if (!yFields.length) {
    const mentionedYField = resolveMentionedField(prompt, fields, {
      roles: ["measurement"],
      valueType: "numeric",
    });
    yFields = mentionedYField ? [mentionedYField] : [];
  }
  const groupBy = resolveField(intent.groupByAlias, fields, {
    roles: ["material", "condition", "identifier", "metadata"],
  });

  if (!yFields.length) {
    return {
      chartSpecDraft: null,
      clarification: {
        message: "Which measurement should be plotted?",
        options: fieldOptions(inventory.measurements, ["measurement"]),
      },
    };
  }
  if (!xField) {
    return {
      chartSpecDraft: null,
      clarification: {
        message: "Which x-axis field should be used?",
        options: fieldOptions(fields, ["condition", "material", "metadata", "identifier"]),
      },
    };
  }

  const requestedChartType = normalizeChartType(intent.chartType);
  const chartType = ["stacked_bar", "grouped_bar", "point"].includes(requestedChartType)
    ? requestedChartType
    : xField.valueType === "numeric" && yFields.length === 1 ? "scatter" : "bar";
  if ((chartType === "grouped_bar" || chartType === "stacked_bar") && yFields.length < 2) {
    return {
      chartSpecDraft: null,
      clarification: {
        message: "Which measurements should be included in this multi-series chart?",
        options: fieldOptions(inventory.measurements, ["measurement"]),
      },
    };
  }
  const coverage = pairCoverage(xField, yFields);
  const normalizeYFields = wantsTransform(intent, prompt, "normalize_sum_to_percent") && yFields.length >= 2;
  const intentTransforms = asArray(intent.transforms).filter((transform) => {
    const type = typeof transform === "string" ? transform : transform?.type || transform?.transformType;
    return type && normalizeText(type) !== "normalize sum to percent";
  });
  const transforms = [
    ...intentTransforms,
    ...(normalizeYFields ? [{
      type: "normalize_sum_to_percent",
      scope: "per_experiment",
      inputFieldIds: yFields.flatMap((field) => field.sourceIds),
      outputUnit: "%",
    }] : []),
  ];
  const sourceRefs = unique([
    ...asArray(xField.sourceRefs),
    ...yFields.flatMap((field) => asArray(field.sourceRefs)),
    ...asArray(groupBy?.sourceRefs),
  ]);
  const confidenceValues = [xField, ...yFields, groupBy].filter(Boolean).map((field) => field.confidence || 0.6);
  const confidence = Number(Math.min(0.97, Math.max(0.35, confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length)).toFixed(3));
  return {
    chartSpecDraft: compileChartSpec({
      chartType,
      title: titleFor(intent, xField, yFields, groupBy),
      xField,
      yFields,
      groupBy,
      filters: asArray(intent.filters),
      sourceImportIds: inventory.sourceImportIds,
      sourceRefs,
      confidence,
      warnings: [
        ...warnings,
        ...(coverage < 2 ? [{
          code: "low_pair_count",
          message: "Fewer than two paired x/y records are available for this chart draft.",
          severity: "warning",
        }] : []),
      ],
      transforms,
      axisOptions: {
        ...intent.axisOptions,
        x: {
          ...intent.axisOptions?.x,
          title: intent.axisOptions?.x?.title || xField.displayName,
        },
        y: {
          ...intent.axisOptions?.y,
          title: intent.axisOptions?.y?.title || (yFields.length === 1 ? yFields[0].displayName : "Value"),
        },
      },
      renderStyle: intent.renderStyle,
      rationale: intent.rationale || "Chart fields were resolved from the prompt and imported field inventory.",
      prompt,
      extra: {
        dataCoverage: {
          pairedRows: coverage,
          xCoverageCount: xField.coverageCount || 0,
          yCoverageCount: yFields.reduce((total, field) => total + (field.coverageCount || 0), 0),
        },
      },
    }),
    clarification: null,
  };
}

export async function createChartInterpretResponse(options = {}) {
  const inventory = buildChartFieldInventory(options);
  const warnings = [...inventory.warnings];
  const prompt = options.prompt || "";
  const deterministic = deterministicIntent(prompt);
  const ai = await aiIntent(prompt, inventory, options);
  if (ai.warning) warnings.push(ai.warning);
  const aiCompiled = ai.intent ? compileIntent(ai.intent, inventory, prompt, warnings) : null;
  const compiled = aiCompiled?.chartSpecDraft ? aiCompiled : compileIntent(deterministic, inventory, prompt, warnings);

  return shapeChartInterpretResponse({
    chartSpecDraft: compiled.chartSpecDraft,
    clarification: compiled.clarification,
    warnings: compiled.chartSpecDraft ? [] : warnings,
  });
}

export const chartIntentInternals = {
  buildChartFieldInventory,
  deterministicIntent,
  resolveField,
  compileIntent,
};
