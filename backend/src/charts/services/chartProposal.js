import {
  CHART_PROPOSAL_SET_VERSION,
  shapeChartProposalResponse,
} from "../schemas/chartProposalSchemas.js";
import { slug } from "../../import/services/genericImportContext.js";
import {
  chartAliasesForField,
  compileChartSpec,
  componentOrder,
  measurementFamily,
  selectivityComponent,
} from "./chartSpec.js";
import { chartIntentInternals } from "./chartIntent.js";
import { createAiIntentProposals } from "./chartAiIntentProposal.js";
import { buildChartDataProfile } from "./chartFieldProfile.js";
import { rankAndDedupeProposals, scoreProposal } from "./chartProposalScoring.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function proposalSetId(sourceImportIds) {
  return `chart_proposal_set_${slug(sourceImportIds.join("_") || "generic_import")}`;
}

function statusFromPrior(priorDecisions, proposalId) {
  const decision = asArray(priorDecisions).find((item) => item?.proposalId === proposalId);
  return decision?.status === "accepted" || decision?.status === "rejected" ? decision.status : "proposed";
}

function shouldSkipRejected(priorDecisions, proposalId) {
  return statusFromPrior(priorDecisions, proposalId) === "rejected";
}

function mappingByField(mappingSets) {
  const map = new Map();
  asArray(mappingSets).forEach((set) => {
    asArray(set?.mappings).forEach((mapping) => {
      if (mapping?.status === "rejected") return;
      asArray(mapping.sourceIds).forEach((sourceId) => {
        map.set(sourceId, mapping);
      });
    });
  });
  return map;
}

function importFieldRecords(genericImport) {
  const fields = asArray(genericImport.fields);
  if (fields.length) return fields.map((field) => ({
    id: field.fieldValueId,
    experimentId: field.experimentId,
    rowIndex: field.rowIndex,
    recordKey: field.observationId || [
      field.experimentId || "",
      field.rowIndex ?? "",
    ].join("|"),
  }));
  return asArray(genericImport.measurements).map((measurement) => ({
    id: measurement.measurementId,
    experimentId: measurement.experimentId,
    rowIndex: measurement.rowIndex,
    recordKey: measurement.observationId || [
      measurement.experimentId || "",
      measurement.rowIndex ?? "",
    ].join("|"),
  }));
}

function applyMappings(fields, mappingsBySourceId) {
  return fields.map((field) => {
    const mapping = field.sourceIds.map((sourceId) => mappingsBySourceId.get(sourceId)).find(Boolean);
    if (!mapping) return field;
    return {
      ...field,
      canonicalField: mapping.canonicalField || field.canonicalField,
      semanticRole: mapping.semanticRole || field.semanticRole,
      confidence: Math.max(field.confidence || 0, mapping.confidence || 0),
      mappingIds: [mapping.mappingId].filter(Boolean),
    };
  });
}

function roleForField(field) {
  if (field.fieldRole) return field.fieldRole;
  if (field.role) return field.role;
  if (field.semanticRole === "identifier") return "identifier";
  if (field.semanticRole === "condition" || field.semanticRole === "time") return "condition";
  if (field.targetKind === "measurement") return "measurement";
  return "metadata";
}

function enrichChartField(field) {
  const role = roleForField(field);
  const enriched = {
    ...field,
    role,
    measurementFamily: measurementFamily(field),
    measurementComponent: selectivityComponent(field),
    componentOrder: componentOrder(field),
  };
  return {
    ...enriched,
    aliases: [...new Set([
      ...asArray(field.aliases),
      ...chartAliasesForField(enriched),
    ])],
  };
}

function pairCount(xField, yField, genericImports) {
  const xIds = new Set(xField.sourceIds);
  const yIds = new Set(yField.sourceIds);
  const xByKey = new Set();
  const yByKey = new Set();
  asArray(genericImports).forEach((genericImport) => {
    importFieldRecords(genericImport).forEach((field) => {
      const key = field.recordKey || `${field.experimentId || ""}|${field.rowIndex ?? ""}`;
      if (xIds.has(field.id)) xByKey.add(key);
      if (yIds.has(field.id)) yByKey.add(key);
    });
  });
  return [...yByKey].filter((key) => xByKey.has(key)).length;
}

