import { aiUnavailableWarning, requestAnthropicJson } from "../../ai/anthropic.js";
import { slug } from "../../import/services/genericImportContext.js";
import { chartIntentInternals } from "./chartIntent.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const firstArray = candidate.indexOf("[");
  const firstObject = candidate.indexOf("{");
  const first = firstArray >= 0 && (firstObject < 0 || firstArray < firstObject) ? firstArray : firstObject;
  const last = first === firstArray ? candidate.lastIndexOf("]") : candidate.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    return null;
  }
}

function normalizeIntent(intent) {
  if (!isObject(intent)) return null;
  return {
    chartType: intent.chartType || intent.type || "scatter",
    xFieldAlias: intent.xFieldAlias || intent.xAlias || intent.x || "",
    yFieldAlias: intent.yFieldAlias || intent.yAlias || intent.y || "",
    yFieldAliases: asArray(intent.yFieldAliases || intent.yAliases || intent.multiYAliases),
    groupByAlias: intent.groupByAlias || intent.groupAlias || intent.groupBy || "",
    filters: asArray(intent.filters),
    transformIntent: intent.transformIntent || intent.transform || "",
    transforms: asArray(intent.transforms),
    title: intent.title || "",
    rationale: intent.rationale || intent.reason || "",
  };
}

function extractIntents(parsed) {
  if (Array.isArray(parsed)) return parsed.map(normalizeIntent).filter(Boolean);
  if (Array.isArray(parsed?.intents)) return parsed.intents.map(normalizeIntent).filter(Boolean);
  const single = normalizeIntent(parsed);
  return single ? [single] : [];
}

function compactField(field, profile) {
  return {
    fieldId: field.fieldId,
    displayName: field.displayName,
    field: field.field,
    canonicalField: field.canonicalField,
    role: field.role,
    semanticRole: field.semanticRole,
    measurementFamily: field.measurementFamily || null,
    measurementComponent: field.measurementComponent || null,
    componentOrder: field.componentOrder || null,
    valueType: field.valueType,
    unit: field.unit,
    aliases: asArray(field.aliases).slice(0, 8),
    numericCount: field.numericCount || 0,
    coverageCount: field.coverageCount || 0,
    profile: profile ? {
      coverageRate: profile.coverageRate,
      missingRate: profile.missingRate,
      uniqueCount: profile.uniqueCount,
      min: profile.min,
      max: profile.max,
      variance: profile.variance,
      hasUsefulSpread: profile.hasUsefulSpread,
      isMostlyConstant: profile.isMostlyConstant,
    } : null,
  };
}

function compactExistingChart(chart) {
  return {
    title: chart?.title || "",
    chartType: chart?.chartType || "",
    sourceProposalId: chart?.sourceProposalId || null,
  };
}

function intentPrompt({ inventory, profiles, userGoal, projectProfile, existingCharts, priorDecisions }) {
  return JSON.stringify({
    task: "Suggest chart intents for LabRat. Use only aliases from fields. Do not invent data.",
    userGoal: userGoal || "",
    projectProfile: {
      researchGoal: projectProfile?.researchGoal || "",
      experimentBackground: projectProfile?.experimentBackground || "",
      materials: projectProfile?.materials || "",
      methods: projectProfile?.methods || "",
      analysisNotes: projectProfile?.analysisNotes || "",
      tags: asArray(projectProfile?.tags),
    },
    fields: asArray(inventory.fields).map((field) => compactField(field, profiles.get(field.fieldId))),
    priorDecisions: asArray(priorDecisions).slice(0, 20),
    existingCharts: asArray(existingCharts).slice(0, 12).map(compactExistingChart),
    allowedChartTypes: ["scatter", "point", "bar", "grouped_bar", "stacked_bar", "distribution_bar"],
    responseShape: {
      intents: [{
        chartType: "scatter",
        xAlias: "temperature",
        yAlias: "gas selectivity",
        groupByAlias: "catalyst",
        title: "Gas Selectivity vs Temperature",
        rationale: "why this chart is scientifically useful",
        transformIntent: "optional supported transform such as normalize_sum_to_percent",
      }],
    },
  });
}

function proposalIdForIntent(intent, chartSpecDraft, index) {
  const y = asArray(chartSpecDraft.yFields).map((field) => field.field || field.label).join("_");
  return `chart_proposal_ai_${index + 1}_${slug(y || intent.yFieldAlias || "measurement")}_vs_${slug(chartSpecDraft.x?.field || intent.xFieldAlias || "x")}`;
}

export async function createAiIntentProposals({
  inventory,
  profiles,
  userGoal = "",
  projectProfile = {},
  existingCharts = [],
  priorDecisions = [],
  env,
  fetchImpl,
} = {}) {
  const ai = await requestAnthropicJson({
    system: [
      "You suggest chart intents for lab data.",
      "Return JSON only. Use only field aliases provided in the inventory.",
      "Do not generate Plotly JSON. Do not invent fields, values, or source ids.",
    ].join(" "),
    prompt: intentPrompt({ inventory, profiles, userGoal, projectProfile, existingCharts, priorDecisions }),
    maxTokens: 1400,
    env,
    fetchImpl,
  });
  if (!ai.ok) {
    return {
      proposals: [],
      warnings: [ai.warning || aiUnavailableWarning()],
      ai: {
        used: false,
        advice: "",
      },
    };
  }
  const parsed = parseJson(ai.text);
  const intents = extractIntents(parsed);
  if (!intents.length) {
    return {
      proposals: [],
      warnings: [{
        code: "ai_chart_intents_invalid",
        message: "AI chart proposal response did not contain valid chart intents; deterministic proposals were used.",
        severity: "warning",
      }],
      ai: {
        used: true,
        advice: ai.text,
      },
    };
  }

  const warnings = [];
  const proposals = [];
  intents.slice(0, 8).forEach((intent, index) => {
    const compiled = chartIntentInternals.compileIntent(intent, inventory, userGoal || intent.rationale || "", []);
    if (!compiled.chartSpecDraft) {
      warnings.push({
        code: "ai_chart_intent_unresolved",
        message: `AI chart intent ${index + 1} could not be resolved to imported fields.`,
        severity: "warning",
        intent,
      });
      return;
    }
    proposals.push({
      ...compiled.chartSpecDraft,
      proposalId: proposalIdForIntent(intent, compiled.chartSpecDraft, proposals.length),
      status: "proposed",
      origin: "ai_intent",
      aiIntent: intent,
      rationale: intent.rationale || compiled.chartSpecDraft.rationale,
      insight: intent.rationale || compiled.chartSpecDraft.rationale,
    });
  });

  return {
    proposals,
    warnings,
    ai: {
      used: true,
      advice: ai.text,
    },
  };
}
