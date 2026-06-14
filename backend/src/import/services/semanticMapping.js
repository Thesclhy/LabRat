import { aiUnavailableWarning, requestAnthropicJson } from "../../ai/anthropic.js";
import {
  SEMANTIC_MAPPING_SET_VERSION,
  shapeSemanticMappingResponse,
} from "../schemas/semanticMappingSchemas.js";
import { buildGenericImportContext, slug } from "./genericImportContext.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function mappingSetId(sourceImportIds) {
  return `mapping_set_${slug(sourceImportIds.join("_") || "generic_import")}`;
}

function decisionStatus(priorDecisions, candidate) {
  const byMappingId = priorDecisions.find((decision) => decision.mappingId && decision.mappingId === candidate.mappingId);
  if (byMappingId?.status === "accepted" || byMappingId?.status === "rejected") return byMappingId.status;
  const bySource = priorDecisions.find((decision) => {
    const decisionSources = asArray(decision.sourceIds);
    return decision.canonicalField === candidate.canonicalField
      && decision.targetKind === candidate.targetKind
      && decisionSources.some((sourceId) => candidate.sourceIds.includes(sourceId));
  });
  return bySource?.status === "accepted" || bySource?.status === "rejected" ? bySource.status : "proposed";
}

function mappingFromField(field, index, priorDecisions) {
  const candidate = {
    mappingId: `mapping_${index + 1}_${slug(field.importId)}_${slug(field.field || field.displayName)}`,
    status: "proposed",
    targetKind: field.targetKind,
    sourceImportId: field.importId,
    sourceIds: field.sourceIds,
    rawLabel: field.displayName || field.field,
    canonicalField: field.canonicalField,
    semanticRole: field.semanticRole,
    valueType: field.valueType,
    unit: field.unit,
    confidence: field.confidence,
    rationale: field.rationale,
    sourceRefs: field.sourceRefs,
    coverageCount: field.coverageCount,
    examples: field.examples,
    warnings: field.warnings,
  };
  return {
    ...candidate,
    status: decisionStatus(priorDecisions, candidate),
  };
}

function compactAiPrompt(context, mappings, userGoal) {
  return JSON.stringify({
    userGoal,
    sourceImportIds: context.sourceImportIds,
    fields: mappings.map((mapping) => ({
      mappingId: mapping.mappingId,
      targetKind: mapping.targetKind,
      rawLabel: mapping.rawLabel,
      canonicalField: mapping.canonicalField,
      semanticRole: mapping.semanticRole,
      valueType: mapping.valueType,
      unit: mapping.unit,
      coverageCount: mapping.coverageCount,
      examples: mapping.examples,
      warnings: mapping.warnings,
    })),
  });
}

export async function createSemanticMappingResponse(options = {}) {
  const context = buildGenericImportContext(options);
  const deterministicMappings = [
    ...context.measurementFields,
    ...context.metadataFields,
  ].map((field, index) => mappingFromField(field, index, asArray(options.priorDecisions)));
  const warnings = [...context.warnings];

  const ai = await requestAnthropicJson({
    system: "You review compact lab import field summaries. Return cautious semantic mapping advice only; do not invent values.",
    prompt: compactAiPrompt(context, deterministicMappings, options.userGoal || ""),
    maxTokens: 1200,
    env: options.env,
    fetchImpl: options.fetchImpl,
  });

  if (!ai.ok) warnings.push(ai.warning || aiUnavailableWarning());

  const mappingSet = {
    mappingSetId: mappingSetId(context.sourceImportIds),
    schemaVersion: SEMANTIC_MAPPING_SET_VERSION,
    createdAt: options.createdAt || new Date().toISOString(),
    sourceImportIds: context.sourceImportIds,
    mappings: deterministicMappings,
    warnings,
    ai: {
      provider: "anthropic",
      used: ai.ok,
      model: options.env?.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      note: ai.ok ? "AI response was requested; deterministic proposals remain the authoritative structured output for review." : "Deterministic fallback used.",
      advice: ai.ok ? ai.text : "",
    },
  };

  return shapeSemanticMappingResponse({ mappingSet, warnings: [] });
}