function makeScatterProposal({ sourceImportIds, xField, yField, groupByField, index, genericImports, priorDecisions }) {
  const pairs = pairCount(xField, yField, genericImports);
  const proposalId = `chart_proposal_${index + 1}_${slug(yField.canonicalField || yField.field)}_vs_${slug(xField.canonicalField || xField.field)}`;
  if (shouldSkipRejected(priorDecisions, proposalId)) return null;
  const spec = compileChartSpec({
    chartType: "scatter",
    title: `${yField.displayName || yField.field} vs ${xField.displayName || xField.field}`,
    xField,
    yFields: [yField],
    groupBy: groupByField || null,
    sourceImportIds,
    sourceRefs: [...new Set([...xField.sourceRefs, ...yField.sourceRefs, ...asArray(groupByField?.sourceRefs)])],
    confidence: Number(Math.min(0.96, Math.max(0.4, ((xField.confidence || 0.6) + (yField.confidence || 0.6)) / 2)).toFixed(3)),
    rationale: `${xField.displayName} and ${yField.displayName} are numeric fields with ${pairs} paired records.`,
    warnings: [
      ...(pairs < 2 ? [{
        code: "low_pair_count",
        message: "Fewer than two paired x/y records are available for this chart.",
        severity: "warning",
      }] : []),
      ...(!xField.unit ? [{
        code: "x_unit_missing",
        message: `${xField.displayName} has no explicit unit.`,
        severity: "warning",
      }] : []),
      ...(!yField.unit ? [{
        code: "y_unit_missing",
        message: `${yField.displayName} has no explicit unit.`,
        severity: "warning",
      }] : []),
    ],
  });
  return {
    ...spec,
    proposalId,
    origin: "deterministic_recipe",
    insight: `${yField.displayName} changes can be compared against ${xField.displayName} across ${pairs} paired records.`,
    status: statusFromPrior(priorDecisions, proposalId),
  };
}

function makeBarProposal({ sourceImportIds, xField, yField, index, priorDecisions }) {
  const proposalId = `chart_proposal_${index + 1}_${slug(yField.canonicalField || yField.field)}_by_${slug(xField.canonicalField || xField.field)}`;
  if (shouldSkipRejected(priorDecisions, proposalId)) return null;
  const spec = compileChartSpec({
    chartType: "bar",
    title: `${yField.displayName || yField.field} by ${xField.displayName || xField.field}`,
    xField,
    yFields: [yField],
    sourceImportIds,
    sourceRefs: [...new Set([...xField.sourceRefs, ...yField.sourceRefs])],
    confidence: Number(Math.min(0.9, Math.max(0.4, ((xField.confidence || 0.55) + (yField.confidence || 0.65)) / 2)).toFixed(3)),
    rationale: `${xField.displayName} can label categories while ${yField.displayName} provides numeric values.`,
    warnings: [
      ...(!yField.unit ? [{
        code: "y_unit_missing",
        message: `${yField.displayName} has no explicit unit.`,
        severity: "warning",
      }] : []),
    ],
  });
  return {
    ...spec,
    proposalId,
    origin: "deterministic_recipe",
    insight: `${xField.displayName} can be used to compare ${yField.displayName} categories.`,
    status: statusFromPrior(priorDecisions, proposalId),
  };
}

function orderedSelectivityFields(fields) {
  const order = ["solid", "liquid", "gas"];
  return order
    .map((component) => fields.find((field) => field.measurementFamily === "selectivity" && field.measurementComponent === component))
    .filter(Boolean);
}

function makeSelectivityFamilyProposal({ sourceImportIds, chartType, xField, yFields, index, priorDecisions, normalized = false }) {
  const proposalId = `chart_proposal_${index + 1}_${normalized ? "normalized_" : ""}selectivity_${chartType}_by_${slug(xField.canonicalField || xField.field)}`;
  if (shouldSkipRejected(priorDecisions, proposalId)) return null;
  const spec = compileChartSpec({
    chartType,
    title: `${normalized ? "Normalized " : ""}Solid / Liquid / Gas Selectivity by ${xField.displayName || xField.field}`,
    xField,
    yFields,
    sourceImportIds,
    sourceRefs: [...new Set([
      ...xField.sourceRefs,
      ...yFields.flatMap((field) => field.sourceRefs),
    ])],
    confidence: Number(Math.min(0.96, Math.max(0.5, yFields.reduce((total, field) => total + (field.confidence || 0.7), xField.confidence || 0.7) / (yFields.length + 1))).toFixed(3)),
    rationale: "Solid, liquid, and gas selectivity fields were resolved as one selectivity measurement family.",
    transforms: normalized ? [{
      type: "normalize_sum_to_percent",
      scope: "per_experiment",
      inputFieldIds: yFields.flatMap((field) => field.sourceIds),
      outputUnit: "%",
    }] : [],
    warnings: [
      ...(yFields.length < 3 ? [{
        code: "partial_selectivity_family",
        message: "Only part of the solid/liquid/gas selectivity family is available.",
        severity: "warning",
      }] : []),
    ],
  });
  return {
    ...spec,
    proposalId,
    origin: "deterministic_recipe",
    insight: normalized
      ? "Solid, liquid, and gas selectivity can be scaled within each experiment so each stack sums to 100%."
      : `The selectivity family is available as ${yFields.map((field) => field.displayName).join(", ")}.`,
    status: statusFromPrior(priorDecisions, proposalId),
  };
}

