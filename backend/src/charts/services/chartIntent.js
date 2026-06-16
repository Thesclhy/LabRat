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
    aliases: chartAliasesForField(enriched),
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

function deterministicIntent(prompt) {
  const text = normalizeText(prompt);
  const wantsDistribution = /\b(c number|cnumber|c-number|carbon number|carbon distribution|hydrocarbon distribution|c\d+\s*(?:to|-)\s*c\d+)\b/.test(text);
  const wantsNormalize = /\b(normalize|normalised|normalized|scale|scaled|sum to 100|total 100|to 100)\b/.test(text);
  const wantsStack = /\b(stacked|stack)\b/.test(text);
  const wantsGrouped = /\b(grouped bar|grouped bars|group bar|group bars)\b/.test(text);
  const wantsPoint = /\b(point|dot)\b/.test(text);
  const chartType = wantsDistribution ? "distribution_bar"
    : wantsStack ? "stacked_bar"
    : wantsGrouped ? "grouped_bar"
      : /\b(bar|column)\b/.test(text) ? "bar"
        : wantsPoint ? "point"
          : /\b(line|time series)\b/.test(text) ? "scatter"
            : "scatter";
  const groupByAlias = phraseAfter(text, [
    /\bgroup(?:ed)? by ([a-z0-9 ]+?)(?:\bwhere\b|\bfilter\b|$)/,
    /\bcolor(?:ed)? by ([a-z0-9 ]+?)(?:\bwhere\b|\bfilter\b|$)/,
  ]);
  const xFieldAlias = phraseAfter(text, [
    /\bvs ([a-z0-9 ]+?)(?:\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|\bby\b|$)/,
    /\bversus ([a-z0-9 ]+?)(?:\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|\bby\b|$)/,
    /\bagainst ([a-z0-9 ]+?)(?:\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|\bby\b|$)/,
    /\bover ([a-z0-9 ]+?)(?:\bgroup(?:ed)?\b|\bcolor(?:ed)?\b|\bby\b|$)/,
  ]);
  let yFieldAlias = phraseAfter(text, [
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
    chartType: wantsSelectivitySet ? selectivitySetChartType : chartType,
    xFieldAlias: xFieldAlias || (wantsSelectivitySet || groupByAlias || mentionsExperimentAxis ? "experiment" : /\btemperature\b/.test(text) ? "temperature" : ""),
    yFieldAlias,
    yFieldAliases: wantsSelectivitySet ? ["solid selectivity", "liquid selectivity", "gas selectivity"] : [],
    groupByAlias,
    filters: [],
    transformIntent: wantsNormalize ? "normalize_sum_to_percent" : "",
    title: "",
    rationale: "Parsed deterministically from the chart prompt.",
  };
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
  }));
}

async function aiIntent(prompt, inventory, options) {
  const ai = await requestAnthropicJson({
    system: [
      "You convert a user's chart request into chart intent JSON for LabRat.",
      "Use only aliases from the field inventory. Do not invent fields or values.",
      "Return JSON with chartType, xFieldAlias, yFieldAlias, yFieldAliases, groupByAlias, filters, title, rationale.",
    ].join(" "),
    prompt: JSON.stringify({
      prompt,
      fields: compactInventory(inventory),
      allowedChartTypes: ["scatter", "point", "bar", "grouped_bar", "stacked_bar", "distribution_bar"],
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
    prompt,
  ].join(" ");
  const text = normalizeText(values);
  if (type === "normalize_sum_to_percent") {
    return /\b(normalize|normalise|normalized|normalised|scale|scaled|sum to 100|total 100|to 100)\b/.test(text);
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
      warnings,
      rationale: intent.rationale || "C-number component fields were resolved as one distribution family.",
      prompt,
    }),
    clarification: null,
  };
}

function pairCoverage(xField, yFields) {
  if (!xField || !yFields.length) return 0;
  const xRows = new Set(asArray(xField.rowIndexes).map(String));
  const yRows = new Set(yFields.flatMap((field) => asArray(field.rowIndexes).map(String)));
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
  const fields = inventory.fields;
  if (isDistributionIntent(intent, prompt)) {
    return compileDistributionIntent(intent, inventory, prompt, warnings);
  }
  const xField = resolveField(intent.xFieldAlias, fields, {
    roles: ["condition", "material", "metadata", "identifier"],
  });
  const yAliases = asArray(intent.yFieldAliases).length ? asArray(intent.yFieldAliases) : [intent.yFieldAlias];
  let yFields = unique(yAliases).map((alias) => resolveField(alias, fields, {
    roles: ["measurement"],
    valueType: "numeric",
  })).filter(Boolean);
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
      transforms: normalizeYFields ? [{
        type: "normalize_sum_to_percent",
        scope: "per_experiment",
        inputFieldIds: yFields.flatMap((field) => field.sourceIds),
        outputUnit: "%",
      }] : [],
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
