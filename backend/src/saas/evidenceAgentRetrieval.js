import {
  createEvidenceAgentTools,
  parseEvidenceQuery,
  TOOL_AGENT_SCHEMA_VERSION,
} from "./evidenceAgentTools.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function semanticTypesForQuery(query) {
  const normalized = String(query || "").toLowerCase();
  const types = [];
  if (/reaction\s*rate|rate/.test(normalized)) types.push("reaction_rate_time_series");
  if (/carbon|c\s*number|distribution|percentage|percent/.test(normalized)) types.push("component_distribution");
  return types;
}

async function attachPreviewToResults(results, tools, includePreview) {
  if (!includePreview) return results;
  return Promise.all(asArray(results).map(async (result) => {
    const previewResponse = await tools.read_confirmed_region_preview({
      regionId: result.regionId,
      maxRows: 20,
      maxColumns: 12,
    });
    return {
      ...result,
      preview: previewResponse.preview || null,
    };
  }));
}

async function fallbackPlanner({ query, tools, includeUnconfirmedSuggestions }) {
  const parsed = parseEvidenceQuery(query);
  const search = await tools.semantic_search_confirmed_regions({ query, topK: 5 });
  const selectedRegionIds = search.results.map((result) => result.regionId);
  const verification = await tools.verify_evidence_selection({
    selectedRegionIds,
    requiredExperimentAliases: parsed.experimentAliases,
    requiredSemanticTypes: semanticTypesForQuery(query),
  });
  if (verification.status === "verified") {
    return {
      provider: "fallback_region_card_planner",
      fallbackUsed: true,
      toolTrace: [
        { tool: "semantic_search_confirmed_regions", status: "completed", resultCount: search.results.length },
        { tool: "verify_evidence_selection", status: "completed", resultCount: verification.usableRegions.length },
      ],
      results: verification.usableRegions,
      suggestions: [],
      clarification: null,
    };
  }

  const suggestions = includeUnconfirmedSuggestions
    ? await tools.semantic_search_unconfirmed_regions({ query, topK: 5 })
    : { suggestions: [] };
  return {
    provider: "fallback_region_card_planner",
    fallbackUsed: true,
    toolTrace: [
      { tool: "semantic_search_confirmed_regions", status: "completed", resultCount: search.results.length },
      { tool: "verify_evidence_selection", status: "completed", resultCount: verification.usableRegions.length },
      { tool: "semantic_search_unconfirmed_regions", status: "completed", resultCount: suggestions.suggestions.length },
    ],
    results: [],
    suggestions: suggestions.suggestions,
    clarification: suggestions.suggestions.length
      ? {
        code: "confirm_region_before_use",
        message: "I found possible workbook regions, but they must be confirmed before use.",
      }
      : {
        code: "no_accepted_region_match",
        message: "No confirmed workbook region matches this request.",
      },
  };
}

export async function runEvidenceRetrievalAgent({
  project = null,
  query = "",
  acceptedRegionUnderstandings = [],
  sourceDocuments = [],
  sourceRegions = [],
  includePreview = true,
  includeUnconfirmedSuggestions = false,
  planner = fallbackPlanner,
  readRangePreview = null,
} = {}) {
  const tools = createEvidenceAgentTools({
    project,
    acceptedRegionUnderstandings,
    sourceDocuments,
    sourceRegions,
    readRangePreview,
  });
  const planResult = await planner({
    query,
    tools,
    includePreview,
    includeUnconfirmedSuggestions,
  });
  const results = await attachPreviewToResults(planResult.results, tools, includePreview);
  return {
    schemaVersion: TOOL_AGENT_SCHEMA_VERSION,
    projectId: project?.id || null,
    query,
    mode: "tool_agent",
    planner: {
      provider: planResult.provider || "unknown_planner",
      fallbackUsed: planResult.fallbackUsed === true,
    },
    toolTrace: asArray(planResult.toolTrace),
    results,
    suggestions: includeUnconfirmedSuggestions ? asArray(planResult.suggestions) : [],
    clarification: planResult.clarification || (results.length ? null : {
      code: "no_accepted_region_match",
      message: "No confirmed workbook region matches this request.",
    }),
  };
}