function orderedCarbonDistributionFields(fields) {
  return fields
    .filter((field) => field.measurementFamily === "carbon_number_distribution" && field.valueType === "numeric")
    .sort((a, b) => (a.componentOrder || 0) - (b.componentOrder || 0) || String(a.displayName).localeCompare(String(b.displayName)));
}

function makeCarbonDistributionProposal({ sourceImportIds, yFields, index, priorDecisions, normalized = false }) {
  const proposalId = `chart_proposal_${index + 1}_${normalized ? "normalized_" : ""}c_number_distribution`;
  if (shouldSkipRejected(priorDecisions, proposalId)) return null;
  const sourceFieldIds = yFields.flatMap((field) => field.sourceIds);
  const spec = compileChartSpec({
    chartType: "distribution_bar",
    title: `${normalized ? "Normalized " : ""}C-number distribution`,
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
    sourceImportIds,
    sourceRefs: [...new Set(yFields.flatMap((field) => field.sourceRefs))],
    confidence: Number(Math.min(0.96, Math.max(0.5, yFields.reduce((total, field) => total + (field.confidence || 0.7), 0) / yFields.length)).toFixed(3)),
    transforms: [
      {
        type: "pivot_longer",
        scope: "per_experiment",
        inputFieldIds: sourceFieldIds,
        outputField: "carbon_distribution_pct",
        outputUnit: yFields[0]?.unit || "%",
      },
      { type: "sort_components", scope: "chart", inputFieldIds: sourceFieldIds },
      ...(normalized ? [{
        type: "normalize_sum_to_percent",
        scope: "per_experiment",
        inputFieldIds: sourceFieldIds,
        outputUnit: "%",
      }] : []),
    ],
    series: [{ type: "experiment", field: "experiment", label: "Experiment" }],
    rationale: "C-number fields were resolved as one carbon-number distribution family.",
    warnings: [
      ...(yFields.length < 3 ? [{
        code: "partial_carbon_distribution_family",
        message: "Only a small number of C-number fields were detected.",
        severity: "warning",
      }] : []),
    ],
  });
  return {
    ...spec,
    proposalId,
    origin: "deterministic_recipe",
    insight: normalized
      ? "C-number bins can be normalized within each experiment before comparison."
      : "C-number bins can be compared across experiments as a grouped distribution.",
    status: statusFromPrior(priorDecisions, proposalId),
  };
}

function compactAiPrompt(context, proposals, userGoal) {
  return JSON.stringify({
    userGoal,
    sourceImportIds: context.sourceImportIds,
    proposals: proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      chartType: proposal.chartType,
      x: proposal.x,
      y: proposal.y,
      yFields: proposal.yFields,
      groupBy: proposal.groupBy,
      title: proposal.title,
      warnings: proposal.warnings,
    })),
  });
}

