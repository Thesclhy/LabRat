import { aiUnavailableWarning, requestAnthropicJson } from "../../ai/anthropic.js";
import {
  CHART_PROPOSAL_SET_VERSION,
  shapeChartProposalResponse,
} from "../schemas/chartProposalSchemas.js";
import { buildGenericImportContext, slug } from "../../import/services/genericImportContext.js";

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

function pairCount(xField, yField, genericImports) {
  const xIds = new Set(xField.sourceIds);
  const yIds = new Set(yField.sourceIds);
  const xByKey = new Set();
  const yByKey = new Set();
  asArray(genericImports).forEach((genericImport) => {
    asArray(genericImport.measurements).forEach((measurement) => {
      const key = `${measurement.experimentId || ""}|${measurement.rowIndex ?? ""}`;
      if (xIds.has(measurement.measurementId)) xByKey.add(key);
      if (yIds.has(measurement.measurementId)) yByKey.add(key);
    });
  });
  return [...yByKey].filter((key) => xByKey.has(key)).length;
}

function fieldForAxis(field) {
  return {
    fieldId: field.fieldId,
    field: field.canonicalField || field.field,
    label: field.displayName || field.field,
    unit: field.unit || null,
    measurementIds: field.sourceIds,
    mappingIds: field.mappingIds || [],
  };
}

function makeScatterProposal({ sourceImportIds, xField, yField, index, genericImports, priorDecisions }) {
  const pairs = pairCount(xField, yField, genericImports);
  const proposalId = `chart_proposal_${index + 1}_${slug(yField.canonicalField || yField.field)}_vs_${slug(xField.canonicalField || xField.field)}`;
  return {
    proposalId,
    status: statusFromPrior(priorDecisions, proposalId),
    sourceImportIds,
    chartType: "scatter",
    x: fieldForAxis(xField),
    y: fieldForAxis(yField),
    groupBy: { field: "experiment", label: "Experiment" },
    title: `${yField.displayName || yField.field} vs ${xField.displayName || xField.field}`,
    rationale: `${xField.displayName} and ${yField.displayName} are numeric fields with ${pairs} paired records.`,
    sourceRefs: [...new Set([...xField.sourceRefs, ...yField.sourceRefs])],
    confidence: Number(Math.min(0.96, Math.max(0.4, ((xField.confidence || 0.6) + (yField.confidence || 0.6)) / 2)).toFixed(3)),
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
    requiresReview: true,
  };
}

function makeBarProposal({ sourceImportIds, xField, yField, index, priorDecisions }) {
  const proposalId = `chart_proposal_${index + 1}_${slug(yField.canonicalField || yField.field)}_by_${slug(xField.canonicalField || xField.field)}`;
  return {
    proposalId,
    status: statusFromPrior(priorDecisions, proposalId),
    sourceImportIds,
    chartType: "bar",
    x: fieldForAxis(xField),
    y: fieldForAxis(yField),
    groupBy: null,
    title: `${yField.displayName || yField.field} by ${xField.displayName || xField.field}`,
    rationale: `${xField.displayName} can label categories while ${yField.displayName} provides numeric values.`,
    sourceRefs: [...new Set([...xField.sourceRefs, ...yField.sourceRefs])],
    confidence: Number(Math.min(0.9, Math.max(0.4, ((xField.confidence || 0.55) + (yField.confidence || 0.65)) / 2)).toFixed(3)),
    warnings: [
      ...(!yField.unit ? [{
        code: "y_unit_missing",
        message: `${yField.displayName} has no explicit unit.`,
        severity: "warning",
      }] : []),
    ],
    requiresReview: true,
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
      title: proposal.title,
      warnings: proposal.warnings,
    })),
  });
}

export async function createChartProposalResponse(options = {}) {
  const context = buildGenericImportContext(options);
  const mappedFields = applyMappings(context.measurementFields, mappingByField(options.mappingSets));
  const numericFields = mappedFields.filter((field) => field.valueType === "numeric" && field.numericCount > 0);
  const xFields = numericFields.filter((field) => field.semanticRole === "time");
  const responseFields = numericFields.filter((field) => field.semanticRole === "response");
  const categoricalFields = mappedFields.filter((field) => ["identifier", "condition"].includes(field.semanticRole) && field.valueType !== "numeric");
  const proposals = [];

  xFields.forEach((xField) => {
    responseFields
      .filter((yField) => yField.fieldId !== xField.fieldId)
      .forEach((yField) => {
        if (proposals.length >= 6) return;
        if (pairCount(xField, yField, context.genericImports) === 0) return;
        proposals.push(makeScatterProposal({
          sourceImportIds: context.sourceImportIds,
          xField,
          yField,
          index: proposals.length,
          genericImports: context.genericImports,
          priorDecisions: options.priorDecisions,
        }));
      });
  });

  if (proposals.length < 3) {
    categoricalFields.forEach((xField) => {
      responseFields.forEach((yField) => {
        if (proposals.length >= 6) return;
        proposals.push(makeBarProposal({
          sourceImportIds: context.sourceImportIds,
          xField,
          yField,
          index: proposals.length,
          priorDecisions: options.priorDecisions,
        }));
      });
    });
  }

  const warnings = [...context.warnings];
  if (!proposals.length && context.genericImports.length) {
    warnings.push({
      code: "no_chart_candidates",
      message: "No paired numeric chart candidates were found in the selected generic imports.",
      severity: "warning",
    });
  }

  const ai = await requestAnthropicJson({
    system: "You review compact chart proposal specs for lab data. Return cautious advice only; do not invent values.",
    prompt: compactAiPrompt(context, proposals, options.userGoal || ""),
    maxTokens: 1000,
    env: options.env,
    fetchImpl: options.fetchImpl,
  });
  if (!ai.ok) warnings.push(ai.warning || aiUnavailableWarning());

  const proposalSet = {
    proposalSetId: proposalSetId(context.sourceImportIds),
    schemaVersion: CHART_PROPOSAL_SET_VERSION,
    createdAt: options.createdAt || new Date().toISOString(),
    sourceImportIds: context.sourceImportIds,
    proposals,
    warnings,
    ai: {
      provider: "anthropic",
      used: ai.ok,
      model: options.env?.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      note: ai.ok ? "AI response was requested; deterministic chart specs remain structured for review." : "Deterministic fallback used.",
      advice: ai.ok ? ai.text : "",
    },
  };

  return shapeChartProposalResponse({ proposalSet, warnings: [] });
}