export async function createChartProposalResponse(options = {}) {
  const context = chartIntentInternals.buildChartFieldInventory(options);
  const mappedFields = applyMappings(context.fields, mappingByField(options.mappingSets)).map(enrichChartField);
  const dataProfile = buildChartDataProfile({
    fields: mappedFields,
    genericImports: context.genericImports,
  });
  const numericFields = mappedFields.filter((field) => field.valueType === "numeric" && field.numericCount > 0);
  const xFields = numericFields.filter((field) => field.semanticRole === "time" || field.role === "condition");
  const responseFields = numericFields.filter((field) => field.role === "measurement");
  const categoricalFields = mappedFields.filter((field) => ["identifier", "condition", "material", "metadata"].includes(field.role) && field.valueType !== "numeric");
  const groupField = categoricalFields.find((field) => /catalyst|polymer/i.test(`${field.displayName} ${field.field}`))
    || categoricalFields.find((field) => field.role === "material")
    || null;
  const labelField = categoricalFields.find((field) => field.role === "identifier")
    || categoricalFields.find((field) => /label|experiment|run/i.test(`${field.displayName} ${field.field}`))
    || categoricalFields[0]
    || null;
  const proposals = [];

  xFields.forEach((xField) => {
    responseFields
      .filter((yField) => yField.fieldId !== xField.fieldId)
      .forEach((yField) => {
        if (pairCount(xField, yField, context.genericImports) === 0) return;
        const proposal = makeScatterProposal({
          sourceImportIds: context.sourceImportIds,
          xField,
          yField,
          groupByField: groupField,
          index: proposals.length,
          genericImports: context.genericImports,
          priorDecisions: options.priorDecisions,
        });
        if (proposal) proposals.push(proposal);
      });
  });

  const selectivityFields = orderedSelectivityFields(responseFields);
  if (labelField && selectivityFields.length >= 2) {
    ["grouped_bar", "stacked_bar"].forEach((chartType) => {
      const proposal = makeSelectivityFamilyProposal({
        sourceImportIds: context.sourceImportIds,
        chartType,
        xField: labelField,
        yFields: selectivityFields,
        index: proposals.length,
        priorDecisions: options.priorDecisions,
      });
      if (proposal) proposals.push(proposal);
    });
    const normalized = makeSelectivityFamilyProposal({
      sourceImportIds: context.sourceImportIds,
      chartType: "stacked_bar",
      xField: labelField,
      yFields: selectivityFields,
      index: proposals.length,
      priorDecisions: options.priorDecisions,
      normalized: true,
    });
    if (normalized) proposals.push(normalized);
  }

  const carbonDistributionFields = orderedCarbonDistributionFields(responseFields);
  if (carbonDistributionFields.length >= 2) {
    [false, true].forEach((normalized) => {
      const proposal = makeCarbonDistributionProposal({
        sourceImportIds: context.sourceImportIds,
        yFields: carbonDistributionFields,
        index: proposals.length,
        priorDecisions: options.priorDecisions,
        normalized,
      });
      if (proposal) proposals.push(proposal);
    });
  }

  if (proposals.length < 3) {
    categoricalFields.forEach((xField) => {
      responseFields.forEach((yField) => {
        const proposal = makeBarProposal({
          sourceImportIds: context.sourceImportIds,
          xField,
          yField,
          index: proposals.length,
          priorDecisions: options.priorDecisions,
        });
        if (proposal) proposals.push(proposal);
      });
    });
  }

  const warnings = [...context.warnings];
  const aiResult = await createAiIntentProposals({
    inventory: {
      ...context,
      fields: mappedFields,
      measurements: mappedFields.filter((field) => field.role === "measurement"),
      conditions: mappedFields.filter((field) => field.role === "condition"),
      materials: mappedFields.filter((field) => field.role === "material"),
      identifiers: mappedFields.filter((field) => field.role === "identifier"),
      metadata: mappedFields.filter((field) => !["measurement", "condition", "material", "identifier"].includes(field.role)),
    },
    profiles: dataProfile.fieldProfiles,
    userGoal: options.userGoal || "",
    projectProfile: options.projectProfile || {},
    existingCharts: options.existingCharts || [],
    priorDecisions: options.priorDecisions || [],
    env: options.env,
    fetchImpl: options.fetchImpl,
  });
  warnings.push(...aiResult.warnings);

  const scoredProposals = [...proposals, ...aiResult.proposals].map((proposal) => {
    const yField = mappedFields.find((field) => field.fieldId === proposal.y?.fieldId || field.field === proposal.y?.field);
    const xField = mappedFields.find((field) => field.fieldId === proposal.x?.fieldId || field.field === proposal.x?.field);
    const groupByField = mappedFields.find((field) => field.fieldId === proposal.groupBy?.fieldId || field.field === proposal.groupBy?.field);
    const pairProfile = xField && yField ? dataProfile.pairProfile(xField, yField, groupByField) : null;
    return scoreProposal(proposal, {
      profiles: dataProfile.fieldProfiles,
      pairProfile,
      priorDecisions: options.priorDecisions || [],
      userGoal: options.userGoal || "",
      projectProfile: options.projectProfile || {},
    });
  });
  const rankedProposals = rankAndDedupeProposals(scoredProposals, {
    limit: options.chartConstraints?.maxProposals || 8,
  });

  if (!rankedProposals.length && context.genericImports.length) {
    warnings.push({
      code: "no_chart_candidates",
      message: "No paired numeric chart candidates were found in the selected generic imports.",
      severity: "warning",
    });
  }

  const proposalSet = {
    proposalSetId: proposalSetId(context.sourceImportIds),
    schemaVersion: CHART_PROPOSAL_SET_VERSION,
    createdAt: options.createdAt || new Date().toISOString(),
    sourceImportIds: context.sourceImportIds,
    proposals: rankedProposals,
    warnings,
    ai: {
      provider: "anthropic",
      used: aiResult.ai.used,
      model: options.env?.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      note: aiResult.ai.used ? "AI chart intents were requested and validated against imported fields." : "Deterministic profiling fallback used.",
      advice: aiResult.ai.advice || "",
    },
  };

  return shapeChartProposalResponse({ proposalSet, warnings: [] });
}
